import { downloadYoutubeVideo } from "./youtube-download.js";
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import pg from "pg";
import type { CustomTypesConfig } from "pg";
import { z } from "zod";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  type Part,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import {
  authenticatedUser,
  loadServiceConfig,
  requireCsrf,
  body,
  digest,
  uuid,
  workspaceAccess,
  internalJson,
  adminAuthorization,
  requireInternal,
} from "@autoclipper/http-security";
import { logger } from "@autoclipper/observability";
import { DerivativesManager } from "./derivatives.manager.js";

import { AnalysisManager } from "./analysis.manager.js";

import { EditorManager } from "./editor.manager.js";
import { CollaborationManager } from "./collaboration.manager.js";
import { PipelineManager } from "./pipeline.manager.js";
import { UsageManager } from "./usage.manager.js";
import {adminOwnerRequest,adminAuthority,adminJobsPage,privacyProjectOwnerRequest,privacyProjectAuthority,twitchSourceCapabilityStatus as twitchSourceCapabilityStatusSchema,type TwitchSourceCapabilityStatus, MAX_UPLOAD_BYTES } from "@autoclipper/api-contracts";
import { prepareProjectExport } from "./privacy-exports.js";
import { buildSourceLinkCapabilities, downloadTwitchClipAsset, resolveSourceLink, sourceLinkGuidance, TWITCH_CLIP_IMPORT_MAX_BYTES } from "./source-link.js";
import { cleanupExpiredFailedSourceImports, FAILED_SOURCE_IMPORT_CLEANUP_INTERVAL_MS } from "./source-import-retention.js";
import { YoutubeMetadataClient } from "./youtube-metadata.js";
import { WORKSPACE_STORAGE_LIMIT_BYTES } from "./storage-limit.js";

type Project = {
  id: string;
  workspace_id: string;
  name: string;
  version: number;
  deleted_at: Date | null;
  request_hash: string;
};
type Upload = {
  id: string;
  creator_id: string;
  workspace_id: string;
  project_id: string;
  object_key: string;
  expected_bytes: number;
  sha256: string;
  content_type: string;
  mode: "put" | "multipart";
  upload_id: string | null;
  state: "pending" | "confirmed" | "aborted";
  etag: string | null;
  expires_at: Date;
  signed_until: Date;
  cleaned_at?: Date | null;
  request_hash: string;
};
type SourceImportClaim =
  | {id:string;state:"succeeded";uploadId:string|null}
  | {id:string;state:"importing";uploadId:null;retryAfterSeconds:number}
  | {id:string;state:"claimed";uploadId:null;providerResourceId:string|null;externalEffectStarted:boolean}
  | {id:string;state:"outcome_unknown"}
  | {id:string;state:"resume";uploadId:string;upload:Upload;providerResourceId:string|null;externalEffectStarted:boolean};
const PART_BYTES = 8 * 1024 * 1024;
const createProject = z
  .object({ workspaceId: z.uuid(), name: z.string().trim().min(1).max(150) })
  .strict();
const uploadSchema = z
  .object({
    bytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentType: z.enum([
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-matroska",
    ]),
    mode: z.enum(["put", "multipart"]).default("put"),
  })
  .strict();
const hasControlCharacter = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};
const sourceLinkSchema=z.object({
  url:z.string().min(1).max(2048),
  // Twitch bounds the offset by the selected VOD's actual duration. Avoid an
  // unrelated 24-hour cap here so longer VODs can be clipped past that point.
  vodOffsetSeconds:z.number().int().min(5).max(Number.MAX_SAFE_INTEGER).optional(),
  durationSeconds:z.number().int().min(5).max(60).optional(),
  title:z.string().trim().min(1).max(140).refine(value=>!hasControlCharacter(value)).optional(),
}).strict()
  .refine(value=>(value.vodOffsetSeconds===undefined)===(value.durationSeconds===undefined))
  .refine(value=>value.vodOffsetSeconds===undefined||value.durationSeconds===undefined||value.vodOffsetSeconds>=value.durationSeconds);
