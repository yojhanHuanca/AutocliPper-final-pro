import {
  Injectable,
  UnauthorizedException,
  HttpException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  PayloadTooLargeException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { Request, Response } from "express";
import pg from "pg";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import {
  loadServiceConfig,
  digest,
  opaqueToken,
  cookie,
  setCookie,
  clearCookies,
  same,
  body,
  requireCsrf,
  requireInternal,
  internalJson,
} from "@autoclipper/http-security";
import { logger } from "@autoclipper/observability";
import {
  registration,
  login,
  token,
  resetRequest,
  reset,
  type PublicUser,
} from "../domain/credentials.js";
import { mailTransport, seal, unseal } from "../infrastructure/mail.js";
import { MfaManager } from "./mfa.manager.js";
import { GoogleIdentityAdapter } from "../infrastructure/google.js";
import { TwitchAdapter, TWITCH_CLIP_SCOPE, TWITCH_CLIP_DOWNLOAD_HELIX_REQUEST_BUDGET, TWITCH_VOD_CLIP_CREATE_HELIX_REQUEST_BUDGET, TWITCH_HELIX_REQUEST_BUDGET_PER_FIXED_MINUTE, hasTwitchClipScope } from "../infrastructure/twitch.js";
import { googleProof } from "../domain/google-identity.js";
import {adminReauth,privacyProfileProof,privacyWorkspaceResult,privacyWorkspaceAuthorityRequest,privacyProjectResult,privacyProjectAuthorityRequest,privacyBillingResult,privacyBillingAuthorityRequest,privacyMediaResult,privacyAnalysisResult,privacyMediaAuthorityRequest,privacyAnalysisAuthorityRequest,privacyRequestManifest} from "@autoclipper/api-contracts";
import {AdminManager} from "./admin.manager.js";
import {preparePrivacyProfile} from "./privacy-exports.js";
import {issueWorkspaceCapability,authorizeWorkspaceCapability} from "./privacy-capabilities.js";
import {issueProjectCapability,authorizeProjectCapability} from "./privacy-project-capabilities.js";
import {issueBillingCapability,authorizeBillingCapability} from "./privacy-billing-capabilities.js";
import {issueTaskPrivacyCapability,authorizeTaskPrivacyCapability,type TaskPrivacyScope} from './privacy-task-capabilities.js';
import {twitchSourceCapabilityRequest,twitchSourceCapabilityStatus,twitchVodClipCreateRequest} from "@autoclipper/api-contracts";

type UserRow = PublicUser & { password_hash: string; verified_at: Date | null };
type SessionRow = {
  id: string;
  user_id: string;
  refresh_hash: string;
  consumed_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date;
};
const privacyScopes=[['identity-profile-v1',true],['workspace-memberships-v1',true],['project-attribution-v1',true],['media-task-attribution-v1',true],['analysis-attribution-v1',true],['consumption-attribution-v1',true]] as const;
@Injectable()
export class IdentityService implements OnModuleInit, OnModuleDestroy {
  readonly config = loadServiceConfig();
  readonly pool = new pg.Pool({
    connectionString: this.config.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  });
  readonly redis = new Redis(process.env["REDIS_URL"] ?? "", {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
  });
  readonly transport = mailTransport();
  readonly encryptionKey = process.env["AUTH_ENCRYPTION_KEY"] ?? "";
  readonly mfa = new MfaManager(this.encryptionKey);
  readonly admin = new AdminManager(this.pool,this.config,this.redis);
  readonly google = new GoogleIdentityAdapter();
  readonly twitch = new TwitchAdapter();
  private dummyHash = "";
  private timer: NodeJS.Timeout | undefined;
  private privacyCapabilityTimer: NodeJS.Timeout | undefined;
  private twitchValidationTimer: NodeJS.Timeout | undefined;
  private sending: Promise<void> | undefined;
  private pruningPrivacyCapabilities: Promise<void> | undefined;
  private async refreshTwitchLink(userId:string,rejectedAccessToken:string) {
    const client=await this.pool.connect(),lockKey=`twitch-refresh:${userId}`;
    let locked=false;
    let discardClient:Error|undefined;
    try {
      const deadline=Date.now()+10000;
      while(Date.now()<deadline) {
        try {locked=Boolean((await client.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",[lockKey])).rows[0]?.locked);}
        catch(error){discardClient=error instanceof Error?error:new Error("TWITCH_REFRESH_LOCK_FAILED");throw error;}
        if(locked)break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(!locked)throw new ServiceUnavailableException({code:"TWITCH_TOKEN_REFRESH_BUSY"});
      const row=(await client.query<{token_cipher:string;twitch_user_id:string}>("SELECT token_cipher,twitch_user_id FROM twitch_links WHERE user_id=$1",[userId])).rows[0];
      if(!row)throw new NotFoundException();
      let saved=JSON.parse(unseal(row.token_cipher,this.encryptionKey,`twitch:${userId}`)) as {accessToken:string;refreshToken:string};
      let rotated=false;
      const persist=async(refreshed:Awaited<ReturnType<TwitchAdapter["refresh"]>>) => {
        saved={accessToken:refreshed.accessToken,refreshToken:refreshed.refreshToken};rotated=true;
        const cipher=seal(JSON.stringify(saved),this.encryptionKey,`twitch:${userId}`);
        for(let attempt=0;;attempt++) {
          try {
            await client.query("UPDATE twitch_links SET token_cipher=$1,token_validated_at=now(),scope=$2,expires_at=now()+($3::text||' seconds')::interval,updated_at=now() WHERE user_id=$4",[cipher,refreshed.scopes,refreshed.expiresIn,userId]);
            return;
          } catch(error) {
            if(attempt>=2)throw error;
            await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));
          }
        }
      };
      if(saved.accessToken===rejectedAccessToken)await persist(await this.twitch.refresh(saved.refreshToken));
      let verified;
      try {verified=await this.twitch.validate(saved.accessToken);}
      catch(error) {
        if(!(error instanceof UnauthorizedException)||rotated)throw error;
        await persist(await this.twitch.refresh(saved.refreshToken));
        verified=await this.twitch.validate(saved.accessToken);
      }
      if(verified.userId!==row.twitch_user_id)throw new UnauthorizedException();
      if(!rotated)await client.query("UPDATE twitch_links SET token_validated_at=now() WHERE user_id=$1",[userId]);
      return {saved,verified};
    } finally {
      try {if(locked)await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[lockKey]);}
      catch(error){discardClient=error instanceof Error?error:new Error("TWITCH_REFRESH_UNLOCK_FAILED");logger.error({code:"TWITCH_REFRESH_UNLOCK_FAILED"});}
      finally {client.release(discardClient);}
    }
  }
  async onModuleInit() {
    if (!/^[0-9a-f]{64}$/.test(this.encryptionKey))
      throw new Error("AUTH_ENCRYPTION_KEY invalid");
    this.pool.on("error", () =>
      logger.error({ code: "IDENTITY_DATABASE_ERROR" }),
    );
    this.redis.on("error", () =>
      logger.error({ code: "IDENTITY_RATE_LIMIT_UNAVAILABLE" }),
    );
    this.dummyHash = await this.hash(opaqueToken());
    this.timer = setInterval(() => {
      if (!this.sending)
        this.sending = this.deliver()
          .catch(() => logger.error({ code: "MAIL_DELIVERY_FAILED" }))
          .finally(() => {
            this.sending = undefined;
          });
    }, 1000);
    this.timer.unref();
    this.privacyCapabilityTimer=setInterval(()=>{
      if(!this.pruningPrivacyCapabilities)this.pruningPrivacyCapabilities=this.pruneExpiredPrivacyCapabilities().catch(()=>logger.error({code:"PRIVACY_CAPABILITY_CLEANUP_FAILED"})).finally(()=>{this.pruningPrivacyCapabilities=undefined;});
    },60000);
    this.privacyCapabilityTimer.unref();
    if(this.twitch.configured) {
      void this.validateTwitchLinks(true).catch(()=>logger.warn({code:"TWITCH_TOKEN_VALIDATION_FAILED"}));
      this.twitchValidationTimer=setInterval(()=>{void this.validateTwitchLinks().catch(()=>logger.warn({code:"TWITCH_TOKEN_VALIDATION_FAILED"}));},60*60*1000);
      this.twitchValidationTimer.unref();
    }
  }
  private async validateTwitchLinks(force=false) {
    if(!this.twitch.configured) return;
    const rows=(await this.pool.query<{user_id:string;token_cipher:string}>(`SELECT user_id,token_cipher FROM twitch_links ${force?"":"WHERE token_validated_at<now()-interval '55 minutes'"} ORDER BY token_validated_at LIMIT 100`)).rows;
    for(const row of rows) {
      try {
        const saved=JSON.parse(unseal(row.token_cipher,this.encryptionKey,`twitch:${row.user_id}`)) as {accessToken:string;refreshToken:string};
        try {await this.twitch.validate(saved.accessToken);await this.pool.query("UPDATE twitch_links SET token_validated_at=now() WHERE user_id=$1",[row.user_id]);}
        catch(error) {
          if(!(error instanceof UnauthorizedException)) throw error;
          try {
            await this.refreshTwitchLink(row.user_id,saved.accessToken);
          } catch(refreshError) {
            if(refreshError instanceof UnauthorizedException)await this.pool.query("DELETE FROM twitch_links WHERE user_id=$1",[row.user_id]);
            else throw refreshError;
          }
        }
      } catch {logger.warn({code:"TWITCH_LINK_VALIDATION_FAILED"});}
    }
  }
  private hash(value: string) {
    return argon2.hash(value, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  private async tx<T>(work: (client: pg.PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async limit(req: Request, subject: string) {
    const trusted = req.headers["x-service-token"];
    const forwarded = req.headers["x-client-ip"];
    const remote =
      typeof trusted === "string" &&
      same(trusted, this.config.INTERNAL_TOKEN) &&
      typeof forwarded === "string"
        ? forwarded
        : req.ip;
    const script =
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],600) end; return n";
    const total = Number(
      await this.redis.eval(
        script,
        1,
        `identity:global:${digest(remote ?? "unknown")}`,
      ),
    );
    if (total > 120) throw new HttpException("Rate limited", 429);
    const key = `identity:rate:${digest(`${remote}:${subject}`)}`;
    const count = Number(
      await this.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],600) end; return n",
        1,
        key,
      ),
    );
    if (count > 20) throw new HttpException("Rate limited", 429);
  }
  private async mail(
    client: pg.PoolClient,
    user: PublicUser,
    purpose: "verify" | "reset",
  ) {
    const raw = opaqueToken();
    const id = randomUUID();
    await client.query(
      "INSERT INTO verification_tokens(id,user_id,token_hash,purpose,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",
      [id, user.id, digest(raw), purpose],
    );
    const payload = {
      to: user.email,
      subject:
        purpose === "verify"
          ? "Verifica tu cuenta AutoClipper"
          : "Recupera tu cuenta AutoClipper",
      text: `${this.config.CORS_ORIGIN}/auth/${purpose}?token=${raw}\nEste enlace vence en 30 minutos. Si no solicitaste esta acción, ignora este mensaje.`,
    };
    await client.query("INSERT INTO mail_outbox(id,payload) VALUES($1,$2)", [
      id,
      seal(JSON.stringify(payload), this.encryptionKey),
    ]);
  }
  async register(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(registration, input);
    await this.limit(req, data.email);
    const hash = await this.hash(data.password);
    await this.tx(async (client) => {
      const result = await client.query<UserRow>(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING *",
        [randomUUID(), data.email, data.name, hash],
      );
      if (result.rows[0]) await this.mail(client, result.rows[0], "verify");
    });
    return { accepted: true };
  }
  async verify(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(token, input);
    await this.limit(req, "verify");
    return this.tx(async (client) => {
      const result = await client.query<{ id: string; user_id: string }>(
        "UPDATE verification_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='verify' AND consumed_at IS NULL AND expires_at>now() RETURNING id,user_id",
        [digest(data.token)],
      );
      const row = result.rows[0];
      if (!row) throw new UnauthorizedException();
      await client.query(
        "UPDATE users SET verified_at=COALESCE(verified_at,now()) WHERE id=$1",
        [row.user_id],
      );
      return { verified: true };
    });
  }
  async signIn(req: Request, res: Response, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(login, input);
    await this.limit(req, data.email);
    const result = await this.pool.query<UserRow>(
      "SELECT * FROM users WHERE email=$1",
      [data.email],
    );
    const user = result.rows[0];
    const matches = await argon2.verify(
      user?.password_hash ?? this.dummyHash,
      data.password,
    );
    if (!user || !matches || !user.verified_at)
      throw new UnauthorizedException();
    const tokens = await this.tx(async (client) => {
      const locked = (
        await client.query<{ password_hash: string }>(
          "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
          [user.id],
        )
      ).rows[0];
      if (!locked || locked.password_hash !== user.password_hash)
        throw new UnauthorizedException();
      await this.mfa.verify(client, user.id, data.factor);
      return this.newSession(client, user.id, req);
    });
    this.sessionCookies(res, tokens);
    return { user: { id: user.id, email: user.email, name: user.name } };
  }
  private async newSession(client: pg.PoolClient, userId: string, req: Request) {
    const access = opaqueToken(), refresh = opaqueToken(), session = randomUUID();
    await client.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')", [session,userId]);
    await client.query("INSERT INTO refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '30 days')", [digest(refresh),session]);
    await client.query("INSERT INTO access_tokens(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')", [digest(access),session]);
    await this.audit(client,userId,"session.login",req);
    return {access,refresh};
  }
  private sessionCookies(res: Response, tokens: {access: string;refresh: string}) {
    setCookie(res,"access",tokens.access,900000);
    setCookie(res,"refresh",tokens.refresh,2592000000);
  }
  providers() { return { google: { configured: Boolean(this.google.clientId) }, twitch: { configured: this.twitch.configured } }; }
  async linkTwitch(req:Request,res:Response) {
    requireCsrf(req,this.config);
    const user=await this.me(req);
    this.twitch.requireConfigured();
    await this.limit(req,`twitch:link:${user.id}`);
    const state=opaqueToken();
    const prior=cookie(req,"twitch_state");
    if(/^[A-Za-z0-9_-]{43}$/.test(prior)) await this.redis.del(`identity:twitch:${digest(prior)}`);
    await this.redis.set(`identity:twitch:${digest(state)}`,user.id,"EX",300);
    setCookie(res,"twitch_state",state,300000);
    return {authorizationUrl:this.twitch.authorizationUrl(state),expiresInSeconds:300,scope:TWITCH_CLIP_SCOPE};
  }
  async twitchLinkStatus(req:Request) {
    const user=await this.me(req);
    if(!this.twitch.configured) return {configured:false,linked:false,account:null};
    const row=(await this.pool.query<{twitch_user_id:string;login:string}>("SELECT twitch_user_id,login FROM twitch_links WHERE user_id=$1",[user.id])).rows[0];
    return {configured:this.twitch.configured,linked:Boolean(row),account:row?{id:row.twitch_user_id,login:row.login}:null};
  }
  async twitchCallback(req:Request,res:Response) {
    const stateValue=typeof req.query["state"]==="string"?req.query["state"]:"";
    const code=typeof req.query["code"]==="string"?req.query["code"]:"";
    const stateCookie=cookie(req,"twitch_state");
    setCookie(res,"twitch_state","",0);
    if(!/^[A-Za-z0-9_-]{43}$/.test(stateValue)||stateValue!==stateCookie) throw new UnauthorizedException();
    const userId=await this.redis.getdel(`identity:twitch:${digest(stateValue)}`);
    if(!userId) throw new UnauthorizedException();
    if((await this.me(req)).id!==userId) throw new UnauthorizedException();
    if(req.query["error"]||!code||code.length>4096) throw new HttpException({code:"TWITCH_CONSENT_DENIED"},400);
    const tokens=await this.twitch.exchange(code);
    const verified=await this.twitch.validate(tokens.accessToken);
    if(!hasTwitchClipScope(verified.scopes)) throw new HttpException({code:"TWITCH_CLIP_SCOPE_REQUIRED"},403);
    const value=JSON.stringify({accessToken:tokens.accessToken,refreshToken:tokens.refreshToken});
    await this.tx(async client=>{
      const result=await client.query<{twitch_user_id:string}>(
        "INSERT INTO twitch_links(user_id,twitch_user_id,login,token_cipher,token_validated_at,scope,expires_at) VALUES($1,$2,$3,$4,now(),$5,now()+($6::text||' seconds')::interval) ON CONFLICT(user_id) DO UPDATE SET twitch_user_id=EXCLUDED.twitch_user_id,login=EXCLUDED.login,token_cipher=EXCLUDED.token_cipher,token_validated_at=now(),scope=EXCLUDED.scope,expires_at=EXCLUDED.expires_at,updated_at=now() WHERE twitch_links.twitch_user_id=EXCLUDED.twitch_user_id OR NOT EXISTS(SELECT 1 FROM twitch_links WHERE twitch_user_id=EXCLUDED.twitch_user_id AND user_id<>EXCLUDED.user_id) RETURNING twitch_user_id",
        [userId,verified.userId,verified.login,seal(value,this.encryptionKey,`twitch:${userId}`),tokens.scopes,tokens.expiresIn],
      );
      if(!result.rows[0]) throw new ConflictException({code:"TWITCH_ACCOUNT_ALREADY_LINKED"});
      await this.audit(client,userId,"twitch.linked",req);
      return result.rows[0];
    });
    return {linked:true,provider:"twitch",account:{id:verified.userId,login:verified.login}};
  }
  async unlinkTwitch(req:Request) {
    requireCsrf(req,this.config);
    const user=await this.me(req);
    // Delete and retrieve the exact credential in one transaction. A separate
    // SELECT followed by DELETE could revoke an old token while deleting a
    // concurrently re-linked credential for the same user.
    const row=await this.tx(async client=>{
      // Refresh uses a session advisory lock with this key. Holding the matching
      // transaction lock makes unlink wait for an in-flight rotation, then delete
      // the current ciphertext instead of allowing refresh to race past deletion.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`twitch-refresh:${user.id}`]);
      const deleted=(await client.query<{token_cipher:string}>("DELETE FROM twitch_links WHERE user_id=$1 RETURNING token_cipher",[user.id])).rows[0];
      if(deleted)await this.audit(client,user.id,"twitch.unlinked",req);
      return deleted;
    });
    if(!row) return {unlinked:true};
    let accessToken:string|undefined;
    try {
      accessToken=(JSON.parse(unseal(row.token_cipher,this.encryptionKey,`twitch:${user.id}`)) as {accessToken:string}).accessToken;
    } catch { /* Revocation is best-effort; local deletion always takes effect. */ }
    // Revoke only after committing local deletion. A slow/failed provider call must not
    // leave a credential available to the application after the user unlinks it.
    if(accessToken)try {
      await fetch("https://id.twitch.tv/oauth2/revoke",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:this.twitch.clientId,token:accessToken}),signal:AbortSignal.timeout(5000),redirect:"error"});
    } catch { /* Local revocation is authoritative for this application. */ }
    return {unlinked:true};
  }
  async internalTwitchClipDownload(req:Request,input:unknown) {
    requireInternal(req,this.config);
    const data=body(z.object({userId:z.uuid(),clipId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)}).strict(),input);
    if(!this.twitch.configured) return {available:false as const,reasonCode:"TWITCH_OAUTH_NOT_CONFIGURED"};
    const row=(await this.pool.query<{token_cipher:string;login:string;twitch_user_id:string}>("SELECT token_cipher,login,twitch_user_id FROM twitch_links WHERE user_id=$1",[data.userId])).rows[0];
    if(!row) return {available:false as const,reasonCode:"TWITCH_ACCOUNT_NOT_LINKED"};
    const rateKey=`identity:twitch:downloads:${Math.floor(Date.now()/60000)}`;
    const rate=await this.redis.incrby(rateKey,TWITCH_CLIP_DOWNLOAD_HELIX_REQUEST_BUDGET);
    await this.redis.expire(rateKey,120);
    if(rate>TWITCH_HELIX_REQUEST_BUDGET_PER_FIXED_MINUTE) return {available:false as const,reasonCode:"TWITCH_RATE_LIMITED"};
    let saved=JSON.parse(unseal(row.token_cipher,this.encryptionKey,`twitch:${data.userId}`)) as {accessToken:string;refreshToken:string};
    try {
      let verified;
      try {verified=await this.twitch.validate(saved.accessToken);}
      catch(error) {
        if(!(error instanceof UnauthorizedException)) throw error;
        ({saved,verified}=await this.refreshTwitchLink(data.userId,saved.accessToken));
      }
      if(verified.userId!==row.twitch_user_id) return {available:false as const,reasonCode:"TWITCH_ACCOUNT_BINDING_INVALID"};
      try {return {available:true as const,...await this.twitch.clipDownload(saved.accessToken,verified.userId,data.clipId)};}
      catch(error) {
        if(!(error instanceof UnauthorizedException)) throw error;
        ({saved,verified}=await this.refreshTwitchLink(data.userId,saved.accessToken));
        return {available:true as const,...await this.twitch.clipDownload(saved.accessToken,verified.userId,data.clipId)};
      }
    } catch(error) {
      if(error instanceof HttpException) {
        const response=error.getResponse();
        const code=response&&typeof response==="object"&&"code" in response&&typeof response.code==="string"?response.code:"TWITCH_IMPORT_UNAVAILABLE";
        return {available:false as const,reasonCode:code};
      }
      throw error;
    }
  }
  async internalTwitchVodClipCreate(req:Request,input:unknown) {
    requireInternal(req,this.config);
    const data=body(twitchVodClipCreateRequest,input);
    if(!this.twitch.configured)return {state:"rejected" as const,reasonCode:"TWITCH_OAUTH_NOT_CONFIGURED"};
    const row=(await this.pool.query<{token_cipher:string;login:string;twitch_user_id:string}>("SELECT token_cipher,login,twitch_user_id FROM twitch_links WHERE user_id=$1",[data.userId])).rows[0];
    if(!row)return {state:"rejected" as const,reasonCode:"TWITCH_ACCOUNT_NOT_LINKED"};
    const rateKey=`identity:twitch:downloads:${Math.floor(Date.now()/60000)}`;
    const rate=await this.redis.incrby(rateKey,TWITCH_VOD_CLIP_CREATE_HELIX_REQUEST_BUDGET);
    await this.redis.expire(rateKey,120);
    if(rate>TWITCH_HELIX_REQUEST_BUDGET_PER_FIXED_MINUTE)return {state:"rejected" as const,reasonCode:"TWITCH_RATE_LIMITED"};
    let saved: {accessToken:string;refreshToken:string},verified;
    try {
      saved=JSON.parse(unseal(row.token_cipher,this.encryptionKey,`twitch:${data.userId}`)) as {accessToken:string;refreshToken:string};
      try {verified=await this.twitch.validate(saved.accessToken);}
      catch(error) {
        if(!(error instanceof UnauthorizedException))throw error;
        ({saved,verified}=await this.refreshTwitchLink(data.userId,saved.accessToken));
      }
      if(verified.userId!==row.twitch_user_id)return {state:"rejected" as const,reasonCode:"TWITCH_ACCOUNT_BINDING_INVALID"};
      if(!hasTwitchClipScope(verified.scopes))return {state:"rejected" as const,reasonCode:"TWITCH_CLIP_SCOPE_REQUIRED"};
      const clip=await this.twitch.createVodClip(saved.accessToken,verified.userId,data.vodId,data.vodOffsetSeconds,data.durationSeconds,data.title);
      return {state:"created" as const,...clip};
    } catch(error) {
      const response=error instanceof HttpException?error.getResponse():null;
      const code=response&&typeof response==="object"&&"code" in response&&typeof response.code==="string"?response.code:"TWITCH_VOD_CLIP_CREATE_FAILED";
      if(code==="TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN")return {state:"outcome_unknown" as const,reasonCode:code};
      if(error instanceof HttpException)return {state:"rejected" as const,reasonCode:code};
      return {state:"rejected" as const,reasonCode:"TWITCH_VOD_CLIP_CREATE_FAILED"};
    }
  }
  async internalTwitchSourceCapabilities(req:Request,input:unknown) {
    requireInternal(req,this.config);
    const data=body(twitchSourceCapabilityRequest,input);
    if(!this.twitch.configured)return body(twitchSourceCapabilityStatus,{configured:false,linked:false,clipScopeReady:false});
    const row=(await this.pool.query<{scope:string[]}>("SELECT scope FROM twitch_links WHERE user_id=$1",[data.userId])).rows[0];
    return body(twitchSourceCapabilityStatus,{configured:true,linked:Boolean(row),clipScopeReady:Boolean(row&&hasTwitchClipScope(row.scope))});
  }
  async googleChallenge(req: Request, res: Response, input: unknown) {
    requireCsrf(req,this.config);
    const data = body(z.object({purpose:z.enum(["sign_in","link"])}).strict(),input);
    const clientId = this.google.configuredClientId();
    await this.limit(req,"google:challenge");
    const userId = data.purpose === "link" ? (await this.me(req)).id : "";
    const nonce = opaqueToken();
    const prior = cookie(req,"google_nonce");
    if (/^[A-Za-z0-9_-]{43}$/.test(prior)) await this.redis.del(`identity:google:${digest(prior)}`);
    await this.redis.set(`identity:google:${digest(nonce)}`,`${data.purpose}:${userId}`,"EX",300);
    setCookie(res,"google_nonce",nonce,300000);
    return {clientId,nonce,expiresInSeconds:300};
  }
  private async googleCredential(req: Request,res: Response,credential: string,purpose: "sign_in"|"link",userId = "") {
    const nonce = cookie(req,"google_nonce");
    if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new UnauthorizedException();
    const identity = await this.google.verify(credential,nonce);
    const binding = await this.redis.getdel(`identity:google:${digest(nonce)}`);
    setCookie(res,"google_nonce","",0);
    if (binding !== `${purpose}:${userId}`) throw new UnauthorizedException();
    return identity;
  }
  async googleSignIn(req: Request,res: Response,input: unknown) {
    requireCsrf(req,this.config);
    this.google.configuredClientId();
    const data = body(googleProof,input);
    await this.limit(req,"google:login");
    const identity = await this.googleCredential(req,res,data.credential,"sign_in");
    // New federated accounts have an unknowable local password. Password recovery
    // can set a local password later without weakening Google's proof or 2FA.
    const unusedHash = await this.hash(opaqueToken());
    const result = await this.tx(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`google:${identity.subject}`]);
      let user = (await client.query<UserRow>("SELECT u.* FROM external_identities e JOIN users u ON u.id=e.user_id WHERE e.provider='google' AND e.subject=$1 FOR UPDATE OF u",[identity.subject])).rows[0];
      if (!user) {
        user = (await client.query<UserRow>("INSERT INTO users(id,email,name,password_hash,verified_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING RETURNING *",[randomUUID(),identity.email,identity.name,unusedHash,identity.authoritativeEmail ? new Date() : null])).rows[0];
        if (!user) throw new HttpException({code:"ACCOUNT_LINK_REQUIRED"},409);
        await client.query("INSERT INTO external_identities(provider,subject,user_id,provider_email) VALUES('google',$1,$2,$3)",[identity.subject,user.id,identity.email]);
        await this.audit(client,user.id,"google.registered",req);
        if (!user.verified_at) await this.mail(client,user,"verify");
      }
      if (!user.verified_at) return {verificationRequired:true as const};
      await this.mfa.verify(client,user.id,data.factor);
      const tokens = await this.newSession(client,user.id,req);
      await this.audit(client,user.id,"google.login",req);
      return {verificationRequired:false as const,user:{id:user.id,email:user.email,name:user.name},tokens};
    });
    if (result.verificationRequired) return {verificationRequired:true};
    this.sessionCookies(res,result.tokens);
    return {user:result.user};
  }
  async linkGoogle(req: Request,res: Response,input: unknown) {
    requireCsrf(req,this.config);
    this.google.configuredClientId();
    const data = body(googleProof.extend({password:z.string().min(1).max(128)}),input);
    const current = await this.me(req);
    await this.limit(req,`google:link:${current.id}`);
    const identity = await this.googleCredential(req,res,data.credential,"link",current.id);
    return this.sensitive(req,data.password,async (client,user) => {
      await this.mfa.verify(client,user.id,data.factor);
      const inserted = await client.query("INSERT INTO external_identities(provider,subject,user_id,provider_email) VALUES('google',$1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id",[identity.subject,user.id,identity.email]);
      if (!inserted.rows[0]) {
        const existing = (await client.query<{user_id:string}>("SELECT user_id FROM external_identities WHERE provider='google' AND subject=$1",[identity.subject])).rows[0];
        if (existing?.user_id !== user.id) throw new ConflictException();
      } else await this.audit(client,user.id,"google.linked",req);
      return {linked:true};
    });
  }
  async authenticate(raw: string): Promise<PublicUser> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new UnauthorizedException();
    const result = await this.pool.query<PublicUser>(
      "SELECT u.id,u.email,u.name FROM access_tokens a JOIN sessions s ON s.id=a.session_id JOIN users u ON u.id=s.user_id WHERE a.token_hash=$1 AND a.expires_at>now() AND s.expires_at>now() AND s.revoked_at IS NULL",
      [digest(raw)],
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException();
    return user;
  }
  async me(req: Request) {
    return this.authenticate(cookie(req, "access"));
  }
  async adminAccess(req:Request,input:unknown,correlationId:string){
    requireCsrf(req,this.config);await this.admin.boundary(req);const data=body(adminReauth,input),user=await this.me(req);
    try{return await this.sensitive(req,data.password,(client,actor)=>this.admin.elevate(client,req,actor.id,data.factor,this.mfa,correlationId));}
    catch(error){await this.admin.audit(this.pool,user.id,null,undefined,"reauth_denied",correlationId);throw error;}
  }
  private async sensitive<T>(
    req: Request,
    password: string,
    work: (client: pg.PoolClient, user: PublicUser) => Promise<T>,
  ) {
    const user = await this.me(req);
    await this.limit(req, `sensitive:${user.id}`);
    const current = (
      await this.pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [
        user.id,
      ])
    ).rows[0];
    if (!current || !(await argon2.verify(current.password_hash, password)))
      throw new UnauthorizedException();
    return this.tx(async (client) => {
      const locked = (
        await client.query<{ password_hash: string }>(
          "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
          [user.id],
        )
      ).rows[0];
      if (!locked || locked.password_hash !== current.password_hash)
        throw new UnauthorizedException();
      return work(client, user);
    });
  }
  async mfaStatus(req: Request) {
    const user = await this.me(req);
    const row = (
      await this.pool.query<{ enabled: boolean }>(
        "SELECT enabled FROM user_mfa WHERE user_id=$1",
        [user.id],
      )
    ).rows[0];
    const codes = (
      await this.pool.query<{ count: string }>(
        "SELECT count(*) FROM recovery_codes WHERE user_id=$1 AND consumed_at IS NULL",
        [user.id],
      )
    ).rows[0];
    return {
      enabled: row?.enabled ?? false,
      recoveryCodesRemaining: Number(codes?.count ?? 0),
    };
  }
  async setupMfa(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z.object({ password: z.string().min(1).max(128) }).strict(),
      input,
    );
    return this.sensitive(req, data.password, async (client, user) => {
      const result = await this.mfa.setup(client, user.id, user.email);
      await this.audit(client, user.id, "mfa.setup", req);
      return result;
    });
  }
  async enableMfa(req: Request, res: Response, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z
        .object({
          password: z.string().min(1).max(128),
          code: z.string().regex(/^\d{6}$/),
        })
        .strict(),
      input,
    );
    const result = await this.sensitive(
      req,
      data.password,
      async (client, user) => {
        const enabled = await this.mfa.enable(client, user.id, data.code);
        await client.query(
          "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
          [user.id],
        );
        await this.audit(client, user.id, "mfa.enabled", req);
        return enabled;
      },
    );
    clearCookies(res);
    return result;
  }
  async disableMfa(req: Request, res: Response, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z
        .object({
          password: z.string().min(1).max(128),
          factor: z
            .string()
            .regex(/^(\d{6}|[a-f0-9]{24})$/)
            .optional(),
        })
        .strict(),
      input,
    );
    const result = await this.sensitive(
      req,
      data.password,
      async (client, user) => {
        const disabled = await this.mfa.disable(client, user.id, data.factor);
        await client.query(
          "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
          [user.id],
        );
        await this.audit(client, user.id, "mfa.disabled", req);
        return disabled;
      },
    );
    clearCookies(res);
    return result;
  }
  async rotateRecovery(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z
        .object({
          password: z.string().min(1).max(128),
          factor: z.string().regex(/^(\d{6}|[a-f0-9]{24})$/),
        })
        .strict(),
      input,
    );
    return this.sensitive(req, data.password, async (client, user) => {
      const active = (
        await client.query<{ enabled: boolean }>(
          "SELECT enabled FROM user_mfa WHERE user_id=$1",
          [user.id],
        )
      ).rows[0];
      if (!active?.enabled) throw new ConflictException();
      await this.mfa.verify(client, user.id, data.factor);
      const recoveryCodes = await this.mfa.codes(client, user.id);
      await this.audit(client, user.id, "mfa.recovery_rotated", req);
      return { recoveryCodes };
    });
  }
  async profile(req: Request) {
    const user = await this.me(req);
    const row = (
      await this.pool.query<{
        name: string;
        preferences: Record<string, unknown>;
        profile_version: number;
      }>("SELECT name,preferences,profile_version FROM users WHERE id=$1", [
        user.id,
      ])
    ).rows[0]!;
    return {
      id: user.id,
      email: user.email,
      name: row.name,
      preferences: row.preferences,
      version: row.profile_version,
    };
  }
  async updateProfile(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const user = await this.me(req);
    const preferences = z
      .object({
        locale: z.enum(["es", "en"]).optional(),
        timezone: z
          .string()
          .max(64)
          .refine(
            (value) =>
              value === "UTC" ||
              Intl.supportedValuesOf("timeZone").includes(value),
          )
          .optional(),
        emailNotifications: z.boolean().optional(),
        theme: z.enum(["light", "dark", "system"]).optional(),
      })
      .strict();
    const data = body(
      z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          preferences: preferences.optional(),
          version: z.number().int().positive(),
        })
        .strict()
        .refine(
          (value) =>
            value.name !== undefined ||
            Object.keys(value.preferences ?? {}).length > 0,
        ),
      input,
    );
    const updated = await this.pool.query<{ profile_version: number }>(
      "UPDATE users SET name=COALESCE($1,name),preferences=preferences||$2::jsonb,profile_version=profile_version+1 WHERE id=$3 AND profile_version=$4 RETURNING profile_version",
      [
        data.name ?? null,
        JSON.stringify(data.preferences ?? {}),
        user.id,
        data.version,
      ],
    );
    if (!updated.rows[0]) throw new ConflictException();
    return { version: updated.rows[0].profile_version };
  }
  private async ensurePrivacyScopes(client:pg.PoolClient,requestId:string){
    for(const[scope,supported]of privacyScopes)await client.query("INSERT INTO privacy_request_scopes(request_id,scope,required,supported,status,last_error_code) VALUES($1,$2,true,$3,$4,$5) ON CONFLICT(request_id,scope) DO NOTHING",[requestId,scope,supported,supported?'pending':'not_implemented',supported?null:'NOT_IMPLEMENTED']);
  }
  private async recordPrivacyScopeReceipt(client:pg.PoolClient,userId:string,requestId:string,scope:string,ownerReceiptId:string,sha256:string,capturedAt:string|null){
    const scopeRow=(await client.query("SELECT 1 FROM privacy_request_scopes s JOIN privacy_requests p ON p.id=s.request_id WHERE s.request_id=$1 AND p.user_id=$2 AND p.kind='export' AND p.state IN ('requested','processing') AND s.scope=$3 AND s.required AND s.supported",[requestId,userId,scope])).rows[0];
    if(!scopeRow)throw new NotFoundException();
    await client.query('INSERT INTO privacy_scope_receipts(id,request_id,scope,owner_receipt_id,content_sha256,captured_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(request_id,scope,owner_receipt_id) DO NOTHING',[randomUUID(),requestId,scope,ownerReceiptId,sha256,capturedAt]);
    const receipt=(await client.query<{id:string;content_sha256:string;captured_at:Date|null}>('SELECT id,content_sha256,captured_at FROM privacy_scope_receipts WHERE request_id=$1 AND scope=$2 AND owner_receipt_id=$3',[requestId,scope,ownerReceiptId])).rows[0];
    if(!receipt||receipt.content_sha256!==sha256||((receipt.captured_at?.toISOString()??null)!==(capturedAt??null)))throw new ServiceUnavailableException();
    await client.query("UPDATE privacy_request_scopes s SET status='prepared',current_receipt_id=$4,last_error_code=NULL,attempts=attempts+1,updated_at=now() FROM privacy_requests p WHERE s.request_id=$1 AND p.id=s.request_id AND p.user_id=$2 AND p.kind='export' AND p.state IN ('requested','processing') AND s.scope=$3 AND s.required AND s.supported",[requestId,userId,scope,receipt.id]);
  }
  private async notePrivacyScopeFailure(client:pg.PoolClient,userId:string,requestId:string,scope:string,status:'owner_unavailable'|'snapshot_changed'|'limit_exceeded'|'attribution_missing'|'pending',errorCode:string){
    await client.query("UPDATE privacy_request_scopes s SET status=CASE WHEN $4 IN ('snapshot_changed','limit_exceeded','attribution_missing') THEN $4 WHEN s.current_receipt_id IS NOT NULL THEN 'prepared' ELSE $4 END,current_receipt_id=CASE WHEN $4 IN ('snapshot_changed','limit_exceeded','attribution_missing') THEN NULL ELSE s.current_receipt_id END,last_error_code=$5,attempts=attempts+1,updated_at=now() FROM privacy_requests p WHERE s.request_id=$1 AND p.id=s.request_id AND p.user_id=$2 AND p.kind='export' AND p.state IN ('requested','processing') AND s.scope=$3 AND s.required AND s.supported",[requestId,userId,scope,status,errorCode]);
  }
  private async notePrivacyScopeFailureOutsideTransaction(userId:string,requestId:string,scope:string,status:'owner_unavailable'|'snapshot_changed'|'limit_exceeded'|'attribution_missing'|'pending',errorCode:string){
    const client=await this.pool.connect();try{await client.query('BEGIN');await this.notePrivacyScopeFailure(client,userId,requestId,scope,status,errorCode);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  private async recordPrivacyScopeReceiptOutsideTransaction(userId:string,requestId:string,scope:string,ownerReceiptId:string,sha256:string,capturedAt:string|null){
    const client=await this.pool.connect();try{await client.query('BEGIN');await this.recordPrivacyScopeReceipt(client,userId,requestId,scope,ownerReceiptId,sha256,capturedAt);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async privacy(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(
      z
        .object({
          kind: z.enum(["export", "deletion"]),
          password: z.string().min(1).max(128),
          factor: z
            .string()
            .regex(/^(\d{6}|[a-f0-9]{24})$/)
            .optional(),
        })
        .strict(),
      input,
    );
    return this.sensitive(req, data.password, async (client, user) => {
      await this.mfa.verify(client, user.id, data.factor);
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO privacy_requests(id,user_id,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
        [randomUUID(), user.id, data.kind],
      );
      const row =
        inserted.rows[0] ??
        (
          await client.query<{ id: string }>(
            "SELECT id FROM privacy_requests WHERE user_id=$1 AND kind=$2 AND state='requested'",
            [user.id, data.kind],
          )
        ).rows[0]!;
      if(data.kind==='export')await this.ensurePrivacyScopes(client,row.id);
      if (inserted.rows[0])
        await this.audit(
          client,
          user.id,
          `privacy.${data.kind}_requested`,
          req,
        );
      return {
        id: row.id,
        kind: data.kind,
        state: "requested",
        fulfillment: "pending",
      };
    });
  }
  async privacyProfileExport(req:Request,requestId:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);
    const data=body(privacyProfileProof,input),key=body(z.uuid(),req.headers['idempotency-key']);
    const result=await this.sensitive(req,data.password,async(client,user)=>{
      await this.mfa.verify(client,user.id,data.factor);
      const prepared=await preparePrivacyProfile(client,user.id,requestId,key,correlationId);
      if(prepared.changed)await this.notePrivacyScopeFailure(client,user.id,requestId,'identity-profile-v1','snapshot_changed','SNAPSHOT_CHANGED');
      else await this.recordPrivacyScopeReceipt(client,user.id,requestId,'identity-profile-v1',prepared.value.receiptId,prepared.value.sha256,null);
      return prepared;
    });
    if(result.changed)throw new ConflictException({code:'PRIVACY_SNAPSHOT_CHANGED'});
    return result.value;
  }
  async privacyWorkspaceExport(req:Request,requestId:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);
    const data=body(privacyProfileProof,input),key=body(z.uuid(),req.headers['idempotency-key']);
    const authority=await this.sensitive(req,data.password,async(client,user)=>{
      await this.mfa.verify(client,user.id,data.factor);
      const capability=await issueWorkspaceCapability(client,user.id,requestId,cookie(req,'access'),key,correlationId);
      return {capability,userId:user.id};
    });
    // Proof commits before the owner calls back to validate this capability.
    // Never retain a user transaction/lock across an owner HTTP request.
    let raw:unknown;try{raw=await internalJson<unknown>(this.config.WORKSPACE_URL,'/v1/internal/privacy-workspace-export',this.config,{capability:authority.capability,idempotencyKey:key,correlationId},true);}catch(error){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'workspace-memberships-v1','owner_unavailable',error instanceof ServiceUnavailableException?'OWNER_UNAVAILABLE':'OWNER_REJECTED');throw error;}
    const parsed=privacyWorkspaceResult.safeParse(raw);
    if(!parsed.success||parsed.data.requestId!==requestId){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'workspace-memberships-v1','pending','INVALID_OWNER_RECEIPT');throw new ServiceUnavailableException();}
    const result=parsed.data;
    if(result.state==='snapshot_changed'){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'workspace-memberships-v1','snapshot_changed','SNAPSHOT_CHANGED');throw new ConflictException({code:'PRIVACY_SNAPSHOT_CHANGED'});}
    if(result.state==='limit_exceeded'){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'workspace-memberships-v1','limit_exceeded','SCOPE_TOO_LARGE');throw new PayloadTooLargeException({code:'PRIVACY_EXPORT_SCOPE_TOO_LARGE'});}
    if(result.data.subjectId!==authority.userId){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'workspace-memberships-v1','pending','INVALID_OWNER_RECEIPT');throw new ServiceUnavailableException();}
    await this.recordPrivacyScopeReceiptOutsideTransaction(authority.userId,requestId,'workspace-memberships-v1',result.receiptId,result.sha256,result.capturedAt);
    return result;
  }
  async privacyWorkspaceAuthority(req:Request,input:unknown){
    requireInternal(req,this.config);
    return authorizeWorkspaceCapability(this.pool,body(privacyWorkspaceAuthorityRequest,input));
  }
  async privacyProjectExport(req:Request,requestId:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);
    const data=body(privacyProfileProof,input),key=body(z.uuid(),req.headers['idempotency-key']);
    const authority=await this.sensitive(req,data.password,async(client,user)=>{
      await this.mfa.verify(client,user.id,data.factor);
      const capability=await issueProjectCapability(client,user.id,requestId,cookie(req,'access'),key,correlationId);
      return {capability,userId:user.id};
    });
    let raw:unknown;try{raw=await internalJson<unknown>(process.env['PROJECT_URL']??'http://127.0.0.1:3004','/v1/internal/privacy-project-export',this.config,{capability:authority.capability,idempotencyKey:key,correlationId},true);}catch(error){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'project-attribution-v1','owner_unavailable',error instanceof ServiceUnavailableException?'OWNER_UNAVAILABLE':'OWNER_REJECTED');throw error;}
    const parsed=privacyProjectResult.safeParse(raw);
    if(!parsed.success||parsed.data.requestId!==requestId){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'project-attribution-v1','pending','INVALID_OWNER_RECEIPT');throw new ServiceUnavailableException();}
    const result=parsed.data;
    if(result.state==='snapshot_changed'){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'project-attribution-v1','snapshot_changed','SNAPSHOT_CHANGED');throw new ConflictException({code:'PRIVACY_SNAPSHOT_CHANGED'});}
    if(result.state==='limit_exceeded'){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'project-attribution-v1','limit_exceeded','SCOPE_TOO_LARGE');throw new PayloadTooLargeException({code:'PRIVACY_EXPORT_SCOPE_TOO_LARGE'});}
    if(result.data.subjectId!==authority.userId){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'project-attribution-v1','pending','INVALID_OWNER_RECEIPT');throw new ServiceUnavailableException();}
    await this.recordPrivacyScopeReceiptOutsideTransaction(authority.userId,requestId,'project-attribution-v1',result.receiptId,result.sha256,result.capturedAt);
    return result;
  }
  async privacyProjectAuthority(req:Request,input:unknown){
    requireInternal(req,this.config);
    return authorizeProjectCapability(this.pool,body(privacyProjectAuthorityRequest,input));
  }
  async privacyBillingExport(req:Request,requestId:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);
    const data=body(privacyProfileProof,input),key=body(z.uuid(),req.headers['idempotency-key']);
    const authority=await this.sensitive(req,data.password,async(client,user)=>{
      await this.mfa.verify(client,user.id,data.factor);
      const capability=await issueBillingCapability(client,user.id,requestId,cookie(req,'access'),key,correlationId);
      return{capability,userId:user.id};
    });
    let raw:unknown;try{raw=await internalJson<unknown>(process.env['BILLING_URL']??'http://127.0.0.1:3007','/v1/internal/privacy-billing-export',this.config,{capability:authority.capability,idempotencyKey:key,correlationId},true);}catch(error){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'consumption-attribution-v1','owner_unavailable',error instanceof ServiceUnavailableException?'OWNER_UNAVAILABLE':'OWNER_REJECTED');throw error;}
    const parsed=privacyBillingResult.safeParse(raw);
    if(!parsed.success||parsed.data.requestId!==requestId){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'consumption-attribution-v1','pending','INVALID_OWNER_RECEIPT');throw new ServiceUnavailableException();}
    const result=parsed.data;
    if(result.state==='snapshot_changed'){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'consumption-attribution-v1','snapshot_changed','SNAPSHOT_CHANGED');throw new ConflictException({code:'PRIVACY_SNAPSHOT_CHANGED'});}
    if(result.state==='limit_exceeded'){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'consumption-attribution-v1','limit_exceeded','SCOPE_TOO_LARGE');throw new PayloadTooLargeException({code:'PRIVACY_EXPORT_SCOPE_TOO_LARGE'});}
    if(result.data.subjectId!==authority.userId){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,'consumption-attribution-v1','pending','INVALID_OWNER_RECEIPT');throw new ServiceUnavailableException();}
    await this.recordPrivacyScopeReceiptOutsideTransaction(authority.userId,requestId,'consumption-attribution-v1',result.receiptId,result.sha256,result.capturedAt);
    return result;
  }
  async privacyBillingAuthority(req:Request,input:unknown){
    requireInternal(req,this.config);
    return authorizeBillingCapability(this.pool,body(privacyBillingAuthorityRequest,input));
  }
  private async privacyTaskExport(req:Request,requestId:string,input:unknown,correlationId:string,scope:TaskPrivacyScope){
    requireCsrf(req,this.config);
    const data=body(privacyProfileProof,input),key=body(z.uuid(),req.headers['idempotency-key']);
    const authority=await this.sensitive(req,data.password,async(client,user)=>{
      await this.mfa.verify(client,user.id,data.factor);
      const capability=await issueTaskPrivacyCapability(client,user.id,requestId,cookie(req,'access'),key,correlationId,scope);
      return{capability,userId:user.id};
    });
    const media=scope==='media-task-attribution-v1';
    const url=media?process.env['MEDIA_URL']??'http://127.0.0.1:3003':process.env['ANALYSIS_URL']??'http://127.0.0.1:3005';
    const path=media?'/v1/internal/privacy-media-export':'/v1/internal/privacy-analysis-export';
    let raw:unknown;try{raw=await internalJson<unknown>(url,path,this.config,{capability:authority.capability,idempotencyKey:key,correlationId},true);}catch(error){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,scope,'owner_unavailable',error instanceof ServiceUnavailableException?'OWNER_UNAVAILABLE':'OWNER_REJECTED');throw error;}
    const parsed=media?privacyMediaResult.safeParse(raw):privacyAnalysisResult.safeParse(raw);
    if(!parsed.success||parsed.data.requestId!==requestId){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,scope,'pending','INVALID_OWNER_RECEIPT');throw new ServiceUnavailableException();}
    const result=parsed.data;
    if(result.state==='snapshot_changed'){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,scope,'snapshot_changed','SNAPSHOT_CHANGED');throw new ConflictException({code:'PRIVACY_SNAPSHOT_CHANGED'});}
    if(result.state==='limit_exceeded'){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,scope,'limit_exceeded','SCOPE_TOO_LARGE');throw new PayloadTooLargeException({code:'PRIVACY_EXPORT_SCOPE_TOO_LARGE'});}
    if(result.state==='attribution_missing'){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,scope,'attribution_missing','ATTRIBUTION_MISSING');throw new ConflictException({code:'PRIVACY_ATTRIBUTION_MISSING'});}
    if(result.data.subjectId!==authority.userId){await this.notePrivacyScopeFailureOutsideTransaction(authority.userId,requestId,scope,'pending','INVALID_OWNER_RECEIPT');throw new ServiceUnavailableException();}
    await this.recordPrivacyScopeReceiptOutsideTransaction(authority.userId,requestId,scope,result.receiptId,result.sha256,result.capturedAt);
    return result;
  }
  privacyMediaExport(req:Request,requestId:string,input:unknown,correlationId:string){return this.privacyTaskExport(req,requestId,input,correlationId,'media-task-attribution-v1');}
  privacyAnalysisExport(req:Request,requestId:string,input:unknown,correlationId:string){return this.privacyTaskExport(req,requestId,input,correlationId,'analysis-attribution-v1');}
  privacyMediaAuthority(req:Request,input:unknown){requireInternal(req,this.config);return authorizeTaskPrivacyCapability(this.pool,body(privacyMediaAuthorityRequest,input));}
  privacyAnalysisAuthority(req:Request,input:unknown){requireInternal(req,this.config);return authorizeTaskPrivacyCapability(this.pool,body(privacyAnalysisAuthorityRequest,input));}
  async privacyRequests(req: Request) {
    const user = await this.me(req);
    return {
      items: (
        await this.pool.query(
          "SELECT id,kind,state,created_at,completed_at FROM privacy_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [user.id],
        )
      ).rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        state: row.state,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      })),
    };
  }
  async privacyDeletionStatus(req:Request,requestId:string){
    const user=await this.me(req);
    return this.tx(async client=>{
      const row=(await client.query<{id:string;state:string;created_at:Date}>(
        "SELECT id,state,created_at FROM privacy_requests WHERE id=$1 AND user_id=$2 AND kind='deletion'",
        [requestId,user.id],
      )).rows[0];
      if(!row)throw new NotFoundException();
      await this.audit(client,user.id,"privacy.deletion_status_viewed",req);
      return{
        id:row.id,
        kind:"deletion" as const,
        requestState:row.state,
        fulfillment:"pending" as const,
        purgeCompleted:false as const,
        deletionExecutor:"not_implemented" as const,
        createdAt:row.created_at.toISOString(),
      };
    });
  }
  async privacyRequestManifest(req:Request,requestId:string){
    const user=await this.me(req),request=(await this.pool.query<{kind:string;state:string}>("SELECT kind,state FROM privacy_requests WHERE id=$1 AND user_id=$2",[requestId,user.id])).rows[0];
    if(!request)throw new NotFoundException();
    if(request.kind!=='export'||!['requested','processing'].includes(request.state))throw new ConflictException({code:'PRIVACY_EXPORT_NOT_PENDING'});
    const rows=(await this.pool.query<{scope:string;required:boolean;supported:boolean;status:string;receipt_id:string|null;sha256:string|null;captured_at:Date|null;last_error_code:string|null;attempts:number}>(
      `SELECT s.scope,s.required,s.supported,s.status,r.owner_receipt_id AS receipt_id,r.content_sha256 AS sha256,r.captured_at,s.last_error_code,s.attempts
       FROM privacy_request_scopes s LEFT JOIN privacy_scope_receipts r ON r.id=s.current_receipt_id
       WHERE s.request_id=$1 ORDER BY s.scope`,[requestId])).rows;
    const required=rows.filter(row=>row.required),prepared=required.filter(row=>row.status==='prepared'&&row.receipt_id!==null&&row.sha256!==null);
    return body(privacyRequestManifest,{requestId,kind:request.kind,requestState:request.state,globalFulfillment:required.length>0&&prepared.length===required.length?'ready_for_assembly':'pending',requiredScopes:required.length,preparedScopes:prepared.length,scopes:rows.map(row=>({scope:row.scope,required:row.required,supported:row.supported,status:row.status,receiptId:row.receipt_id,sha256:row.sha256,capturedAt:row.captured_at?.toISOString()??null,lastErrorCode:row.last_error_code,attempts:row.attempts}))});
  }
  async internal(req: Request, input: unknown) {
    requireInternal(req, this.config);
    const data = body(token, input);
    return this.authenticate(data.token);
  }
  async sendInvitation(req: Request, input: unknown) {
    requireInternal(req, this.config);
    const data = body(
      z
        .object({
          deliveryId: z.uuid(),
          to: z.email().max(254),
          workspaceName: z.string().max(100),
          token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        })
        .strict(),
      input,
    );
    const payload = {
      to: data.to,
      subject: "Invitación a un equipo de AutoClipper",
      text: `Has sido invitado al equipo ${data.workspaceName}.\n${this.config.CORS_ORIGIN}/auth/invitation?token=${data.token}\nLa invitación vence en siete días.`,
    };
    await this.pool.query(
      "INSERT INTO mail_outbox(id,payload) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
      [data.deliveryId, seal(JSON.stringify(payload), this.encryptionKey)],
    );
    return { accepted: true };
  }
  async refresh(req: Request, res: Response) {
    requireCsrf(req, this.config);
    await this.limit(req, "refresh");
    const raw = cookie(req, "refresh");
    const next = opaqueToken(),
      access = opaqueToken();
    const outcome = await this.tx(async (client) => {
      const result = await client.query<SessionRow>(
        "SELECT s.id,s.user_id,s.revoked_at,s.expires_at,r.token_hash AS refresh_hash,r.consumed_at FROM refresh_tokens r JOIN sessions s ON s.id=r.session_id WHERE r.token_hash=$1 AND r.expires_at>now() FOR UPDATE OF s,r",
        [digest(raw)],
      );
      const row = result.rows[0];
      if (!row || row.revoked_at || row.expires_at <= new Date()) return false;
      if (row.consumed_at) {
        await client.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
          row.id,
        ]);
        await this.audit(client, row.user_id, "session.refresh_reuse", req);
        return false;
      }
      await client.query(
        "UPDATE refresh_tokens SET consumed_at=now() WHERE token_hash=$1",
        [digest(raw)],
      );
      await client.query(
        "INSERT INTO refresh_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)",
        [digest(next), row.id, row.expires_at],
      );
      await client.query(
        "INSERT INTO access_tokens(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')",
        [digest(access), row.id],
      );
      return true;
    });
    if (!outcome) {
      clearCookies(res);
      throw new UnauthorizedException();
    }
    setCookie(res, "access", access, 900000);
    setCookie(res, "refresh", next, 2592000000);
    return { renewed: true };
  }
  async logout(req: Request, res: Response) {
    requireCsrf(req, this.config);
    await this.pool.query(
      "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id IN (SELECT session_id FROM refresh_tokens WHERE token_hash=$1 UNION SELECT session_id FROM access_tokens WHERE token_hash=$2)",
      [digest(cookie(req, "refresh")), digest(cookie(req, "access"))],
    );
    clearCookies(res);
    return { revoked: true };
  }
  async sessions(req: Request) {
    const user = await this.me(req);
    const result = await this.pool.query(
      "SELECT id,created_at,expires_at,revoked_at FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [user.id],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      })),
    };
  }
  async revoke(req: Request, id: string) {
    requireCsrf(req, this.config);
    const user = await this.me(req);
    await this.pool.query(
      "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2",
      [id, user.id],
    );
    return { revoked: true };
  }
  async requestReset(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(resetRequest, input);
    await this.limit(req, data.email);
    await this.tx(async (client) => {
      const result = await client.query<UserRow>(
        "SELECT * FROM users WHERE email=$1 AND verified_at IS NOT NULL",
        [data.email],
      );
      if (result.rows[0]) await this.mail(client, result.rows[0], "reset");
    });
    return { accepted: true };
  }
  async resetPassword(req: Request, res: Response, input: unknown) {
    requireCsrf(req, this.config);
    const data = body(reset, input);
    await this.limit(req, "reset");
    const hash = await this.hash(data.password);
    await this.tx(async (client) => {
      const result = await client.query<{ user_id: string }>(
        "UPDATE verification_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='reset' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id",
        [digest(data.token)],
      );
      const row = result.rows[0];
      if (!row) throw new UnauthorizedException();
      await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        hash,
        row.user_id,
      ]);
      await client.query(
        "UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
        [row.user_id],
      );
      await client.query(
        "UPDATE verification_tokens SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND purpose='reset'",
        [row.user_id],
      );
      await this.audit(client, row.user_id, "password.reset", req);
    });
    clearCookies(res);
    return { reset: true };
  }
  private async deliver() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; payload: string }>(
        "SELECT id,payload FROM mail_outbox WHERE delivered_at IS NULL AND attempts<5 AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      const row = result.rows[0];
      if (row) {
        try {
          const payload = JSON.parse(
            unseal(row.payload, this.encryptionKey),
          ) as { to: string; subject: string; text: string };
          await this.transport.sendMail({
            from:
              process.env["SMTP_FROM"] ??
              "AutoClipper <no-reply@autoclipper.test>",
            ...payload,
          });
          await client.query(
            "UPDATE mail_outbox SET delivered_at=now(),payload='delivered' WHERE id=$1",
            [row.id],
          );
        } catch {
          await client.query(
            "UPDATE mail_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '10 seconds' * power(2,attempts) WHERE id=$1",
            [row.id],
          );
          logger.warn({ code: "MAIL_RETRY", messageId: row.id });
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async pruneExpiredPrivacyCapabilities(){
    await this.pool.query("SELECT reap_expired_privacy_capabilities($1)",[250]);
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.privacyCapabilityTimer) clearInterval(this.privacyCapabilityTimer);
    if (this.twitchValidationTimer) clearInterval(this.twitchValidationTimer);
    await this.sending;
    await this.pruningPrivacyCapabilities;
    this.transport.close();
    this.redis.disconnect();
    await this.pool.end();
  }
  private async audit(
    client: pg.PoolClient,
    userId: string,
    action: string,
    req: Request,
  ) {
    await client.query(
      "INSERT INTO security_audit(id,user_id,action,correlation_id) VALUES($1,$2,$3,$4)",
      [
        randomUUID(),
        userId,
        action,
        String(req.res?.locals["correlationId"] ?? randomUUID()),
      ],
    );
  }
  async securityEvents(req: Request) {
    const user = await this.me(req);
    return {
      items: (
        await this.pool.query(
          "SELECT id,action,correlation_id,created_at FROM security_audit WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
          [user.id],
        )
      ).rows.map((row) => ({
        id: row.id,
        action: row.action,
        correlationId: row.correlation_id,
        createdAt: row.created_at,
      })),
    };
  }
}
