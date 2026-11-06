import { ServiceUnavailableException, UnauthorizedException, ForbiddenException, NotFoundException, HttpException } from "@nestjs/common";

export const TWITCH_CLIP_SCOPES = ["editor:manage:clips", "channel:manage:clips"] as const;
export const TWITCH_CLIP_SCOPE = TWITCH_CLIP_SCOPES.join(" ");
// Fixed Redis minute bucket measured in worst-case Helix calls. A clip download
// reserves four calls (clip lookup + download lookup, repeated once after a
// token refresh). A VOD-clip creation reserves two more (VOD lookup + POST).
// The 48-call bucket can therefore use at most 96 Helix requests in any rolling
// 60-second window across a fixed-minute boundary, below Twitch's 100/minute cap.
export const TWITCH_HELIX_REQUEST_BUDGET_PER_FIXED_MINUTE = 48;
export const TWITCH_CLIP_DOWNLOAD_HELIX_REQUEST_BUDGET = 4;
export const TWITCH_VOD_CLIP_CREATE_HELIX_REQUEST_BUDGET = 2;
export function hasTwitchClipScope(scopes: readonly string[]) {
  return TWITCH_CLIP_SCOPES.some(scope => scopes.includes(scope));
}
const API = "https://api.twitch.tv/helix";
const OAUTH = "https://id.twitch.tv/oauth2";
const timeout = () => AbortSignal.timeout(8000);
const TWITCH_VOD_ID = /^\d{1,20}$/u;
const TWITCH_CLIP_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function parseTwitchDuration(value: unknown) {
  if(typeof value!=="string") return null;
  const match=/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(value);
  if(!match||(!match[1]&&!match[2]&&!match[3])) return null;
  const seconds=Number(match[1]??0)*3600+Number(match[2]??0)*60+Number(match[3]??0);
  return Number.isSafeInteger(seconds)&&seconds>0?seconds:null;
}

export type TwitchTokens = { accessToken: string; refreshToken: string; expiresIn: number; scopes: string[] };
export type TwitchValidation = { userId: string; login: string; clientId: string; scopes: string[]; expiresIn: number };