const twitchDownloadSchema=z.discriminatedUnion("available",[
  z.object({available:z.literal(true),broadcasterId:z.string().regex(/^\d+$/),title:z.string().max(150),durationSeconds:z.number().positive().max(60),downloadUrl:z.url()}).strict(),
  z.object({available:z.literal(false),reasonCode:z.string().regex(/^[A-Z_]{1,100}$/)}).strict(),
]);
const twitchVodClipCreateSchema=z.discriminatedUnion("state",[
  z.object({state:z.literal("created"),clipId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),broadcasterId:z.string().regex(/^\d{1,20}$/u),title:z.string().max(140),durationSeconds:z.number().int().min(5).max(60)}).strict(),
  z.object({state:z.literal("rejected"),reasonCode:z.string().regex(/^[A-Z_]{1,100}$/u)}).strict(),
  z.object({state:z.literal("outcome_unknown"),reasonCode:z.literal("TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN")}).strict(),
]);
@Injectable()
export class ProjectService implements OnModuleInit, OnModuleDestroy {
  async adminJobs(req:Request,input:unknown){
    requireInternal(req,this.config);const {token,query,correlationId}=body(adminOwnerRequest,input);
    const authority=body(adminAuthority,await adminAuthorization(this.config,{token,permission:"jobs.read",correlationId,workspaceId:query.workspaceId}));
    const conditions:string[]=[],params:(string|number|boolean|null|string[])[]=[query.workspaceId??null,authority.workspaceIds,query.beforeId??null,query.limit+1];
    if(query.kind){conditions.push("kind = $"+(params.length+1));params.push(query.kind);}
    if(query.status){conditions.push("status = $"+(params.length+1));params.push(query.status);}
    const where=conditions.length?"AND "+conditions.join(" AND "):"";
    const rows=(await this.pool.query<{id:string;workspace_id:string;kind:string;status:string;created_at:Date;finished_at:Date|null;error_code:string|null}>(`SELECT * FROM (SELECT id,workspace_id,CASE WHEN spec->>'kind'='audio' THEN 'audio' ELSE 'render' END AS kind,status,created_at,finished_at,error_code FROM processing_requests UNION ALL SELECT id,workspace_id,'analysis',COALESCE(cached_status->>'status','queued'),created_at,finished_at,cached_status->>'errorCode' FROM analysis_requests UNION ALL SELECT id,workspace_id,'pipeline',status,created_at,finished_at,error_code FROM pipelines) jobs WHERE ($1::uuid IS NULL OR workspace_id=$1) AND ($2::uuid[] IS NULL OR workspace_id=ANY($2)) AND ($3::uuid IS NULL OR id<$3) ${where} ORDER BY id DESC LIMIT $4`,params)).rows;
    const items=rows.slice(0,query.limit).map(row=>({id:row.id,workspaceId:row.workspace_id,kind:row.kind,status:row.status,createdAt:row.created_at.toISOString(),finishedAt:row.finished_at?.toISOString()??null,errorCode:row.error_code&&/^[A-Z_]{1,100}$/u.test(row.error_code)?row.error_code:null}));return body(adminJobsPage,{items,nextBeforeId:rows.length>query.limit?items.at(-1)!.id:null});
  }
  async privacyProjectExport(req:Request,input:unknown){
    requireInternal(req,this.config);
    const data=body(privacyProjectOwnerRequest,input);
    const authority=body(privacyProjectAuthority,await internalJson(this.config.IDENTITY_URL,'/v1/internal/privacy-project-export-authorize',this.config,{...data,scope:'project-attribution-v1'}));
    const result=await prepareProjectExport(this.pool,authority.userId,authority.requestId,data.idempotencyKey,data.correlationId);
    return result;
  }
  readonly config = loadServiceConfig();
  readonly pool = new pg.Pool({
    connectionString: this.config.DATABASE_URL,
    // Tamaños en bytes son bigint (videos > 2 GiB): devolverlos como number.
    types:{getTypeParser:((oid:number,format?:"text"|"binary")=>{if(format==="binary")return pg.types.getTypeParser(oid,"binary");if(oid===20)return (value:string)=>Number(value);return pg.types.getTypeParser(oid,"text");}) as CustomTypesConfig["getTypeParser"]},
    // El frontend consulta estados cada pocos segundos durante pipelines largos.
    max: 20,
    // Con Whisper/FFmpeg saturando CPU, Postgres tarda más en entregar conexiones.
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
  });
  readonly bucket = process.env["S3_BUCKET"] ?? "";
  readonly mediaUrl = process.env["MEDIA_URL"] ?? "http://127.0.0.1:3001";
  readonly s3: S3Client;
  readonly importS3: S3Client;
  readonly sourceAssetDownloader=downloadTwitchClipAsset;
  readonly youtubeSourceDownloader=downloadYoutubeVideo;
  readonly youtubeMetadataClient=new YoutubeMetadataClient();
  readonly signer: S3Client;
  readonly derivatives: DerivativesManager;
  readonly analyses: AnalysisManager;
  readonly editor: EditorManager;
  readonly collaboration: CollaborationManager;
  readonly pipelines: PipelineManager;
  readonly usage: UsageManager;
  private timer: NodeJS.Timeout | undefined;
  private working: Promise<void> | undefined;
  private nextFailedSourceImportCleanupAt = 0;
  constructor() {
    const endpoint = process.env["S3_ENDPOINT"];
    const publicEndpoint = process.env["S3_PUBLIC_ENDPOINT"];
    const access = process.env["S3_ACCESS_KEY"],
      secret = process.env["S3_SECRET_KEY"];
    if (!endpoint || !publicEndpoint || !access || !secret || !this.bucket)
      throw new Error("S3 configuration required");
    const options = {
      region: process.env["S3_REGION"] ?? "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: access, secretAccessKey: secret },
      maxAttempts: 2,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 2000,
        requestTimeout: 5000,
      }),
    };
    this.s3 = new S3Client({ ...options, endpoint });
    this.importS3 = new S3Client({ ...options, endpoint, maxAttempts: 1, requestHandler: new NodeHttpHandler({ connectionTimeout: 2000, requestTimeout: 110000 }) });
    this.signer = new S3Client({ ...options, endpoint: publicEndpoint });
    this.derivatives = new DerivativesManager(this.pool,this.config,this.mediaUrl,this.bucket,this.s3,this.signer,(req,id,minimum)=>this.upload(req,id,minimum));
    this.analyses=new AnalysisManager(this.pool,this.config,process.env["ANALYSIS_URL"]??"http://127.0.0.1:3006",this.derivatives,(req,id,minimum)=>this.upload(req,id,minimum));
    this.editor=new EditorManager(this.pool,this.config,this.derivatives,this.analyses,(req,id,minimum)=>this.upload(req,id,minimum));
    this.collaboration=new CollaborationManager(this.pool,this.config,this.derivatives,(req,id,minimum)=>this.upload(req,id,minimum));
    this.usage=new UsageManager(this.pool,this.config,process.env["BILLING_URL"]??"http://127.0.0.1:3007");
    this.pipelines=new PipelineManager(this.pool,this.config,process.env["ANALYSIS_URL"]??"http://127.0.0.1:3006",this.derivatives,this.usage);
  }
  async onModuleInit() {
    this.pool.on("error", () =>
      logger.error({ code: "PROJECT_DATABASE_ERROR" }),
    );
    this.timer = setInterval(() => {
      if (!this.working)
        this.working = this.dispatch()
          .catch(() => logger.warn({ code: "INSPECTION_REQUEST_RETRY" }))
          .finally(() => {
            this.working = undefined;
          });
    }, 1000);
    this.timer.unref();
  }
  private async tx<T>(work: (c: pg.PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await work(c);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  private async project(
    req: Request,
    id: string,
    minimum: "reader" | "editor" | "admin" = "reader",
  ) {
    const user = await authenticatedUser(req, this.config);
    const row = (
      await this.pool.query<Project>(
        "SELECT * FROM projects WHERE id=$1 AND deleted_at IS NULL",
        [id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    await workspaceAccess(this.config, user.id, row.workspace_id, minimum);
    return { user, project: row };
  }
  private async upload(
    req: Request,
    id: string,
    minimum: "reader" | "editor" | "admin" = "reader",
  ) {
    const row = (
      await this.pool.query<Upload>("SELECT * FROM uploads WHERE id=$1", [id])
    ).rows[0];
    if (!row) throw new NotFoundException();
    await this.project(req, row.project_id, minimum);
    return row;
  }
  async create(req: Request, input: unknown) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    const data = body(createProject, input);
    await workspaceAccess(this.config, user.id, data.workspaceId, "editor");
    const key = uuid(String(req.headers["idempotency-key"] ?? ""));
    const hash = digest(JSON.stringify(data));
    return this.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${user.id}:${key}`,
      ]);
      const prior = (
        await c.query<Project>(
          "SELECT * FROM projects WHERE creator_id=$1 AND idempotency_key=$2",
          [user.id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash || prior.deleted_at)
          throw new ConflictException();
        return { id: prior.id, version: prior.version };
      }
      const id = randomUUID();
      await c.query(
        "INSERT INTO projects(id,workspace_id,creator_id,name,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [id, data.workspaceId, user.id, data.name, key, hash],
      );
      return { id, version: 1 };
    });
  }
  async list(
    req: Request,
    workspaceId: string,
    limit: string | undefined,
    search: string | undefined,
  ) {
    const user = await authenticatedUser(req, this.config);
    await workspaceAccess(this.config, user.id, workspaceId);
    const count = body(
      z.coerce.number().int().min(1).max(100).default(20),
      limit,
    );
    const query = body(z.string().max(150).default(""), search);
    const result = await this.pool.query(
      "SELECT id,workspace_id,name,version,created_at FROM projects WHERE workspace_id=$1 AND deleted_at IS NULL AND name ILIKE $2 ORDER BY created_at DESC,id DESC LIMIT $3",
      [workspaceId, `%${query}%`, count],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        version: row.version,
        createdAt: row.created_at,
      })),
    };
  }
  async get(req: Request, id: string) {
    const { project } = await this.project(req, id);
    return {
      id: project.id,
      workspaceId: project.workspace_id,
      name: project.name,
      version: project.version,
    };
  }
  async storage(req:Request,workspaceId:string){const user=await authenticatedUser(req,this.config);await workspaceAccess(this.config,user.id,workspaceId);const row=(await this.pool.query<{used_bytes:string;reserved_bytes:string}>('SELECT used_bytes,reserved_bytes FROM workspace_storage WHERE workspace_id=$1',[workspaceId])).rows[0];return {workspaceId,usedBytes:Number(row?.used_bytes??0),reservedBytes:Number(row?.reserved_bytes??0),limitBytes:WORKSPACE_STORAGE_LIMIT_BYTES};}
  async update(req: Request, id: string, input: unknown) {
    requireCsrf(req, this.config);
    await this.project(req, id, "editor");
    const data = body(
      z
        .object({
          name: z.string().trim().min(1).max(150),
          version: z.number().int().positive(),
        })
        .strict(),
      input,
    );
    const result = await this.pool.query<{ version: number }>(
      "UPDATE projects SET name=$1,version=version+1 WHERE id=$2 AND version=$3 AND deleted_at IS NULL RETURNING version",
      [data.name, id, data.version],
    );
    if (!result.rows[0]) throw new ConflictException();
    return { id, version: result.rows[0].version };
  }
  async trash(req: Request, id: string) {
    requireCsrf(req, this.config);
    const user = await authenticatedUser(req, this.config);
    const project = (
      await this.pool.query<Project>("SELECT * FROM projects WHERE id=$1", [id])
    ).rows[0];
    if (!project) throw new NotFoundException();
    await workspaceAccess(this.config, user.id, project.workspace_id, "editor");
    const updated = await this.pool.query<{ id: string }>(
      "UPDATE projects SET deleted_at=now(),version=version+1 WHERE id=$1 AND deleted_at IS NULL RETURNING id",
      [id],
    );
    if (!updated.rows[0]) {
      const alreadyTrashed = (
        await this.pool.query<{ id: string }>(
          "SELECT id FROM projects WHERE id=$1 AND deleted_at IS NOT NULL",
          [id],
        )
      ).rows[0];
      if (!alreadyTrashed) throw new NotFoundException();
    }
    return { trashed: true };
  }
  private async twitchSourceCapabilityStatus(userId:string) {
    return body(twitchSourceCapabilityStatusSchema,await internalJson<TwitchSourceCapabilityStatus>(this.config.IDENTITY_URL,"/v1/internal/twitch/source-capabilities",this.config,{userId}));
  }
  async sourceLinkCapabilities(req:Request,projectId:string) {
    const {user}=await this.project(req,projectId,"reader");
    const twitch=await this.twitchSourceCapabilityStatus(user.id);
    return buildSourceLinkCapabilities(projectId,twitch);
  }
  private async resolveTwitchImport(req:Request,projectId:string,clipId:string) {
    const {user}=await this.project(req,projectId,"reader");
    return body(twitchDownloadSchema,await internalJson(this.config.IDENTITY_URL,"/v1/internal/twitch/clip-download",this.config,{userId:user.id,clipId},false,35000));
  }
  private async createTwitchVodClip(req:Request,projectId:string,input:{vodId:string;vodOffsetSeconds:number;durationSeconds:number;title:string}) {
    const {user}=await this.project(req,projectId,"editor");
    return body(twitchVodClipCreateSchema,await internalJson(this.config.IDENTITY_URL,"/v1/internal/twitch/vod-clip-create",this.config,{userId:user.id,...input},false,35000));
  }
  private async sourceImportAvailableBytes(workspaceId:string) {
    const limit=WORKSPACE_STORAGE_LIMIT_BYTES;
    if(!Number.isSafeInteger(limit)||limit<1)throw new ServiceUnavailableException({code:"STORAGE_QUOTA_UNAVAILABLE"});
    const row=(await this.pool.query<{used_bytes:string;reserved_bytes:string}>("SELECT used_bytes,reserved_bytes FROM workspace_storage WHERE workspace_id=$1",[workspaceId])).rows[0];
    const used=Number(row?.used_bytes??0),reserved=Number(row?.reserved_bytes??0);
    if(!Number.isSafeInteger(used)||used<0||!Number.isSafeInteger(reserved)||reserved<0)throw new ServiceUnavailableException({code:"STORAGE_QUOTA_UNAVAILABLE"});
    // This snapshot avoids downloading when the workspace is already full and
    // bounds transfer bytes. beginUpload still performs the authoritative,
    // atomic quota check after the exact media size is known.
    return Math.max(0,limit-used-reserved);
  }
  async resolveSourceLink(req:Request,projectId:string,input:unknown) {
    requireCsrf(req,this.config);
    const {user}=await this.project(req,projectId,"reader");
    const data=body(sourceLinkSchema,input),source=resolveSourceLink(data.url);
    if(source.provider==="youtube") return {provider:"youtube",kind:"video",state:"available",importable:true,videoId:source.videoId,previewUrl:source.previewUrl,youtubeMetadata:await this.youtubeMetadataClient.lookup(source.videoId,user.id),nextAction:"import_youtube_video",message:"Enlace reconocido. Importa el video para generar clips con IA.",nextStep:"El servidor descargará e inspeccionará el video; si la plataforma restringe el acceso, mostrará el error."};
    if(source.provider!=="twitch") return {provider:source.provider,state:"unsupported",importable:false,reasonCode:source.reasonCode,...sourceLinkGuidance(source.reasonCode)};
    if(source.kind==="vod") {
      if(data.vodOffsetSeconds===undefined||data.durationSeconds===undefined) {
        const guidance=sourceLinkGuidance("TWITCH_VOD_INTERVAL_REQUIRED");
        return {provider:"twitch",kind:"vod",vodId:source.vodId,state:"input_required",importable:false,reasonCode:"TWITCH_VOD_INTERVAL_REQUIRED",...guidance};
      }
      const twitch=await this.twitchSourceCapabilityStatus(user.id);
      const reasonCode=!twitch.configured?"TWITCH_OAUTH_NOT_CONFIGURED":!twitch.linked?"TWITCH_ACCOUNT_NOT_LINKED":!twitch.clipScopeReady?"TWITCH_CLIP_SCOPE_REQUIRED":null;
      if(reasonCode) return {provider:"twitch",kind:"vod",vodId:source.vodId,state:"unavailable",importable:false,reasonCode,...sourceLinkGuidance(reasonCode)};
      return {provider:"twitch",kind:"vod",vodId:source.vodId,state:"available",importable:true,vodOffsetSeconds:data.vodOffsetSeconds,durationSeconds:data.durationSeconds,nextAction:"import_twitch_vod_clip",message:"La cuenta vinculada tiene el scope requerido. Twitch comprobará que sea broadcaster/editor al crear el clip.",nextStep:"Al importar se crea un clip de este intervalo en Twitch, se descarga por la API oficial y se confirma como medio para inspección."};
    }
    const clip=await this.resolveTwitchImport(req,projectId,source.clipId);
    if(!clip.available) return {provider:"twitch",kind:"clip",clipId:source.clipId,state:"unavailable",importable:false,reasonCode:clip.reasonCode,...sourceLinkGuidance(clip.reasonCode)};
    return {provider:"twitch",kind:"clip",clipId:source.clipId,state:"available",importable:true,title:clip.title,durationSeconds:clip.durationSeconds,nextAction:"import_twitch_clip",message:"La cuenta de Twitch vinculada tiene acceso a la descarga de este clip.",nextStep:"Confirma la importación. El clip quedará listo solo si terminan la descarga y la inspección; después podrás crear el pipeline."};
  }
  async importSourceLink(req:Request,projectId:string,input:unknown,correlationId:string) {
    requireCsrf(req,this.config);
    const {user,project}=await this.project(req,projectId,"editor");
    const data=body(sourceLinkSchema,input),source=resolveSourceLink(data.url);
    if(source.provider==="kick") throw new HttpException({code:source.reasonCode},422);
    if(source.kind==="clip"&&(data.vodOffsetSeconds!==undefined||data.durationSeconds!==undefined||data.title!==undefined))throw new HttpException({code:"TWITCH_VOD_OPTIONS_NOT_APPLICABLE"},400);
    if(source.kind==="vod"&&(data.vodOffsetSeconds===undefined||data.durationSeconds===undefined))throw new HttpException({code:"TWITCH_VOD_INTERVAL_REQUIRED"},422);
    const sourceId=source.provider==="youtube"?source.videoId:source.kind==="clip"?source.clipId:`vod:${source.vodId}:${data.vodOffsetSeconds}:${data.durationSeconds}`;
    const sourceTitle=data.title??"AutoClipper VOD clip";
    const idempotencyKey=uuid(String(req.headers["idempotency-key"]??""));
    const requestHash=source.provider==="youtube"?digest(JSON.stringify({projectId,provider:source.provider,videoId:source.videoId})):source.kind==="clip"
      ?digest(JSON.stringify({projectId,provider:source.provider,clipId:source.clipId}))
      :digest(JSON.stringify({projectId,provider:source.provider,vodId:source.vodId,vodOffsetSeconds:data.vodOffsetSeconds,durationSeconds:data.durationSeconds,title:sourceTitle}));
    const claim:SourceImportClaim=await this.tx(async client=>{
      const recoverLinkedUpload=async(importId:string,uploadId:string,providerResourceId:string|null,externalEffectStarted:boolean):Promise<SourceImportClaim|null>=>{
        const upload=(await client.query<Upload>("SELECT * FROM uploads WHERE id=$1 AND project_id=$2 AND workspace_id=$3 FOR UPDATE",[uploadId,projectId,project.workspace_id])).rows[0];
        if(!upload)throw new ConflictException({code:"SOURCE_IMPORT_UPLOAD_REFERENCE_INVALID"});
        if(upload.state==="confirmed"){
          await client.query("INSERT INTO inspection_requests(upload_id,correlation_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[uploadId,correlationId]);
          const recovered=await client.query("UPDATE source_imports SET state='succeeded',error_code=NULL,lease_until=now(),updated_at=now() WHERE id=$1 AND upload_id=$2 RETURNING id",[importId,uploadId]);
          if(!recovered.rows.length)throw new ConflictException({code:"SOURCE_IMPORT_UPLOAD_REFERENCE_INVALID"});
          return{id:importId,state:"succeeded",uploadId};
        }
        if(upload.state==="pending"&&upload.expires_at>new Date())return{id:importId,state:"resume",uploadId,upload,providerResourceId,externalEffectStarted};
        if((upload.state==="pending"||upload.state==="aborted")&&!upload.cleaned_at)return{id:importId,state:"importing",uploadId:null,retryAfterSeconds:5};
        if(upload.state==="aborted"&&upload.cleaned_at){await client.query("UPDATE source_imports SET upload_id=NULL WHERE id=$1 AND upload_id=$2",[importId,uploadId]);return null;}
        throw new ConflictException({code:"SOURCE_IMPORT_UPLOAD_REFERENCE_INVALID"});
      };
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${user.id}:${idempotencyKey}`]);
      const prior=(await client.query<{id:string;request_hash:string;state:string;upload_id:string|null;lease_until:Date;provider_resource_id:string|null;external_effect_started_at:Date|null}>("SELECT id,request_hash,state,upload_id,lease_until,provider_resource_id,external_effect_started_at FROM source_imports WHERE creator_id=$1 AND idempotency_key=$2 FOR UPDATE",[user.id,idempotencyKey])).rows[0];
      if(prior){
        if(prior.request_hash!==requestHash)throw new ConflictException();
        if(prior.state==="succeeded")return{id:prior.id,state:"succeeded",uploadId:prior.upload_id};
        const linked=prior.upload_id?await recoverLinkedUpload(prior.id,prior.upload_id,prior.provider_resource_id,Boolean(prior.external_effect_started_at)):null;
        if(linked?.state==="succeeded")return linked;
        if(prior.state==="importing"&&prior.lease_until>new Date())return{id:prior.id,state:"importing",uploadId:null,retryAfterSeconds:2};
        if(linked?.state==="importing")return linked;
        if(source.kind==="vod"&&prior.external_effect_started_at&&!prior.provider_resource_id){
          await client.query("UPDATE source_imports SET state='failed',error_code='TWITCH_VOD_CLIP_OUTCOME_UNKNOWN',lease_until=now(),updated_at=now() WHERE id=$1 AND state<>'succeeded'",[prior.id]);
          return{id:prior.id,state:"outcome_unknown"};
        }
        await client.query("UPDATE source_imports SET state='importing',error_code=NULL,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=$1",[prior.id]);
        if(linked?.state==="resume")return linked;
        return{id:prior.id,state:"claimed",uploadId:null,providerResourceId:prior.provider_resource_id,externalEffectStarted:Boolean(prior.external_effect_started_at)};
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`source:${projectId}:${source.provider}:${sourceId}`]);
      const existing=(await client.query<{id:string;state:string;upload_id:string|null;lease_until:Date;provider_resource_id:string|null;external_effect_started_at:Date|null}>("SELECT id,state,upload_id,lease_until,provider_resource_id,external_effect_started_at FROM source_imports WHERE project_id=$1 AND provider=$2 AND source_id=$3 FOR UPDATE",[projectId,source.provider,sourceId])).rows[0];
      if(existing){
        if(existing.state==="succeeded")return{id:existing.id,state:"succeeded",uploadId:existing.upload_id};
        const linked=existing.upload_id?await recoverLinkedUpload(existing.id,existing.upload_id,existing.provider_resource_id,Boolean(existing.external_effect_started_at)):null;
        if(linked?.state==="succeeded")return linked;
        if(existing.state==="importing"&&existing.lease_until>new Date())return{id:existing.id,state:"importing",uploadId:null,retryAfterSeconds:2};
        if(linked?.state==="importing")return linked;
        if(source.kind==="vod"&&existing.external_effect_started_at&&!existing.provider_resource_id){
          await client.query("UPDATE source_imports SET state='failed',error_code='TWITCH_VOD_CLIP_OUTCOME_UNKNOWN',lease_until=now(),updated_at=now() WHERE id=$1 AND state<>'succeeded'",[existing.id]);
          return{id:existing.id,state:"outcome_unknown"};
        }
        await client.query("UPDATE source_imports SET creator_id=$1,idempotency_key=$2,request_hash=$3,state='importing',error_code=NULL,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=$4",[user.id,idempotencyKey,requestHash,existing.id]);
        if(linked?.state==="resume")return linked;
        return{id:existing.id,state:"claimed",uploadId:null,providerResourceId:existing.provider_resource_id,externalEffectStarted:Boolean(existing.external_effect_started_at)};
      }
      const id=randomUUID();
      await client.query("INSERT INTO source_imports(id,creator_id,workspace_id,project_id,provider,source_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[id,user.id,project.workspace_id,projectId,source.provider,sourceId,idempotencyKey,requestHash]);
      return{id,state:"claimed",uploadId:null,providerResourceId:null,externalEffectStarted:false};
    });
    if(claim.state==="succeeded") return {id:claim.id,state:"succeeded",uploadId:claim.uploadId,duplicate:true};
    if(claim.state==="importing") return {id:claim.id,state:"importing",retryAfterSeconds:claim.retryAfterSeconds};
    if(claim.state==="outcome_unknown")throw new HttpException({code:"TWITCH_VOD_CLIP_OUTCOME_UNKNOWN"},409);
    let uploadId:string|undefined;
    let artifact:Awaited<ReturnType<typeof downloadTwitchClipAsset>>|undefined;
    const uploadReq={...req,headers:{...req.headers,"idempotency-key":randomUUID()}} as unknown as Request;
    try {
      const resume=claim.state==="resume"?claim.upload:undefined;
      const availableBytes=resume?resume.expected_bytes:await this.sourceImportAvailableBytes(project.workspace_id);
      if(availableBytes<1)throw new HttpException({code:"PROJECT_STORAGE_QUOTA_EXCEEDED"},409);
      const maxBytes=Math.min(availableBytes,TWITCH_CLIP_IMPORT_MAX_BYTES);
      const limitExceededCode=resume?"TWITCH_SOURCE_CHANGED":availableBytes<TWITCH_CLIP_IMPORT_MAX_BYTES?"PROJECT_STORAGE_QUOTA_EXCEEDED":"TWITCH_DOWNLOAD_TOO_LARGE";
      let providerResourceId=claim.state==="resume"?claim.providerResourceId:claim.state==="claimed"?claim.providerResourceId:null;
      if(source.kind==="vod"&&!providerResourceId) {
        if(claim.state==="resume"||claim.state==="claimed"&&claim.externalEffectStarted)throw new HttpException({code:"TWITCH_VOD_CLIP_OUTCOME_UNKNOWN"},409);
        const started=await this.pool.query<{id:string}>("UPDATE source_imports SET external_effect_started_at=coalesce(external_effect_started_at,now()),updated_at=now() WHERE id=$1 AND state='importing' AND external_effect_started_at IS NULL RETURNING id",[claim.id]);
        if(!started.rows[0])throw new HttpException({code:"TWITCH_VOD_CLIP_OUTCOME_UNKNOWN"},409);
        const created=await this.createTwitchVodClip(req,projectId,{vodId:source.vodId,vodOffsetSeconds:data.vodOffsetSeconds!,durationSeconds:data.durationSeconds!,title:sourceTitle});
        if(created.state==="rejected") {
          await this.pool.query("UPDATE source_imports SET external_effect_started_at=NULL,updated_at=now() WHERE id=$1 AND state='importing' AND provider_resource_id IS NULL",[claim.id]);
          const status=created.reasonCode==="TWITCH_CHANNEL_EDITOR_REQUIRED"||created.reasonCode==="TWITCH_CLIP_SCOPE_REQUIRED"?403:created.reasonCode==="TWITCH_VOD_NOT_FOUND"?404:created.reasonCode==="TWITCH_RATE_LIMITED"?429:created.reasonCode==="TWITCH_VOD_INTERVAL_INVALID"||created.reasonCode==="TWITCH_VOD_OFFSET_OUT_OF_RANGE"?400:created.reasonCode==="TWITCH_ACCOUNT_NOT_LINKED"?409:503;
          throw new HttpException({code:created.reasonCode},status);
        }
        if(created.state==="outcome_unknown")throw new HttpException({code:created.reasonCode},503);
        providerResourceId=created.clipId;
        const persisted=await this.pool.query<{id:string}>("UPDATE source_imports SET provider_resource_id=$1,error_code=NULL,updated_at=now() WHERE id=$2 AND state='importing' AND external_effect_started_at IS NOT NULL RETURNING id",[providerResourceId,claim.id]);
        if(!persisted.rows[0])throw new HttpException({code:"TWITCH_VOD_CLIP_OUTCOME_UNKNOWN"},503);
      }
      const clipId=source.provider==="youtube"?source.videoId:source.kind==="clip"?source.clipId:providerResourceId;
      if(!clipId)throw new HttpException({code:"TWITCH_VOD_CLIP_OUTCOME_UNKNOWN"},409);
      const clip=source.provider==="youtube"?{available:true as const,title:`YouTube ${source.videoId}`,durationSeconds:undefined,downloadUrl:""}:await this.resolveTwitchImport(req,projectId,clipId);
      if(!clip.available) {
        const status=clip.reasonCode==="TWITCH_ACCOUNT_NOT_LINKED"?409:clip.reasonCode==="TWITCH_CHANNEL_EDITOR_REQUIRED"?403:clip.reasonCode==="TWITCH_RATE_LIMITED"?429:clip.reasonCode==="TWITCH_CLIP_NOT_FOUND"?404:503;
        throw new HttpException({code:clip.reasonCode},status);
      }
      artifact=source.provider==="youtube"?await this.youtubeSourceDownloader(source.videoId,{maxBytes}):await this.sourceAssetDownloader(clip.downloadUrl,{maxBytes,limitExceededCode});
      let stored:Upload;
      if(resume){
        if(artifact.bytes!==resume.expected_bytes||artifact.sha256!==resume.sha256){uploadId=resume.id;throw new HttpException({code:"TWITCH_SOURCE_CHANGED"},409);}
        stored=resume;uploadId=resume.id;
      }else{
        const intent=await this.beginUpload(uploadReq,projectId,{bytes:artifact.bytes,sha256:artifact.sha256,contentType:"video/mp4",mode:"put"},claim.id) as {id:string};
        uploadId=intent.id;
        const created=(await this.pool.query<Upload>("SELECT * FROM uploads WHERE id=$1 AND creator_id=$2 AND project_id=$3",[uploadId,user.id,projectId])).rows[0];
        if(!created) throw new ConflictException();
        stored=created;
      }
      await this.importS3.send(new PutObjectCommand({Bucket:this.bucket,Key:stored.object_key,Body:createReadStream(artifact.path),ContentLength:artifact.bytes,ContentType:"video/mp4",ChecksumSHA256:Buffer.from(artifact.sha256,"hex").toString("base64")}));
      await this.confirm(uploadReq,uploadId,correlationId,claim.id);
      return {id:claim.id,state:"succeeded",uploadId,inspection:{status:"queued"},title:clip.title,durationSeconds:clip.durationSeconds};
    } catch(error) {
      const response=error instanceof HttpException?error.getResponse():null;
      const responseCode=response&&typeof response==="object"&&"code" in response&&typeof response.code==="string"?response.code:undefined;
      const failureCode=error instanceof Error&&/^[A-Z_]{1,100}$/.test(error.message)?error.message:responseCode&&/^[A-Z_]{1,100}$/.test(responseCode)?responseCode:"TWITCH_IMPORT_FAILED";
      if(claim.state==="resume"&&failureCode==="TWITCH_SOURCE_CHANGED")uploadId??=claim.upload.id;
      if(uploadId) await this.abort(uploadReq,uploadId).catch(()=>undefined);
      // Preserve provider_resource_id and external_effect_started_at. A VOD clip
      // may already exist if the final, atomic upload quota check loses a race;
      // a retry must download that same clip instead of creating another one.
      try{await this.pool.query("UPDATE source_imports SET state='failed',error_code=$1,lease_until=now(),updated_at=now() WHERE id=$2 AND state<>'succeeded'",[failureCode,claim.id]);}
      catch{logger.warn({code:"SOURCE_IMPORT_FAILURE_STATE_WRITE_FAILED"});}
      if(error instanceof HttpException) throw error;
      const status=(failureCode==="TWITCH_IMPORT_BUSY"||failureCode==="YOUTUBE_IMPORT_BUSY")?429:(failureCode==="TWITCH_DOWNLOAD_TOO_LARGE"||failureCode==="YOUTUBE_DOWNLOAD_TOO_LARGE")?413:failureCode==="PROJECT_STORAGE_QUOTA_EXCEEDED"||failureCode==="TWITCH_SOURCE_CHANGED"||failureCode==="TWITCH_VOD_CLIP_OUTCOME_UNKNOWN"?409:failureCode==="TWITCH_CHANNEL_EDITOR_REQUIRED"||failureCode==="TWITCH_CLIP_SCOPE_REQUIRED"?403:failureCode==="TWITCH_VOD_NOT_FOUND"?404:503;
      throw new HttpException({code:failureCode},status);
    } finally {if(artifact)try{await artifact.cleanup();}catch{logger.warn({code:"TWITCH_IMPORT_TEMP_CLEANUP_FAILED"});}}
  }
  async beginUpload(req: Request, projectId: string, input: unknown, sourceImportId?: string) {
    requireCsrf(req, this.config);
    const { user, project } = await this.project(req, projectId, "editor");
    const data = body(uploadSchema, input);
    const key = uuid(String(req.headers["idempotency-key"] ?? ""));
    const hash = digest(JSON.stringify({ projectId, ...data }));
    let upload = await this.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${user.id}:${key}`,
      ]);
      const prior = (
        await c.query<Upload>(
          "SELECT * FROM uploads WHERE creator_id=$1 AND idempotency_key=$2",
          [user.id, key],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.request_hash !== hash ||
          prior.state !== "pending" ||
          prior.expires_at <= new Date()
        )
          throw new ConflictException();
        if(sourceImportId) await this.linkSourceImportUpload(c,sourceImportId,prior.id);
        return prior;
      }
      await c.query(
        "INSERT INTO workspace_storage(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
        [project.workspace_id],
      );
      const quota = await c.query(
        "UPDATE workspace_storage SET reserved_bytes=reserved_bytes+$1 WHERE workspace_id=$2 AND used_bytes+reserved_bytes+$1<=$3 RETURNING workspace_id",
        [
          data.bytes,
          project.workspace_id,
          WORKSPACE_STORAGE_LIMIT_BYTES,
        ],
      );
      if (!quota.rows.length) throw new HttpException({code:"PROJECT_STORAGE_QUOTA_EXCEEDED"}, 409);
      const id = randomUUID();
      const objectKey = `workspaces/${project.workspace_id}/media/${id}/source.media`;
      const created=(
        await c.query<Upload>(
          "INSERT INTO uploads(id,workspace_id,project_id,creator_id,idempotency_key,request_hash,object_key,expected_bytes,sha256,content_type,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
          [
            id,
            project.workspace_id,
            projectId,
            user.id,
            key,
            hash,
            objectKey,
            data.bytes,
            data.sha256,
            data.contentType,
            data.mode,
          ],
        )
      ).rows[0]!;
      if(sourceImportId) await this.linkSourceImportUpload(c,sourceImportId,created.id);
      return created;
    });
    if (upload.mode === "multipart" && !upload.upload_id) {
      const response = await this.s3.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: upload.object_key,
          ContentType: upload.content_type,
          ChecksumAlgorithm: "SHA256",
        }),
      );
      if (!response.UploadId)
        throw new Error("MULTIPART_INITIALIZATION_FAILED");
      const stored = await this.pool.query<Upload>(
        "UPDATE uploads SET upload_id=$1 WHERE id=$2 AND upload_id IS NULL AND state='pending' RETURNING *",
        [response.UploadId, upload.id],
      );
      if (stored.rows[0]) upload = stored.rows[0];
      else {
        await this.s3.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: upload.object_key,
            UploadId: response.UploadId,
          }),
        );
        upload = (
          await this.pool.query<Upload>("SELECT * FROM uploads WHERE id=$1", [
            upload.id,
          ])
        ).rows[0]!;
      }
    }
    if (upload.mode === "multipart")
      return {
        id: upload.id,
        mode: upload.mode,
        partBytes: PART_BYTES,
        parts: Math.ceil(upload.expected_bytes / PART_BYTES),
        expiresAt: upload.expires_at.toISOString(),
      };
    const checksum = Buffer.from(upload.sha256, "hex").toString("base64");
    const signingDate = await this.signatureTime(upload);
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: upload.object_key,
        ContentType: upload.content_type,
        ContentLength: upload.expected_bytes,
        ChecksumSHA256: checksum,
      }),
      {
        expiresIn: 300,
        signingDate,
        signableHeaders: new Set([
          "content-length",
          "content-type",
          "x-amz-checksum-sha256",
        ]),
      },
    );
    return {
      id: upload.id,
      mode: "put",
      url,
      // The SDK signs the checksum in the URL query. Do not duplicate that
      // x-amz field in a header: S3-compatible servers reject the ambiguity.
      headers: { "content-type": upload.content_type },
      expiresInSeconds: 300,
    };
  }
  private async linkSourceImportUpload(client:pg.PoolClient,sourceImportId:string,uploadId:string) {
    const linked=await client.query("UPDATE source_imports SET upload_id=$1,updated_at=now() WHERE id=$2 AND state='importing' RETURNING id",[uploadId,sourceImportId]);
    if(!linked.rows.length) throw new ConflictException();
  }
  async part(req: Request, id: string, input: unknown) {
    requireCsrf(req, this.config);
    const upload = await this.upload(req, id, "editor");
    const data = body(
      z
        .object({
          partNumber: z.number().int().positive().max(10000),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      input,
    );
    if (
      upload.state !== "pending" ||
      upload.mode !== "multipart" ||
      !upload.upload_id ||
      upload.expires_at <= new Date() ||
      data.partNumber > Math.ceil(upload.expected_bytes / PART_BYTES)
    )
      throw new ConflictException();
    const bytes = Math.min(
      PART_BYTES,
      upload.expected_bytes - (data.partNumber - 1) * PART_BYTES,
    );
    const checksum = Buffer.from(data.sha256, "hex").toString("base64");
    const signingDate = await this.signatureTime(upload);
    await this.pool.query(
      "INSERT INTO upload_parts(upload_id,part_number,expected_bytes,sha256) VALUES($1,$2,$3,$4) ON CONFLICT(upload_id,part_number) DO UPDATE SET expected_bytes=EXCLUDED.expected_bytes,sha256=EXCLUDED.sha256",
      [upload.id, data.partNumber, bytes, data.sha256],
    );
    const url = await getSignedUrl(
      this.signer,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: upload.object_key,
        UploadId: upload.upload_id,
        PartNumber: data.partNumber,
        ContentLength: bytes,
        ChecksumSHA256: checksum,
      }),
      {
        expiresIn: 300,
        signingDate,
        signableHeaders: new Set(["content-length"]),
      },
    );
    return {
      url,
      bytes,
      headers: {},
      expiresInSeconds: 300,
    };
  }
  async parts(req: Request, id: string) {
    const upload = await this.upload(req, id);
    if (
      upload.state !== "pending" ||
      upload.mode !== "multipart" ||
      !upload.upload_id
    )
      throw new ConflictException();
    const response = await this.s3.send(
      new ListPartsCommand({
        Bucket: this.bucket,
        Key: upload.object_key,
        UploadId: upload.upload_id,
        MaxParts: 100,
      }),
    );
    return {
      items: (response.Parts ?? []).map((p) => ({
        partNumber: p.PartNumber,
        bytes: p.Size,
        etag: p.ETag,
        checksum: p.ChecksumSHA256,
      })),
    };
  }
  async confirm(req: Request, id: string, correlationId: string, sourceImportId?:string) {
    requireCsrf(req, this.config);
    await this.upload(req, id, "editor");
    return this.tx(async (c) => {
      const upload = (
        await c.query<Upload>("SELECT * FROM uploads WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0]!;
      const finalizeSourceImport=async()=>{
        if(!sourceImportId)return;
        const linked=await c.query("UPDATE source_imports SET state='succeeded',error_code=NULL,lease_until=now(),updated_at=now() WHERE id=$1 AND upload_id=$2 AND state IN ('importing','succeeded') RETURNING id",[sourceImportId,id]);
        if(!linked.rows.length)throw new ConflictException({code:"SOURCE_IMPORT_UPLOAD_REFERENCE_INVALID"});
      };
      if (upload.state === "confirmed") {await finalizeSourceImport();return { id, state: "confirmed" };}
      if (upload.state !== "pending" || upload.expires_at <= new Date())
        throw new ConflictException();
      if (upload.mode === "multipart") {
        let exists = false;
        try {
          const head = await this.s3.send(
            new HeadObjectCommand({
              Bucket: this.bucket,
              Key: upload.object_key,
            }),
          );
          exists = Boolean(head.ETag);
        } catch (error) {
          if (
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode !== 404
          )
            throw error;
        }
        if (!exists) {
          if (!upload.upload_id) throw new ConflictException();
          // Un video de 30 GiB tiene miles de partes: paginar ListParts.
          const parts: Part[] = [];
          let marker: string | undefined;
          for (;;) {
            const list = await this.s3.send(
              new ListPartsCommand({
                Bucket: this.bucket,
                Key: upload.object_key,
                UploadId: upload.upload_id,
                MaxParts: 1000,
                ...(marker ? { PartNumberMarker: marker } : {}),
              }),
            );
            parts.push(...(list.Parts ?? []));
            if (!list.IsTruncated || !list.NextPartNumberMarker) break;
            marker = String(list.NextPartNumberMarker);
          }
          const signedParts = (
            await c.query<{ part_number: number; sha256: string }>(
              "SELECT part_number,sha256 FROM upload_parts WHERE upload_id=$1",
              [id],
            )
          ).rows;
          const manifest = new Map(
            signedParts.map((p) => [
              p.part_number,
              Buffer.from(p.sha256, "hex").toString("base64"),
            ]),
          );
          if (
            parts.length !== Math.ceil(upload.expected_bytes / PART_BYTES) ||
            parts.some(
              (p, i) =>
                p.PartNumber !== i + 1 ||
                p.Size !==
                  Math.min(
                    PART_BYTES,
                    upload.expected_bytes - i * PART_BYTES,
                  ) ||
                !p.ETag ||
                !manifest.has(p.PartNumber ?? 0) ||
                Boolean(
                  p.ChecksumSHA256 &&
                  p.ChecksumSHA256 !== manifest.get(p.PartNumber ?? 0),
                ),
            )
          )
            throw new BadRequestException();
          // Ensamblar miles de partes excede el timeout corto normal.
          await this.importS3.send(
            new CompleteMultipartUploadCommand({
              Bucket: this.bucket,
              Key: upload.object_key,
              UploadId: upload.upload_id,
              MultipartUpload: {
                Parts: parts.map((p) => ({
                  ETag: p.ETag!,
                  PartNumber: p.PartNumber!,
                  ChecksumSHA256:
                    p.ChecksumSHA256 ?? manifest.get(p.PartNumber!)!,
                })),
              },
            }),
          );
        }
      }
      const head = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: upload.object_key,
          ChecksumMode: "ENABLED",
        }),
      );
      if (head.ContentLength !== upload.expected_bytes || !head.ETag)
        throw new BadRequestException();
      if (
        upload.mode === "put" &&
        head.ChecksumSHA256 &&
        head.ChecksumSHA256 !==
          Buffer.from(upload.sha256, "hex").toString("base64")
      )
        throw new BadRequestException();
      {
        const changed = await c.query(
          "UPDATE uploads SET state='confirmed',etag=$1 WHERE id=$2 AND state='pending' RETURNING id",
          [head.ETag, id],
        );
        if (!changed.rows.length) {
          const state = (
            await c.query<{ state: string }>(
              "SELECT state FROM uploads WHERE id=$1",
              [id],
            )
          ).rows[0]?.state;
          if (state !== "confirmed") throw new ConflictException();
          await finalizeSourceImport();
          return { id, state: "confirmed" };
        }
        await c.query(
          "UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$1,used_bytes=used_bytes+$1 WHERE workspace_id=$2",
          [upload.expected_bytes, upload.workspace_id],
        );
        await c.query(
          "INSERT INTO inspection_requests(upload_id,correlation_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [id, correlationId],
        );
        await finalizeSourceImport();
      }
      return { id, state: "confirmed" };
    });
  }
  async status(req: Request, id: string) {
    const upload = await this.upload(req, id);
    const result = {
      id,
      projectId: upload.project_id,
      state: upload.state,
      bytes: upload.expected_bytes,
      expiresAt: upload.expires_at.toISOString(),
    };
    if (upload.state !== "confirmed") return result;
    const delivered = (
      await this.pool.query<{ delivered_at: Date | null }>(
        "SELECT delivered_at FROM inspection_requests WHERE upload_id=$1",
        [id],
      )
    ).rows[0]?.delivered_at;
    if (!delivered) return { ...result, inspection: { status: "queued" } };
    const inspection = await internalJson(
      this.mediaUrl,
      "/v1/internal/inspection-status",
      this.config,
      { id, workspaceId: upload.workspace_id },
    );
    return { ...result, inspection };
  }
  async abort(req: Request, id: string) {
    requireCsrf(req, this.config);
    await this.upload(req, id, "editor");
    return this.tx(async (c) => {
      const upload = (
        await c.query<Upload>("SELECT * FROM uploads WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0]!;
      if (upload.state === "confirmed") throw new ConflictException();
      await c.query(
        "UPDATE uploads SET state='aborted',expires_at=GREATEST(now(),signed_until)+interval '30 seconds' WHERE id=$1 AND state='pending'",
        [id],
      );
      if (upload.upload_id)
        try {
          await this.s3.send(
            new AbortMultipartUploadCommand({
              Bucket: this.bucket,
              Key: upload.object_key,
              UploadId: upload.upload_id,
            }),
          );
        } catch {
          logger.warn({ code: "MULTIPART_ABORT_RETRY", uploadId: id });
        }
      return { aborted: true, quotaRelease: "after_signed_urls_expire" };
    });
  }
  private async cleanupExpiredUploads() {
    const expired = await this.pool.query<Upload>(
      "SELECT * FROM uploads WHERE cleaned_at IS NULL AND (state='aborted' OR state='pending') AND expires_at<now() LIMIT 25",
    );
    for (const upload of expired.rows) {
      await this.tx(async (c) => {
        const active = (
          await c.query<Upload>(
            "SELECT * FROM uploads WHERE id=$1 AND state<>'confirmed' AND cleaned_at IS NULL AND expires_at<now() FOR UPDATE",
            [upload.id],
          )
        ).rows[0];
        if (!active) return;
        if (active.upload_id)
          try {
            await this.s3.send(
              new AbortMultipartUploadCommand({
                Bucket: this.bucket,
                Key: active.object_key,
                UploadId: active.upload_id,
              }),
            );
          } catch (error) {
            if (
              (error as { $metadata?: { httpStatusCode?: number } }).$metadata
                ?.httpStatusCode !== 404
            )
              throw error;
          }
        await this.s3.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: active.object_key,
          }),
        );
        const changed = await c.query(
          "UPDATE uploads SET state='aborted',cleaned_at=now() WHERE id=$1 AND state<>'confirmed' AND cleaned_at IS NULL RETURNING id",
          [active.id],
        );
        if (changed.rows.length)
          await c.query(
            "UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$1 WHERE workspace_id=$2",
            [active.expected_bytes, active.workspace_id],
          );
      });
    }
  }
  private async cleanupFailedSourceImports() {
    const now=Date.now();
    if(now<this.nextFailedSourceImportCleanupAt)return;
    this.nextFailedSourceImportCleanupAt=now+FAILED_SOURCE_IMPORT_CLEANUP_INTERVAL_MS;
    try {
      await cleanupExpiredFailedSourceImports(this.pool);
    } catch {
      this.nextFailedSourceImportCleanupAt=Date.now()+5000;
      logger.warn({code:"FAILED_SOURCE_IMPORT_CLEANUP_RETRY"});
    }
  }
  private async dispatch() {
    await this.usage.dispatch();
    await this.derivatives.dispatch();
    await this.analyses.dispatch();
    await this.pipelines.dispatch();
    const rows = await this.pool.query<Upload & { correlation_id: string }>(
      "SELECT u.*,r.correlation_id FROM inspection_requests r JOIN uploads u ON u.id=r.upload_id WHERE r.delivered_at IS NULL ORDER BY r.created_at LIMIT 25",
    );
    for (const upload of rows.rows) {
      try {
        await internalJson(
          this.mediaUrl,
          "/v1/internal/inspections",
          this.config,
          {
            id: upload.id,
            workspaceId: upload.workspace_id,
            creatorId: upload.creator_id,
            objectKey: upload.object_key,
            expectedBytes: upload.expected_bytes,
            expectedEtag: upload.etag,
            expectedSha256: upload.sha256,
            correlationId: upload.correlation_id,
          },
        );
        await this.pool.query(
          "UPDATE inspection_requests SET delivered_at=now() WHERE upload_id=$1",
          [upload.id],
        );
      } catch {
        logger.warn({
          code: "INSPECTION_ADMISSION_RETRY",
          uploadId: upload.id,
        });
      }
    }
    await this.cleanupExpiredUploads();
    await this.cleanupFailedSourceImports();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.working;
    this.youtubeMetadataClient.close();
    this.s3.destroy();
    this.importS3.destroy();
    this.signer.destroy();
    await this.pool.end();
  }
  private async signatureTime(upload: Upload) {
    const signingDate = new Date();
    const expires = new Date(signingDate.getTime() + 300000);
    const update = await this.pool.query(
      "UPDATE uploads SET signed_until=GREATEST(signed_until,$2),expires_at=GREATEST(expires_at,$2) WHERE id=$1 AND state='pending' AND expires_at>now() RETURNING id",
      [upload.id, expires],
    );
    if (!update.rows.length) throw new ConflictException();
    return signingDate;
  }
}
