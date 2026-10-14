import {BadRequestException,ConflictException,NotFoundException} from "@nestjs/common";
import type {Request} from "express";
import type pg from "pg";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {GetObjectCommand,HeadObjectCommand,type S3Client} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {body,digest,uuid,authenticatedUser,requireCsrf,internalJson,type ServiceConfig} from "@autoclipper/http-security";
import {processingSpec,processingStatus,type ProcessingStatus,type ProcessingSpec} from "@autoclipper/api-contracts";
import {logger} from "@autoclipper/observability";

type Upload={id:string;project_id:string;workspace_id:string;state:string};
type Row={id:string;upload_id:string;project_id:string;workspace_id:string;creator_id:string;request_hash:string;spec:ProcessingSpec;reservation_bytes:number;status:ProcessingStatus["status"];attempts:number;error_code:string|null;result:ProcessingStatus["result"];started_at:Date|null;finished_at:Date|null;cleanup_pending:boolean;delivered_at:Date|null;cancel_requested:boolean;cancel_delivered_at:Date|null;settled_at:Date|null};
const terminal=(status:string)=>["succeeded","failed","cancelled"].includes(status);
export class DerivativesManager {
  private cursor:string|undefined;
  constructor(private readonly pool:pg.Pool,private readonly config:ServiceConfig,private readonly mediaUrl:string,private readonly bucket:string,private readonly s3:S3Client,private readonly signer:S3Client,private readonly authorize:(req:Request,id:string,minimum:"reader"|"editor")=>Promise<Upload>){}
  private async tx<T>(work:(client:pg.PoolClient)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  async begin(req:Request,uploadId:string,input:unknown,correlationId:string) {
    requireCsrf(req,this.config);
    const spec=body(processingSpec,input),upload=await this.authorize(req,uploadId,"editor");
    if(upload.state!=="confirmed")throw new ConflictException();
    const source=await internalJson<{status:string;result?:{durationSeconds:number;audioCodec:string|null;width:number;height:number}}>(this.mediaUrl,"/v1/internal/inspection-status",this.config,{id:upload.id,workspaceId:upload.workspace_id});
    if(source.status!=="succeeded"||!source.result)throw new ConflictException();
    if(source.result.width>3840||source.result.height>3840||(spec.kind==="clip"&&spec.endSeconds>source.result.durationSeconds)||(spec.kind==="audio"&&(!source.result.audioCodec||source.result.durationSeconds>3600)))throw new BadRequestException();
    const user=await authenticatedUser(req,this.config),key=uuid(String(req.headers["idempotency-key"]??"")),hash=digest(JSON.stringify({uploadId,spec}));
    const reservation=spec.kind==="audio"?134217728:68157440;
    return this.tx(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${user.id}:${key}`]);
      const prior=(await client.query<Row>("SELECT * FROM processing_requests WHERE creator_id=$1 AND idempotency_key=$2",[user.id,key])).rows[0];
      if(prior){if(prior.request_hash!==hash)throw new ConflictException();return{id:prior.id,status:prior.status};}
      const quota=await client.query("SELECT workspace_id FROM workspace_storage WHERE workspace_id=$1 FOR UPDATE",[upload.workspace_id]);
      if(!quota.rows[0])throw new ConflictException();
      const count=(await client.query<{count:string}>("SELECT count(*) FROM processing_requests WHERE workspace_id=$1 AND settled_at IS NULL",[upload.workspace_id])).rows[0];
      if(Number(count?.count??0)>=4)throw new ConflictException();
      const reserved=await client.query("UPDATE workspace_storage SET reserved_bytes=reserved_bytes+$1 WHERE workspace_id=$2 AND used_bytes+reserved_bytes+$1<=$3 RETURNING workspace_id",[reservation,upload.workspace_id,Number(process.env["WORKSPACE_STORAGE_LIMIT_BYTES"]??1073741824)]);
      if(!reserved.rows[0])throw new ConflictException();
      const id=randomUUID();
      await client.query("INSERT INTO processing_requests(id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,spec,reservation_bytes,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[id,upload.id,upload.project_id,upload.workspace_id,user.id,key,hash,spec,reservation,correlationId]);
      return{id,status:"queued"};
    });
  }
  private async resource(req:Request,id:string,minimum:"reader"|"editor"="reader") {
    const row=(await this.pool.query<Row>("SELECT * FROM processing_requests WHERE id=$1",[id])).rows[0];
    if(!row)throw new NotFoundException();
    await this.authorize(req,row.upload_id,minimum);return row;
  }
  private async synchronize(row:Row) {
    if(!row.delivered_at||row.settled_at)return row;
    const status=body(processingStatus,await internalJson(this.mediaUrl,"/v1/internal/processing-status",this.config,{id:row.id,workspaceId:row.workspace_id}));
    if(status.id!==row.id||(status.status==="succeeded"&&!status.result))throw new ConflictException();
    let bytes=0;
    for(const artifact of status.result?.artifacts??[]) {
      if(!artifact.objectKey.startsWith(`workspaces/${row.workspace_id}/media/derivatives/${row.id}/`)||artifact.objectKey.includes(".."))throw new ConflictException();
      bytes+=artifact.bytes;
    }
    if(bytes>row.reservation_bytes)throw new ConflictException();
    return this.tx(async client=>{
      const current=(await client.query<Row>("SELECT * FROM processing_requests WHERE id=$1 FOR UPDATE",[row.id])).rows[0]!;
      if(current.settled_at)return current;
      const settle=terminal(status.status)&&!status.cleanupPending;
      if(settle)await client.query("UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$1,used_bytes=used_bytes+$2 WHERE workspace_id=$3",[current.reservation_bytes,status.status==="succeeded"?bytes:0,current.workspace_id]);
      return(await client.query<Row>("UPDATE processing_requests SET status=$2,attempts=$3,error_code=$4,started_at=$5,finished_at=$6,result=$7,cleanup_pending=$8,settled_at=$9 WHERE id=$1 RETURNING *",[row.id,status.status,status.attempts,status.errorCode,status.startedAt,status.finishedAt,status.result,status.cleanupPending,settle?new Date():null])).rows[0]!;
    });
  }
  private present(row:Row){return{id:row.id,status:row.status,attempts:row.attempts,errorCode:row.error_code,startedAt:row.started_at?.toISOString()??null,finishedAt:row.finished_at?.toISOString()??null,cleanupPending:row.cleanup_pending,spec:row.spec,artifacts:(row.result?.artifacts??[]).map(a=>({kind:a.kind,bytes:a.bytes,sha256:a.sha256,contentType:a.contentType})),durationSeconds:row.result?.durationSeconds??null,width:row.result?.width,height:row.result?.height,sampleRate:row.result?.sampleRate};}
  async status(req:Request,id:string){return this.present(await this.synchronize(await this.resource(req,id)));}
  async list(req:Request,projectId:string) {
    const rows=(await this.pool.query<Row>("SELECT * FROM processing_requests WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",[projectId])).rows;
    if(rows[0])await this.authorize(req,rows[0].upload_id,"reader");
    return {items:rows.map(row=>this.present(row))};
  }
  async cancel(req:Request,id:string){requireCsrf(req,this.config);const row=await this.synchronize(await this.resource(req,id,"editor"));if(terminal(row.status))throw new ConflictException();await this.pool.query("UPDATE processing_requests SET cancel_requested=true WHERE id=$1 AND settled_at IS NULL",[id]);return {cancellationRequested:true};}
  async download(req:Request,id:string,kind:string) {
    const selected=body(z.enum(["video","audio","srt","vtt"]),kind),row=await this.synchronize(await this.resource(req,id));
    if(row.status!=="succeeded")throw new ConflictException();
    const artifact=row.result?.artifacts.find(a=>a.kind===selected);if(!artifact)throw new NotFoundException();
    const actual=await this.s3.send(new HeadObjectCommand({Bucket:this.bucket,Key:artifact.objectKey}));
    if(actual.ContentLength!==artifact.bytes||actual.ETag!==artifact.etag)throw new ConflictException();
    const filename=artifact.kind==="video"?"clip.mp4":artifact.kind==="audio"?"audio.wav":`captions.${artifact.kind}`;
    const url=await getSignedUrl(this.signer,new GetObjectCommand({Bucket:this.bucket,Key:artifact.objectKey,ResponseContentDisposition:`attachment; filename="${filename}"`,ResponseContentType:artifact.contentType}),{expiresIn:120});
    return {url,expiresInSeconds:120,contentType:artifact.contentType,bytes:artifact.bytes,sha256:artifact.sha256};
  }
  async dispatch() {
    const pending=(await this.pool.query<Row&{correlation_id:string}>("SELECT * FROM processing_requests WHERE delivered_at IS NULL ORDER BY created_at LIMIT 25")).rows;
    for(const row of pending)try {
      await internalJson(this.mediaUrl,"/v1/internal/processing",this.config,{id:row.id,workspaceId:row.workspace_id,inspectionId:row.upload_id,spec:row.spec,correlationId:row.correlation_id,cancelRequested:row.cancel_requested});
      await this.pool.query("UPDATE processing_requests SET delivered_at=now() WHERE id=$1",[row.id]);
    }catch{logger.warn({code:"DERIVATIVE_ADMISSION_RETRY",taskId:row.id});}
    const rows=(await this.pool.query<Row>("SELECT * FROM processing_requests WHERE settled_at IS NULL AND delivered_at IS NOT NULL AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 25",[this.cursor??null])).rows;
    this.cursor=rows.length===25?rows.at(-1)?.id:undefined;
    for(const row of rows)try{
      if(row.cancel_requested&&!row.cancel_delivered_at){await internalJson(this.mediaUrl,"/v1/internal/processing-cancel",this.config,{id:row.id,workspaceId:row.workspace_id});await this.pool.query("UPDATE processing_requests SET cancel_delivered_at=now() WHERE id=$1",[row.id]);}
      await this.synchronize(row);
    }catch{logger.warn({code:"DERIVATIVE_RECONCILIATION_RETRY",taskId:row.id});}
  }
}