export class TwitchAdapter {
  readonly clientId = process.env["TWITCH_CLIENT_ID"] ?? "";
  readonly clientSecret = process.env["TWITCH_CLIENT_SECRET"] ?? "";
  readonly redirectUri = process.env["TWITCH_REDIRECT_URI"] ?? "";
  get configured() { return Boolean(this.clientId && this.clientSecret && this.redirectUri && this.validConfiguration()); }
  private validConfiguration() {
    try {
      const redirect = new URL(this.redirectUri);
      const secure = redirect.protocol === "https:" || (redirect.protocol === "http:" && ["localhost", "127.0.0.1"].includes(redirect.hostname));
      return secure && !redirect.username && !redirect.password && !redirect.search && !redirect.hash && redirect.pathname === "/v1/auth/twitch/callback";
    } catch { return false; }
  }
  requireConfigured() {
    if (!this.configured) throw new ServiceUnavailableException({ code: "TWITCH_OAUTH_NOT_CONFIGURED" });
  }
  authorizationUrl(state: string) {
    this.requireConfigured();
    const url = new URL(`${OAUTH}/authorize`);
    url.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirectUri, response_type: "code", scope: TWITCH_CLIP_SCOPE, state, force_verify: "true" }).toString();
    return url.toString();
  }
  async exchange(code: string): Promise<TwitchTokens> {
    this.requireConfigured();
    const form = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, code, grant_type: "authorization_code", redirect_uri: this.redirectUri });
    return this.tokens(await fetch(`${OAUTH}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: timeout(), redirect: "error" }));
  }
  async refresh(refreshToken: string): Promise<TwitchTokens> {
    this.requireConfigured();
    const form = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
    return this.tokens(await fetch(`${OAUTH}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: timeout(), redirect: "error" }));
  }
  private async tokens(response: Response): Promise<TwitchTokens> {
    if (!response.ok) throw new UnauthorizedException({ code: "TWITCH_OAUTH_EXCHANGE_FAILED" });
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") throw new UnauthorizedException();
    const data = value as Record<string, unknown>;
    if (typeof data["access_token"] !== "string" || typeof data["refresh_token"] !== "string" || typeof data["expires_in"] !== "number" || !Array.isArray(data["scope"]) || !data["scope"].every(scope => typeof scope === "string")) throw new UnauthorizedException();
    const scopes = data["scope"] as string[];
    if (!hasTwitchClipScope(scopes)) throw new ForbiddenException({ code: "TWITCH_CLIP_SCOPE_REQUIRED" });
    return { accessToken: data["access_token"], refreshToken: data["refresh_token"], expiresIn: data["expires_in"], scopes };
  }
  async validate(accessToken: string): Promise<TwitchValidation> {
    this.requireConfigured();
    const response = await fetch(`${OAUTH}/validate`, { headers: { authorization: `OAuth ${accessToken}` }, signal: timeout(), redirect: "error" });
    if (!response.ok) throw new UnauthorizedException({ code: "TWITCH_TOKEN_INVALID" });
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") throw new UnauthorizedException();
    const data = value as Record<string, unknown>;
    if (data["client_id"] !== this.clientId || typeof data["user_id"] !== "string" || typeof data["login"] !== "string" || typeof data["expires_in"] !== "number" || !Array.isArray(data["scopes"]) || !(data["scopes"] as unknown[]).every(scope => typeof scope === "string")) throw new UnauthorizedException({ code: "TWITCH_TOKEN_INVALID" });
    const scopes = data["scopes"] as string[];
    if (!hasTwitchClipScope(scopes)) throw new ForbiddenException({ code: "TWITCH_CLIP_SCOPE_REQUIRED" });
    return { userId: data["user_id"], login: data["login"], clientId: this.clientId, scopes, expiresIn: data["expires_in"] };
  }
  async createVodClip(accessToken:string,userId:string,vodId:string,vodOffsetSeconds:number,durationSeconds:number,title:string) {
    if(!TWITCH_VOD_ID.test(vodId)||!Number.isSafeInteger(vodOffsetSeconds)||!Number.isSafeInteger(durationSeconds)||durationSeconds<5||durationSeconds>60||vodOffsetSeconds<durationSeconds||!title.trim()||title.length>140) {
      throw new HttpException({code:"TWITCH_VOD_INTERVAL_INVALID"},400);
    }
    const headers={authorization:`Bearer ${accessToken}`,"client-id":this.clientId};
    const metadataUrl=new URL(`${API}/videos`);metadataUrl.searchParams.set("id",vodId);
    const metadataResponse=await fetch(metadataUrl,{headers,signal:timeout(),redirect:"error"});
    if(metadataResponse.status===401)throw new UnauthorizedException({code:"TWITCH_TOKEN_INVALID"});
    if(metadataResponse.status===429)throw new HttpException({code:"TWITCH_RATE_LIMITED"},429);
    if(metadataResponse.status===404)throw new NotFoundException({code:"TWITCH_VOD_NOT_FOUND"});
    if(!metadataResponse.ok)throw new ServiceUnavailableException({code:"TWITCH_VOD_LOOKUP_FAILED"});
    const metadataBody:unknown=await metadataResponse.json();
    const video=metadataBody&&typeof metadataBody==="object"&&Array.isArray((metadataBody as Record<string,unknown>)["data"])?((metadataBody as {data:unknown[]}).data[0] as Record<string,unknown>|undefined):undefined;
    if(!video||video["id"]!==vodId||typeof video["user_id"]!=="string"||!/^\d{1,20}$/u.test(video["user_id"]))throw new NotFoundException({code:"TWITCH_VOD_NOT_FOUND"});
    const vodDuration=parseTwitchDuration(video["duration"]);
    if(vodDuration===null)throw new ServiceUnavailableException({code:"TWITCH_VOD_METADATA_INVALID"});
    if(vodOffsetSeconds>vodDuration)throw new HttpException({code:"TWITCH_VOD_OFFSET_OUT_OF_RANGE"},400);

    // This is an external side effect. Never automatically retry the POST after
    // a timeout or server error because Twitch may already have created a clip.
    const query=new URLSearchParams({broadcaster_id:video["user_id"],editor_id:userId,vod_id:vodId,vod_offset:String(vodOffsetSeconds),duration:String(durationSeconds),title:title.trim()});
    let createResponse:Response;
    try {createResponse=await fetch(`${API}/videos/clips?${query}`,{method:"POST",headers,signal:timeout(),redirect:"error"});}
    catch {throw new ServiceUnavailableException({code:"TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN"});}
    if(createResponse.status===401)throw new UnauthorizedException({code:"TWITCH_TOKEN_INVALID"});
    if(createResponse.status===403)throw new ForbiddenException({code:"TWITCH_CHANNEL_EDITOR_REQUIRED"});
    if(createResponse.status===404)throw new NotFoundException({code:"TWITCH_VOD_NOT_FOUND"});
    if(createResponse.status===429)throw new HttpException({code:"TWITCH_RATE_LIMITED"},429);
    if(createResponse.status>=500)throw new ServiceUnavailableException({code:"TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN"});
    if(!createResponse.ok)throw new HttpException({code:"TWITCH_VOD_INTERVAL_INVALID"},400);
    let createdBody:unknown;
    try { createdBody=await createResponse.json(); }
    catch { throw new ServiceUnavailableException({code:"TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN"}); }
    const created=createdBody&&typeof createdBody==="object"&&Array.isArray((createdBody as Record<string,unknown>)["data"])?((createdBody as {data:unknown[]}).data[0] as Record<string,unknown>|undefined):undefined;
    if(typeof created?.["id"]!=="string"||!TWITCH_CLIP_ID.test(created["id"]))throw new ServiceUnavailableException({code:"TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN"});
    return {clipId:created["id"],broadcasterId:video["user_id"],title:title.trim(),durationSeconds};
  }
  async clipDownload(accessToken: string, userId: string, slug: string) {
    const headers = { authorization: `Bearer ${accessToken}`, "client-id": this.clientId };
    const clipResponse = await fetch(`${API}/clips?id=${encodeURIComponent(slug)}`, { headers, signal: timeout(), redirect: "error" });
    if (clipResponse.status === 401) throw new UnauthorizedException({ code: "TWITCH_TOKEN_INVALID" });
    if (clipResponse.status === 429) throw new HttpException({ code: "TWITCH_RATE_LIMITED" }, 429);
    if (!clipResponse.ok) throw new ServiceUnavailableException({ code: "TWITCH_CLIP_LOOKUP_FAILED" });
    const clipBody: unknown = await clipResponse.json();
    const clip = clipBody && typeof clipBody === "object" && Array.isArray((clipBody as Record<string, unknown>)["data"]) ? ((clipBody as { data: unknown[] }).data[0] as Record<string, unknown> | undefined) : undefined;
    if (!clip || typeof clip["broadcaster_id"] !== "string" || clip["id"] !== slug) throw new NotFoundException({ code: "TWITCH_CLIP_NOT_FOUND" });
    if (typeof clip["duration"] !== "number" || clip["duration"] <= 0 || clip["duration"] > 60) throw new ForbiddenException({ code: "TWITCH_CLIP_DURATION_UNSUPPORTED" });
    const query = new URLSearchParams({ broadcaster_id: clip["broadcaster_id"], editor_id: userId });
    query.append("clip_id", slug);
    const downloadResponse = await fetch(`${API}/clips/downloads?${query}`, { headers, signal: timeout(), redirect: "error" });
    if (downloadResponse.status === 403) throw new ForbiddenException({ code: "TWITCH_CHANNEL_EDITOR_REQUIRED" });
    if (downloadResponse.status === 401) throw new UnauthorizedException({ code: "TWITCH_TOKEN_INVALID" });
    if (downloadResponse.status === 429) throw new HttpException({ code: "TWITCH_RATE_LIMITED" }, 429);
    if (!downloadResponse.ok) throw new ServiceUnavailableException({ code: "TWITCH_CLIP_DOWNLOAD_UNAVAILABLE" });
    const downloadBody: unknown = await downloadResponse.json();
    const item = downloadBody && typeof downloadBody === "object" && Array.isArray((downloadBody as Record<string, unknown>)["data"]) ? ((downloadBody as { data: unknown[] }).data[0] as Record<string, unknown> | undefined) : undefined;
    const selected = item?.["landscape_download_url"] ?? item?.["portrait_download_url"];
    if (item?.["clip_id"] !== slug || typeof selected !== "string") throw new NotFoundException({ code: "TWITCH_CLIP_DOWNLOAD_UNAVAILABLE" });
    const url = new URL(selected);
    if (url.protocol !== "https:" || url.hostname !== "production.assets.clips.twitchcdn.net" || url.username || url.password || url.port) throw new ServiceUnavailableException({ code: "TWITCH_DOWNLOAD_HOST_UNSUPPORTED" });
    return { broadcasterId: clip["broadcaster_id"], title: typeof clip["title"] === "string" ? clip["title"].slice(0, 150) : "Twitch clip", durationSeconds: clip["duration"], downloadUrl: url.toString() };
  }
}
