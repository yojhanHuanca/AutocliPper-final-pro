import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sourceLinkCapabilities, type SourceLinkCapabilities, type TwitchSourceCapabilityStatus } from "@autoclipper/api-contracts";

export type SourceLinkResolution =
  | { provider: "twitch"; kind: "clip"; clipId: string }
  | { provider: "twitch"; kind: "vod"; vodId: string }
  | { provider: "youtube"; kind: "video"; videoId: string; previewUrl: string }
  | { provider: "kick"; state: "unsupported"; reasonCode: "KICK_MEDIA_API_UNAVAILABLE" };

export type SourceLinkNextAction =
  | "upload_authorized_file"
  | "configure_twitch_oauth"
  | "link_twitch_account"
  | "connect_broadcaster_or_editor_account"
  | "retry_after_rate_limit"
  | "import_twitch_clip"
  | "import_twitch_vod_clip"
  | "contact_support";

export function sourceLinkGuidance(reasonCode: string): {nextAction:SourceLinkNextAction;message:string;nextStep:string} {
  switch(reasonCode) {
    case "YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED": return {nextAction:"upload_authorized_file",message:"AutoClipper no importa videos de YouTube desde una URL.",nextStep:"Sube el archivo original solo si tienes autorización para usarlo."};
    case "KICK_MEDIA_API_UNAVAILABLE": return {nextAction:"upload_authorized_file",message:"Kick documenta descargas manuales de clips y VOD propio, pero sus Términos restringen sistemas automatizados y accesos por tecnologías no autorizadas.",nextStep:"Carga el MP4 descargado desde Kick. AutoClipper necesita API de medios o autorización programática de Kick para importar URLs."};
    case "TWITCH_OAUTH_NOT_CONFIGURED": return {nextAction:"configure_twitch_oauth",message:"La importación de clips de Twitch no está configurada en este servidor.",nextStep:"Pide al responsable del entorno que configure la app OAuth de Twitch en Identity."};
    case "TWITCH_ACCOUNT_NOT_LINKED": return {nextAction:"link_twitch_account",message:"No hay una cuenta de Twitch vinculada.",nextStep:"Vincula tu cuenta desde Configuración y vuelve a validar el clip."};
    case "TWITCH_CHANNEL_EDITOR_REQUIRED": return {nextAction:"connect_broadcaster_or_editor_account",message:"La cuenta vinculada no tiene permiso para crear o descargar clips de este canal.",nextStep:"Vincula la cuenta del broadcaster o de un editor autorizado para este canal."};
    case "TWITCH_RATE_LIMITED": return {nextAction:"retry_after_rate_limit",message:"Twitch limitó temporalmente las solicitudes de descarga.",nextStep:"Espera un minuto y vuelve a intentarlo."};
    case "TWITCH_VOD_INTERVAL_REQUIRED": return {nextAction:"upload_authorized_file",message:"AutoClipper no puede seleccionar automáticamente momentos de un VOD de Twitch pegando solo su URL.",nextStep:"Usa la URL de un clip de Twitch ya publicado para importarlo y procesarlo, o sube un MP4 del VOD que tengas autorización para usar. Este flujo no te pide elegir segundos."};
    case "TWITCH_VOD_CLIP_OUTCOME_UNKNOWN": return {nextAction:"contact_support",message:"Twitch no confirmó si creó el clip del VOD.",nextStep:"No reintentes automáticamente esta importación: revisa el canal en Twitch o contacta soporte para evitar crear clips duplicados."};
    default: return {nextAction:"contact_support",message:"No se pudo verificar si este clip de Twitch se puede importar.",nextStep:"Comprueba la conexión de Twitch o inténtalo más tarde."};
  }
}

