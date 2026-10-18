import {BadRequestException,ForbiddenException,HttpException,UnauthorizedException} from "@nestjs/common";
import type {Request} from "express";
import type pg from "pg";
import type {Redis} from "ioredis";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {adminAuthority,adminPage,adminPermission,adminSessionToken,adminUsersPage,adminWorkspacesPage,adminJobsPage,adminConsumptionPage,type AdminPermission} from "@autoclipper/api-contracts";
import {body,cookie,digest,internalJson,same,type ServiceConfig} from "@autoclipper/http-security";
import type {MfaManager} from "./mfa.manager.js";

type Session={user_id:string;id:string};
type Grant={permissions:AdminPermission[];workspace_ids:string[]|null;revision:number;revoked_at:Date|null;enabled:boolean;verified_at:Date|null;expires_at:Date|null;grant_revision:number|null};
export class AdminManager {
  constructor(private readonly pool:pg.Pool,private readonly config:ServiceConfig,private readonly redis:Redis){}
  async boundary(req:Request){
    const credential=req.headers["x-service-token"],forwarded=req.headers["x-client-ip"];
    const remote=typeof credential==="string"&&same(credential,this.config.INTERNAL_TOKEN)&&typeof forwarded==="string"?forwarded:req.ip;
    const count=Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,`admin:boundary:${digest(remote??"unknown")}`));
    if(count>120)throw new HttpException("Rate limited",429);
  }
  private token(req:Request){const value=cookie(req,"access");if(!adminSessionToken.safeParse(value).success)throw new UnauthorizedException();return value;}
  private async session(token:string,client:pg.Pool|pg.PoolClient=this.pool){
    if(!adminSessionToken.safeParse(token).success)throw new UnauthorizedException();
    const row=(await client.query<Session>("SELECT s.id,s.user_id FROM access_tokens a JOIN sessions s ON s.id=a.session_id WHERE a.token_hash=$1 AND a.expires_at>now() AND s.expires_at>now() AND s.revoked_at IS NULL",[digest(token)])).rows[0];
    if(!row)throw new UnauthorizedException();return row;
  }
  async audit(client:pg.Pool|pg.PoolClient,actorId:string|null,permission:AdminPermission|null,workspaceId:string|undefined,outcome:"allowed"|"denied"|"reauthenticated"|"reauth_denied",correlationId:string,grantRevision:number|null=null){
    await client.query("INSERT INTO admin_access_audit(id,actor_user_id,permission,workspace_id,outcome,correlation_id,grant_revision) VALUES($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),actorId,permission,workspaceId??null,outcome,correlationId,grantRevision]);
  }
  private async grant(session:Session,client:pg.Pool|pg.PoolClient=this.pool){
    return(await client.query<Grant>("SELECT g.permissions,g.workspace_ids,g.revision,g.revoked_at,m.enabled,u.verified_at,e.expires_at,e.grant_revision FROM users u LEFT JOIN admin_grants g ON g.user_id=u.id LEFT JOIN user_mfa m ON m.user_id=u.id LEFT JOIN admin_elevations e ON e.session_id=$2 WHERE u.id=$1",[session.user_id,session.id])).rows[0];
  }
  private active(grant:Grant|undefined):grant is Grant{return !!grant?.revision&&!grant.revoked_at&&grant.enabled&&!!grant.verified_at;}
  async access(req:Request){await this.boundary(req);const session=await this.session(cookie(req,"access")),grant=await this.grant(session),granted=this.active(grant);return{granted,mfaEnabled:grant?.enabled??false,permissions:granted?grant.permissions:[],workspaceIds:granted?grant.workspace_ids:[],elevatedUntil:granted&&grant.grant_revision===grant.revision&&grant.expires_at&&grant.expires_at>new Date()?grant.expires_at.toISOString():null};}
  async elevate(client:pg.PoolClient,req:Request,userId:string,factor:string,mfa:MfaManager,correlationId:string){
    const session=await this.session(cookie(req,"access"),client);if(session.user_id!==userId)throw new UnauthorizedException();
    // The runtime has SELECT only on grants. A concurrent operator change
    // invalidates this elevation through the revision checked on every read.
    const grant=await this.grant(session,client);if(!this.active(grant))throw new ForbiddenException();
    await mfa.verify(client,userId,factor);
    const row=(await client.query<{expires_at:Date}>("INSERT INTO admin_elevations(session_id,grant_revision,expires_at) VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT(session_id) DO UPDATE SET grant_revision=EXCLUDED.grant_revision,expires_at=EXCLUDED.expires_at RETURNING expires_at",[session.id,grant.revision])).rows[0]!;
    await this.audit(client,userId,null,undefined,"reauthenticated",correlationId,grant.revision);return{elevatedUntil:row.expires_at.toISOString()};
  }
  async authorize(input:unknown){
    const data=body(z.object({token:adminSessionToken,permission:adminPermission,workspaceId:z.uuid().optional(),correlationId:z.uuid()}).strict(),input);let actorId:string|null=null;
    try{
      const session=await this.session(data.token);actorId=session.user_id;
      const count=Number(await this.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,`admin:reads:${digest(actorId)}`));
      if(count>30)throw new HttpException("Rate limited",429);
      const grant=await this.grant(session);
      if(!this.active(grant)||!grant.permissions.includes(data.permission)||grant.grant_revision!==grant.revision||!grant.expires_at||grant.expires_at<=new Date())throw new ForbiddenException();
      if((data.permission==="users.read"&&grant.workspace_ids!==null)||(data.workspaceId&&grant.workspace_ids!==null&&!grant.workspace_ids.includes(data.workspaceId)))throw new ForbiddenException();
      await this.audit(this.pool,actorId,data.permission,data.workspaceId,"allowed",data.correlationId,grant.revision);
      return body(adminAuthority,{actorId,grantRevision:grant.revision,workspaceIds:grant.workspace_ids});
    }catch(error){await this.audit(this.pool,actorId,data.permission,data.workspaceId,"denied",data.correlationId);throw error;}
  }
  async users(req:Request,input:unknown,correlationId:string){
    await this.boundary(req);
    const query=body(adminPage,input);if(query.workspaceId)throw new BadRequestException();
    await this.authorize({token:this.token(req),permission:"users.read",correlationId});
    const rows=(await this.pool.query<{id:string;verified:boolean;mfa_enabled:boolean;created_at:Date}>("SELECT u.id,u.verified_at IS NOT NULL AS verified,COALESCE(m.enabled,false) AS mfa_enabled,u.created_at FROM users u LEFT JOIN user_mfa m ON m.user_id=u.id WHERE ($1::uuid IS NULL OR u.id<$1) ORDER BY u.id DESC LIMIT $2",[query.beforeId??null,query.limit+1])).rows;
    const items=rows.slice(0,query.limit).map(row=>({id:row.id,verified:row.verified,mfaEnabled:row.mfa_enabled,createdAt:row.created_at.toISOString()}));return body(adminUsersPage,{items,nextBeforeId:rows.length>query.limit?items.at(-1)!.id:null});
  }
  async forward(req:Request,permission:Exclude<AdminPermission,"users.read">,input:unknown,correlationId:string){
    await this.boundary(req);
    const query=body(adminPage,input),token=this.token(req);
    const target=permission==="workspaces.read"?{url:this.config.WORKSPACE_URL,path:"/v1/internal/admin-workspaces"}:permission==="jobs.read"?{url:process.env["PROJECT_URL"]??"http://127.0.0.1:3004",path:"/v1/internal/admin-jobs"}:{url:process.env["BILLING_URL"]??"http://127.0.0.1:3007",path:"/v1/internal/admin-consumption"};
    const value=await internalJson(target.url,target.path,this.config,{token,query,correlationId},true);
    return permission==="workspaces.read"?body(adminWorkspacesPage,value):permission==="jobs.read"?body(adminJobsPage,value):body(adminConsumptionPage,value);
  }
}