/** Summarizes supported preview/import/process stages without asserting a URL exists or is authorized. */
export function buildSourceLinkCapabilities(projectId:string,twitch:TwitchSourceCapabilityStatus):SourceLinkCapabilities {
  const twitchConfigurationState=!twitch.configured?"oauth_not_configured":!twitch.linked?"account_not_linked":!twitch.clipScopeReady?"clip_scope_missing":"ready";
  const twitchReasonCode=!twitch.configured?"TWITCH_OAUTH_NOT_CONFIGURED":!twitch.linked?"TWITCH_ACCOUNT_NOT_LINKED":!twitch.clipScopeReady?"TWITCH_CLIP_SCOPE_REQUIRED":null;
  return sourceLinkCapabilities.parse({
    projectId,
    providers:[
      {provider:"youtube",configurationState:"not_required",previewAvailable:true,previewKinds:["youtube_video"],importAvailable:true,importReasonCode:null,requiresClipPermissionCheck:false,processingAvailable:false,processingReasonCode:"SOURCE_BYTES_UNAVAILABLE"},
      {provider:"kick",configurationState:"not_required",previewAvailable:true,previewKinds:["kick_live_channel"],importAvailable:false,importReasonCode:"KICK_MEDIA_API_UNAVAILABLE",requiresClipPermissionCheck:false,processingAvailable:false,processingReasonCode:"SOURCE_BYTES_UNAVAILABLE"},
      {provider:"twitch",configurationState:twitchConfigurationState,previewAvailable:true,previewKinds:["twitch_video","twitch_clip"],importAvailable:twitchReasonCode===null,importReasonCode:twitchReasonCode,requiresClipPermissionCheck:true,processingAvailable:false,processingReasonCode:"UPLOAD_CONFIRMATION_AND_INSPECTION_REQUIRED"},
    ],
  });
}

const TWITCH_CLIP_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const YOUTUBE_SAFE_QUERY_PARAMETERS = new Set(["feature", "si", "t", "start", "end", "list", "index", "pp", "ab_channel"]);
const KICK_HOSTS = new Set(["kick.com", "www.kick.com"]);

function hasUrlControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Share/timestamp decorations are ignored; only a validated video ID is used downstream. */
function parseYoutubeQuery(url: URL): { videoId?: string; valid: boolean } {
  const entries = [...url.searchParams.entries()];
  if (entries.length > 8) return { valid: false };
  const seen = new Set<string>();
  let videoId: string | undefined;
  for (const [key, value] of entries) {
    if (seen.has(key) || value.length > 256 || hasUrlControlCharacter(value)) return { valid: false };
    seen.add(key);
    if (key === "v") {
      videoId = value;
      continue;
    }
    if (!YOUTUBE_SAFE_QUERY_PARAMETERS.has(key)) return { valid: false };
  }
  return videoId === undefined ? { valid: true } : { videoId, valid: true };
}

/** Parses provider URLs without fetching them. This function never performs network I/O. */
export function resolveSourceLink(value: unknown): SourceLinkResolution {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) {
    throw new BadRequestException("Invalid source URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException("Invalid source URL");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    value !== value.trim() ||
    value.includes("\\") ||
    value.includes("#")
  ) {
    throw new BadRequestException("Unsupported source URL shape");
  }

  const host = url.hostname.toLowerCase();
  if (host === "clips.twitch.tv" || host === "www.twitch.tv" || host === "twitch.tv") {
    if(value.includes("?")) throw new BadRequestException("Unsupported Twitch URL shape");
    const parts = url.pathname.split("/").filter(Boolean);
    if(host!=="clips.twitch.tv"&&parts.length===2&&parts[0]==="videos"&&/^\d{1,20}$/u.test(parts[1]!)) {
      return {provider:"twitch",kind:"vod",vodId:parts[1]!};
    }
    const clipId = host === "clips.twitch.tv"
      ? parts.length === 1 ? parts[0] : undefined
      : parts.length === 3 && parts[1] === "clip" ? parts[2]
      : parts.length === 2 && parts[0] === "clip" ? parts[1] : undefined;
    if (!clipId || !TWITCH_CLIP_ID.test(clipId)) throw new BadRequestException("Unsupported Twitch URL");
    return { provider: "twitch", kind: "clip", clipId };
  }

  if (YOUTUBE_HOSTS.has(host)) {
    let videoId: string | undefined;
    const parts=url.pathname.split("/").filter(Boolean);
    const query=parseYoutubeQuery(url);
    if(!query.valid) throw new BadRequestException("Unsupported YouTube URL");
    if(host==="youtu.be") {
      if(parts.length===1&&!query.videoId) videoId=parts[0];
    } else if(url.pathname==="/watch") {
      if(query.videoId) videoId=query.videoId;
    } else if((parts.length===2&&(parts[0]==="shorts"||parts[0]==="embed"||parts[0]==="live"))&&!query.videoId) {
      videoId=parts[1];
    }
    if(!videoId||!YOUTUBE_VIDEO_ID.test(videoId)) throw new BadRequestException("Unsupported YouTube URL");
    return {
      provider: "youtube",
      kind: "video",
      videoId,
      previewUrl: `https://www.youtube.com/embed/${videoId}`,
    };
  }
  if (KICK_HOSTS.has(host)) {
    if(value.includes("?")||url.pathname==="/") throw new BadRequestException("Unsupported Kick URL");
    return { provider: "kick", state: "unsupported", reasonCode: "KICK_MEDIA_API_UNAVAILABLE" };
  }
  throw new BadRequestException("Unsupported source provider");
}

export const TWITCH_CLIP_IMPORT_MAX_BYTES=100*1024*1024;
export const TWITCH_CDN_DNS_TIMEOUT_MS=5000;
const twitchCdnHost="production.assets.clips.twitchcdn.net";
let activeTwitchTransfers=0;
export function isPublicAddress(address:string) {
  const family=isIP(address);
  if(family===4) {
    const octets=address.split(".").map(Number);
    if(octets.length!==4||octets.some(part=>!Number.isInteger(part)||part<0||part>255)) return false;
    const a=octets[0]!,b=octets[1]!,c=octets[2]!;
    const between=(value:number,min:number,max:number)=>value>=min&&value<=max;
    return !(a===0||a===10||a===127||a>=224||(a===100&&between(b,64,127))||(a===169&&b===254)||(a===172&&between(b,16,31))||(a===192&&(b===168||b===0&&c===0||b===88&&c===99||b===0&&c===2||b===31&&c===196||b===52&&c===193||b===175&&c===48))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
  }
  if(family===6) {
    const normalized=address.toLowerCase(),parts=normalized.split("::");
    if(parts.length>2||normalized.includes("."))return false;
    const parse=(part:string)=>part?part.split(":").map(word=>/^[\da-f]{1,4}$/u.test(word)?Number.parseInt(word,16):Number.NaN):[];
    const left=parse(parts[0]??""),right=parse(parts[1]??"");
    const missing=8-left.length-right.length;
    if((parts.length===1&&missing!==0)||(parts.length===2&&missing<1)||[...left,...right].some(word=>!Number.isInteger(word)||word<0||word>0xffff))return false;
    const words=parts.length===1?left:[...left,...Array.from({length:missing},()=>0),...right];
    if(words.length!==8)return false;
    const first=words[0]!,second=words[1]!,third=words[2]!;
    // Only global-unicast 2000::/3 addresses are eligible; exclude special-purpose,
    // documentation, benchmarking and 6to4 ranges that can encode non-public peers.
    if((first&0xe000)!==0x2000)return false;
    if(first===0x2001&&(second<=0x01ff||second===0x0db8||(second===0x0002&&third===0x0000)||(second&0xfff0)===0x0010||(second&0xfff0)===0x0020))return false;
    if(first===0x2002)return false;
    if(first===0x2620&&second===0x004f&&third===0x8000)return false;
    if(first===0x3fff&&(second&0xf000)===0)return false;
    return true;
  }
  return false;
}

/** Downloads only Twitch's documented clip CDN, pins a checked public DNS answer, refuses redirects and bounds bytes/time. */
export async function downloadTwitchClipAsset(value:string,dependencies:{resolveDns?:typeof lookup;request?:typeof httpsRequest;dnsTimeoutMs?:number;maxBytes?:number;limitExceededCode?:"TWITCH_DOWNLOAD_TOO_LARGE"|"PROJECT_STORAGE_QUOTA_EXCEEDED"|"TWITCH_SOURCE_CHANGED"}={}) {
  const url=new URL(value);
  if(url.protocol!=="https:"||url.hostname!==twitchCdnHost||url.port||url.username||url.password||url.hash) throw new Error("TWITCH_DOWNLOAD_HOST_UNSUPPORTED");
  const resolveDns=dependencies.resolveDns??lookup,request=dependencies.request??httpsRequest;
  const dnsTimeoutMs=dependencies.dnsTimeoutMs??TWITCH_CDN_DNS_TIMEOUT_MS;
  if(!Number.isSafeInteger(dnsTimeoutMs)||dnsTimeoutMs<1||dnsTimeoutMs>30000)throw new Error("TWITCH_DNS_TIMEOUT_INVALID_CONFIGURATION");
  const maxBytes=dependencies.maxBytes??TWITCH_CLIP_IMPORT_MAX_BYTES;
  const limitExceededCode=dependencies.limitExceededCode??"TWITCH_DOWNLOAD_TOO_LARGE";
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>TWITCH_CLIP_IMPORT_MAX_BYTES)throw new Error("TWITCH_DOWNLOAD_LIMIT_INVALID_CONFIGURATION");
  if(activeTwitchTransfers>=2) throw new Error("TWITCH_IMPORT_BUSY");
  activeTwitchTransfers++;
  let released=false;
  const release=()=>{if(!released){activeTwitchTransfers--;released=true;}};
  let directory="";
  try {
  let dnsTimer:NodeJS.Timeout|undefined;
  const addresses=await Promise.race([
    resolveDns(twitchCdnHost,{all:true,verbatim:true}),
    new Promise<never>((_resolve,reject)=>{dnsTimer=setTimeout(()=>reject(new Error("TWITCH_CDN_DNS_TIMEOUT")),dnsTimeoutMs);}),
  ]).finally(()=>{if(dnsTimer)clearTimeout(dnsTimer);});
  if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address))) throw new Error("TWITCH_CDN_DNS_REJECTED");
  const pinned=addresses.find(item=>item.family===4)??addresses[0]!;
  directory=await mkdtemp(join(tmpdir(),"autoclipper-twitch-"));
  const file=join(directory,"clip.mp4");
    const result=await new Promise<{bytes:number;sha256:string;contentType:string}>((resolve,reject)=>{
      const req=request({hostname:twitchCdnHost,port:443,path:`${url.pathname}${url.search}`,method:"GET",servername:twitchCdnHost,lookup:(_host,_options,callback)=>callback(null,pinned.address,pinned.family),headers:{accept:"video/mp4, application/octet-stream","accept-encoding":"identity"},timeout:90000},response=>{
        if(response.statusCode!==200){response.resume();reject(new Error(response.statusCode&&response.statusCode>=300&&response.statusCode<400?"TWITCH_DOWNLOAD_REDIRECT":"TWITCH_DOWNLOAD_HTTP_ERROR"));return;}
        const type=(response.headers["content-type"]??"").split(";")[0]!.trim().toLowerCase();
        if(type!=="video/mp4"&&type!=="application/octet-stream"){response.resume();reject(new Error("TWITCH_DOWNLOAD_MIME_REJECTED"));return;}
        if(response.headers["content-encoding"]&&response.headers["content-encoding"]!=="identity"){response.resume();reject(new Error("TWITCH_DOWNLOAD_ENCODING_REJECTED"));return;}
        const length=response.headers["content-length"]?Number(response.headers["content-length"]):undefined;
        if(length!==undefined&&(!Number.isSafeInteger(length)||length<1)){response.resume();reject(new Error("TWITCH_DOWNLOAD_LENGTH_INVALID"));return;}
        if(length!==undefined&&length>maxBytes){response.resume();reject(new Error(limitExceededCode));return;}
        const hash=createHash("sha256");let bytes=0;const gate=new Transform({transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;if(bytes>maxBytes){callback(new Error(limitExceededCode));return;}hash.update(chunk);callback(null,chunk);}});
        pipeline(response,gate,createWriteStream(file,{flags:"wx",mode:0o600})).then(()=>{if(length!==undefined&&bytes!==length){reject(new Error("TWITCH_DOWNLOAD_LENGTH_MISMATCH"));return;}resolve({bytes,sha256:hash.digest("hex"),contentType:type});},reject);
      });
      req.setTimeout(10000,()=>req.destroy(new Error("TWITCH_DOWNLOAD_TIMEOUT")));
      const total=setTimeout(()=>req.destroy(new Error("TWITCH_DOWNLOAD_TIMEOUT")),90000);
      req.once("close",()=>clearTimeout(total));
      req.on("error",reject);req.end();
    });
    if(result.bytes<12) throw new Error("TWITCH_DOWNLOAD_INVALID_MEDIA");
    const handle=await open(file,"r");
    try {const prefix=Buffer.alloc(12);const read=await handle.read(prefix,0,12,0);if(read.bytesRead<12||prefix.toString("ascii",4,8)!=="ftyp") throw new Error("TWITCH_DOWNLOAD_INVALID_MEDIA");} finally {await handle.close();}
    return { ...result, contentType:"video/mp4" as const, path:file, cleanup:async()=>{try{await rm(directory,{recursive:true,force:true});}finally{release();}} };
  } catch(error) { if(directory) await rm(directory,{recursive:true,force:true});release();throw error; }
}
