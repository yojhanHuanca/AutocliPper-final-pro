import {BadRequestException,ConflictException,ForbiddenException,HttpException,NotFoundException} from "@nestjs/common";
import type {Request} from "express";
import type pg from "pg";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {analysisStatus,LOCAL_TRANSCRIPTION_MAX_SECONDS,pipelineSpec,type AnalysisStatus,type PipelineSpec,type ProcessingStatus,type ValidatedProcessingSpec, MAX_AUDIO_BYTES } from "@autoclipper/api-contracts";
import {authenticatedUser,body,digest,internalJson,requireCsrf,uuid,workspaceAccess,type ServiceConfig} from "@autoclipper/http-security";
import {logger} from "@autoclipper/observability";
import type {DerivativesManager} from "./derivatives.manager.js";
import {transcriptClip} from "./transcript-clip.js";
import type {UsageManager} from "./usage.manager.js";
import type {UsageReservation} from "@autoclipper/api-contracts";
import {aggregateClipOutcome,pipelineStorageReservation} from "./pipeline-clips.js";
import { WORKSPACE_STORAGE_LIMIT_BYTES } from "./storage-limit.js";

const AUDIO_BYTES=MAX_AUDIO_BYTES,RENDER_BYTES=68157440;
type Status="queued"|"audio"|"analysis"|"render"|"stopping"|"succeeded"|"partial_failed"|"failed"|"cancelled";
type Row={id:string;upload_id:string;project_id:string;workspace_id:string;creator_id:string;request_hash:string;spec:PipelineSpec;correlation_id:string;status:Status;version:number;remaining_reservation_bytes:number;cancel_requested:boolean;error_code:string|null;created_at:Date;deadline_at:Date;finished_at:Date|null;usage_state:"legacy"|"pending"|"accepted"|"rejected";usage_spec:UsageReservation|null;usage_error:string|null};
type Processing={id:string;status:string;settled_at:Date|null;error_code?:string|null;result:ProcessingStatus["result"]};
type Analysis={id:string;finished_at:Date|null;cached_status:AnalysisStatus|null};
const preflight=z.object({ready:z.boolean(),code:z.string().nullable(),httpStatus:z.number().int().min(200).max(599)}).strict();

// Project owns the intent, stage references and quota. Child request rows are its
// transactional outboxes; Media/Analysis remain the sole owners of execution.
export class PipelineManager {
  private cursor:string|undefined;
  constructor(private readonly pool:pg.Pool,private readonly config:ServiceConfig,private readonly analysisUrl:string,private readonly derivatives:DerivativesManager,private readonly usage:UsageManager){}
  private async tx<T>(work:(client:pg.PoolClient)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const value=await work(client);await client.query("COMMIT");return value;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  async begin(req:Request,uploadId:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);
    const spec=body(pipelineSpec,input),user=await authenticatedUser(req,this.config),key=uuid(String(req.headers["idempotency-key"]??"")),hash=digest(JSON.stringify({uploadId,spec}));
    const prior=(await this.pool.query<Row>("SELECT * FROM pipelines WHERE creator_id=$1 AND idempotency_key=$2",[user.id,key])).rows[0];
    if(prior){
      // A retry must return its committed pipeline even if Analysis/Media are
      // temporarily unavailable. Reauthorize the stored upload before exposing it.
      await this.derivatives.authorizeUpload(req,prior.upload_id,"editor");
      if(prior.request_hash!==hash)throw new ConflictException();
      return this.present(prior);
    }
    const source=await this.derivatives.sourceForEditor(req,uploadId);
    if(!source.metadata.audioCodec)throw new BadRequestException();
    if(source.metadata.durationSeconds>LOCAL_TRANSCRIPTION_MAX_SECONDS)throw new HttpException({code:"LOCAL_TRANSCRIPTION_DURATION_LIMIT"},400);
    if(spec.version===1&&spec.endSeconds>source.metadata.durationSeconds)throw new BadRequestException();
    const checked=body(preflight,await internalJson(this.analysisUrl,"/v1/internal/analysis-preflight",this.config,{spec:this.analysisSpec(spec),durationSeconds:source.metadata.durationSeconds}));
    if(!checked.ready)throw new HttpException({code:checked.code},checked.httpStatus);
    const row=await this.tx(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`pipeline-idempotency:${user.id}:${key}`]);
      const existing=(await client.query<Row>("SELECT * FROM pipelines WHERE creator_id=$1 AND idempotency_key=$2",[user.id,key])).rows[0];
      if(existing){if(existing.request_hash!==hash)throw new ConflictException();return existing;}
      const quota=(await client.query("SELECT workspace_id FROM workspace_storage WHERE workspace_id=$1 FOR UPDATE",[source.upload.workspace_id])).rows[0];if(!quota)throw new ConflictException();
      const count=(await client.query<{count:string}>("SELECT count(*) FROM pipelines WHERE workspace_id=$1 AND finished_at IS NULL",[source.upload.workspace_id])).rows[0];if(Number(count?.count??0)>=4)throw new ConflictException();
      const renderCount=spec.version===1?1:spec.clipCount,reservation=pipelineStorageReservation(spec);
      const reserved=await client.query("UPDATE workspace_storage SET reserved_bytes=reserved_bytes+$1 WHERE workspace_id=$2 AND used_bytes+reserved_bytes+$1<=$3 RETURNING workspace_id",[reservation,source.upload.workspace_id,WORKSPACE_STORAGE_LIMIT_BYTES]);if(!reserved.rows[0])throw new ConflictException();
      const id=randomUUID(),clipSeconds=spec.version===1?spec.endSeconds-spec.startSeconds:Math.min(source.metadata.durationSeconds,renderCount*(spec.maxDurationSeconds??120)),created=(await client.query<Row>("INSERT INTO pipelines(id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,spec,correlation_id,remaining_reservation_bytes,usage_spec) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",[id,uploadId,source.upload.project_id,source.upload.workspace_id,user.id,key,hash,spec,correlationId,reservation,{version:1,pipelineId:id,workspaceId:source.upload.workspace_id,creatorId:user.id,sourceSeconds:source.metadata.durationSeconds,clipSeconds}])).rows[0]!;
      await client.query("INSERT INTO pipeline_events(pipeline_id,version,status) VALUES($1,1,'queued')",[id]);return created;
    });return this.present(row);
  }
  private analysisSpec(spec:PipelineSpec){return spec.version===1?{version:1,provider:"whisper_cpp",language:spec.language,selection:{mode:"none"}}:{version:1,provider:"whisper_cpp",language:spec.language,selection:spec.selectionMode==="llm"?{mode:"llm",count:spec.clipCount,minSeconds:1,maxSeconds:spec.maxDurationSeconds??120,contentType:spec.contentType,instructions:spec.instructions}:{mode:"local",count:spec.clipCount,minSeconds:1,maxSeconds:spec.maxDurationSeconds??120}};}
  private async resource(req:Request,id:string,minimum:"reader"|"editor"="reader"){
    const row=(await this.pool.query<Row>("SELECT * FROM pipelines WHERE id=$1",[id])).rows[0];if(!row)throw new NotFoundException();
    await this.derivatives.authorizeUpload(req,row.upload_id,minimum);return row;
  }
  private async children(client:pg.Pool|pg.PoolClient,id:string){
    const processed=(await client.query<Processing&{kind:"audio"|"clip";pipeline_clip_index:number|null}>("SELECT id,status,settled_at,result,error_code,spec->>'kind' AS kind,pipeline_clip_index FROM processing_requests WHERE pipeline_id=$1 ORDER BY pipeline_clip_index NULLS FIRST",[id])).rows;
    const analysis=(await client.query<Analysis>("SELECT id,finished_at,cached_status FROM analysis_requests WHERE pipeline_id=$1",[id])).rows[0];
    const renders=processed.filter(row=>row.kind==="clip");return{audio:processed.find(row=>row.kind==="audio"),render:renders[0],renders,analysis};
  }
  private async present(row:Row){
    const child=await this.children(this.pool,row.id),events=(await this.pool.query<{version:number;status:string;at:Date}>("SELECT version,status,at FROM pipeline_events WHERE pipeline_id=$1 ORDER BY version LIMIT 20",[row.id])).rows;
    const proposals=child.analysis?.cached_status?.selection?.segments??[];
    const clips=row.spec.version===2?proposals.map((proposal,index)=>{
      const render=child.renders.find(item=>item.pipeline_clip_index===index);
      return{index,status:render?.status==="succeeded"?"succeeded":render?.status==="failed"?"failed":render?.status==="cancelled"?"cancelled":render?.status==="running"?"running":"queued",title:proposal.title,startSeconds:proposal.startSeconds,endSeconds:proposal.endSeconds,processingId:render?.id??null,errorCode:render?.error_code??null};
    }):undefined;
    return{id:row.id,status:row.status,spec:row.spec,version:row.version,cancellationRequested:row.cancel_requested,usageState:row.usage_state,errorCode:row.error_code,createdAt:row.created_at.toISOString(),deadlineAt:row.deadline_at.toISOString(),finishedAt:row.finished_at?.toISOString()??null,audioProcessingId:child.audio?.id??null,analysisId:child.analysis?.id??null,renderProcessingId:child.render?.id??null,...(clips?{clips,requestedClips:row.spec.version===2?row.spec.clipCount:0,completedClips:clips.filter(clip=>clip.status==="succeeded").length,settledClips:clips.filter(clip=>["succeeded","failed","cancelled"].includes(clip.status)).length}:{}),reservedBytes:row.remaining_reservation_bytes,events:events.map(event=>({...event,at:event.at.toISOString()}))};
  }
  async status(req:Request,id:string){return this.present(await this.resource(req,id));}
  async cancel(req:Request,id:string){requireCsrf(req,this.config);await this.resource(req,id,"editor");return this.tx(async client=>{const row=(await client.query<Row>("SELECT * FROM pipelines WHERE id=$1 FOR UPDATE",[id])).rows[0]!;if(row.finished_at)throw new ConflictException();await client.query("UPDATE pipelines SET cancel_requested=true WHERE id=$1",[id]);return{cancellationRequested:true};});}
  async download(req:Request,id:string,kind:string){const row=await this.resource(req,id);if(row.spec.version===2)throw new ConflictException();const selected=body(z.enum(["video","srt","vtt"]),kind);if(row.status!=="succeeded")throw new ConflictException();const child=await this.children(this.pool,id);if(!child.render)throw new ConflictException();return this.derivatives.download(req,child.render.id,selected);}
  async downloadClip(req:Request,id:string,index:number,kind:string){const row=await this.resource(req,id);if(row.spec.version!==2)throw new NotFoundException();const selectedIndex=body(z.number().int().min(0).max(2),index),selected=body(z.enum(["video","srt","vtt"]),kind),child=await this.pool.query<Processing&{pipeline_clip_index:number|null}>("SELECT id,status,settled_at,result,error_code,pipeline_clip_index FROM processing_requests WHERE pipeline_id=$1 AND pipeline_clip_index=$2",[id,selectedIndex]);const render=child.rows[0];if(!render||render.status!=="succeeded")throw new ConflictException();return this.derivatives.download(req,render.id,selected);}
  private async transition(client:pg.PoolClient,row:Row,status:Status){
    if(row.status===status)return;
    await client.query("UPDATE pipelines SET status=$2,version=version+1 WHERE id=$1",[row.id,status]);
    await client.query("INSERT INTO pipeline_events(pipeline_id,version,status) VALUES($1,$2,$3)",[row.id,row.version+1,status]);row.status=status;row.version++;
  }
  private async finish(client:pg.PoolClient,row:Row,status:"succeeded"|"partial_failed"|"failed"|"cancelled"){
    if(!await this.usage.reconciled(client,row))return;
    if(row.remaining_reservation_bytes)await client.query("UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$1 WHERE workspace_id=$2",[row.remaining_reservation_bytes,row.workspace_id]);
    // All three statements commit together; the CHECK requires zero at terminal.
    await client.query("UPDATE pipelines SET remaining_reservation_bytes=0,finished_at=now(),status=$2,version=version+1 WHERE id=$1",[row.id,status]);
    await client.query("INSERT INTO pipeline_events(pipeline_id,version,status) VALUES($1,$2,$3)",[row.id,row.version+1,status]);
  }
  private async processing(client:pg.PoolClient,row:Row,spec:ValidatedProcessingSpec,reservation:number,pipelineClipIndex:number|null=null){
    if(pipelineClipIndex!==null){const prior=(await client.query("SELECT id FROM processing_requests WHERE pipeline_id=$1 AND pipeline_clip_index=$2",[row.id,pipelineClipIndex])).rows[0];if(prior)return true;}
    await client.query("SELECT workspace_id FROM workspace_storage WHERE workspace_id=$1 FOR UPDATE",[row.workspace_id]);
    const count=(await client.query<{count:string}>("SELECT count(*) FROM processing_requests WHERE workspace_id=$1 AND settled_at IS NULL",[row.workspace_id])).rows[0];if(Number(count?.count??0)>=4)return false;
    const id=randomUUID(),hash=digest(JSON.stringify({uploadId:row.upload_id,spec}));
    await client.query("INSERT INTO processing_requests(id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,spec,reservation_bytes,correlation_id,pipeline_id,pipeline_clip_index) VALUES($1,$2,$3,$4,$5,$1,$6,$7,$8,$9,$10,$11)",[id,row.upload_id,row.project_id,row.workspace_id,row.creator_id,hash,spec,reservation,row.correlation_id,row.id,pipelineClipIndex]);
    await client.query("UPDATE pipelines SET remaining_reservation_bytes=remaining_reservation_bytes-$2 WHERE id=$1",[row.id,reservation]);return true;
  }
  async dispatch(){
    const rows=(await this.pool.query<Row>("SELECT * FROM pipelines WHERE finished_at IS NULL AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 25",[this.cursor??null])).rows;this.cursor=rows.length===25?rows.at(-1)?.id:undefined;
    for(const row of rows)try{
      let revoked=false;
      try{await workspaceAccess(this.config,row.creator_id,row.workspace_id,"editor");}catch(error){if(error instanceof ForbiddenException)revoked=true;else if(!row.cancel_requested&&row.deadline_at.getTime()>Date.now())throw error;}
      await this.advance(row.id,revoked);
    }catch(error){
      const diagnostic=error&&typeof error==="object"?error as {name?:unknown;code?:unknown;constraint?:unknown}:undefined;
      logger.warn({code:"PIPELINE_RECONCILIATION_RETRY",pipelineId:row.id,errorName:diagnostic?.name,errorCode:diagnostic?.code,constraint:diagnostic?.constraint});
    }
  }
  private async advance(id:string,revoked:boolean){return this.tx(async client=>{
    const row=(await client.query<Row>("SELECT * FROM pipelines WHERE id=$1 AND finished_at IS NULL FOR UPDATE SKIP LOCKED",[id])).rows[0];if(!row)return;
    const active=(await client.query("SELECT u.id FROM uploads u JOIN projects p ON p.id=u.project_id WHERE u.id=$1 AND u.state='confirmed' AND p.deleted_at IS NULL",[row.upload_id])).rows[0];
    const children=await this.children(client,id);
    let error=row.error_code;
    if(!error&&!row.cancel_requested){
      if(row.usage_state==="rejected")error=`PIPELINE_${row.usage_error??"USAGE_REJECTED"}`;
      else if(!active||revoked)error="PIPELINE_AUTHORIZATION_REVOKED";
      else if(row.deadline_at.getTime()<=Date.now())error="PIPELINE_DEADLINE_EXCEEDED";
      else if(children.audio&&["failed","cancelled"].includes(children.audio.status))error="PIPELINE_MEDIA_STAGE_FAILED";
      else if(row.spec.version===1&&children.render&&["failed","cancelled"].includes(children.render.status))error="PIPELINE_MEDIA_STAGE_FAILED";
      else if(children.analysis?.finished_at&&children.analysis.cached_status?.status!=="succeeded")error="PIPELINE_ANALYSIS_STAGE_FAILED";
    }
    await this.usage.capture(client,row,children,row.cancel_requested||Boolean(error)||row.status==="stopping");
    if(row.cancel_requested||error||row.status==="stopping"){
      if(error&&!row.error_code){await client.query("UPDATE pipelines SET error_code=$2 WHERE id=$1",[id,error]);row.error_code=error;}
      await this.transition(client,row,"stopping");
      await client.query("UPDATE processing_requests SET cancel_requested=true WHERE pipeline_id=$1 AND settled_at IS NULL",[id]);
      await client.query("UPDATE analysis_requests SET cancel_requested=true WHERE pipeline_id=$1 AND finished_at IS NULL",[id]);
      if([children.audio,...children.renders].every(child=>!child||child.settled_at)&&(!children.analysis||children.analysis.finished_at))await this.finish(client,row,row.error_code?"failed":"cancelled");return;
    }
    if(row.usage_state==="pending")return;
    if(row.status==="queued"){
      if(await this.processing(client,row,{version:1,kind:"audio"},AUDIO_BYTES))await this.transition(client,row,"audio");
    }else if(row.status==="audio"&&children.audio?.settled_at){
      const audio=children.audio.result?.artifacts.find(artifact=>artifact.kind==="audio");if(!audio||!children.audio.result)throw new ConflictException();
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`analysis-workspace:${row.workspace_id}`]);
      const count=(await client.query<{count:string}>("SELECT count(*) FROM analysis_requests WHERE workspace_id=$1 AND finished_at IS NULL",[row.workspace_id])).rows[0];if(Number(count?.count??0)>=4)return;
      const analysisId=randomUUID(),spec=this.analysisSpec(row.spec),source={audioProcessingId:children.audio.id,objectKey:audio.objectKey,expectedBytes:audio.bytes,expectedEtag:audio.etag,expectedSha256:audio.sha256,durationSeconds:children.audio.result.durationSeconds};
      await client.query("INSERT INTO analysis_requests(id,audio_processing_id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,source,spec,correlation_id,pipeline_id) VALUES($1,$2,$3,$4,$5,$6,$1,$7,$8,$9,$10,$11)",[analysisId,children.audio.id,row.upload_id,row.project_id,row.workspace_id,row.creator_id,digest(JSON.stringify({audioId:children.audio.id,spec})),source,spec,row.correlation_id,id]);
      await this.transition(client,row,"analysis");
    }else if(row.status==="analysis"&&children.analysis?.finished_at){
      const state=body(analysisStatus,children.analysis.cached_status);
      if(row.spec.version===1){
        let spec:ValidatedProcessingSpec;
        try{spec=transcriptClip(state,{version:1,startSeconds:row.spec.startSeconds,endSeconds:row.spec.endSeconds,aspect:row.spec.aspect});}
        catch{await client.query("UPDATE pipelines SET error_code='PIPELINE_INVALID_CAPTIONS' WHERE id=$1",[id]);await this.transition(client,row,"stopping");return;}
        if(await this.processing(client,row,spec,RENDER_BYTES))await this.transition(client,row,"render");
      }else{
        const proposals=state.selection?.segments;
        if(state.status!=="succeeded"||!proposals||proposals.length!==row.spec.clipCount){await client.query("UPDATE pipelines SET error_code='PIPELINE_INVALID_SELECTION' WHERE id=$1",[id]);await this.transition(client,row,"stopping");return;}
        const subtitles=row.spec.subtitles.source,style=row.spec.subtitles.source==="transcript"?row.spec.subtitles.style:undefined;
        for(let index=0;index<proposals.length;index++){
          let renderSpec:ValidatedProcessingSpec;
          try{renderSpec=transcriptClip(state,{version:1,proposalIndex:index,aspect:row.spec.aspect,subtitles});if(renderSpec.kind==="clip"&&renderSpec.subtitles&&style)renderSpec={...renderSpec,subtitles:{...renderSpec.subtitles,style}};}
          catch{await client.query("UPDATE pipelines SET error_code='PIPELINE_INVALID_SELECTION' WHERE id=$1",[id]);await this.transition(client,row,"stopping");return;}
          if(!await this.processing(client,row,renderSpec,RENDER_BYTES,index))return;
        }
        await this.transition(client,row,"render");
      }
    }else if(row.status==="render"){
      if(row.spec.version===1&&children.render?.settled_at)await this.finish(client,row,"succeeded");
      else if(row.spec.version===2){const aggregate=aggregateClipOutcome(row.spec.clipCount,children.renders.map(child=>child.status as "queued"|"running"|"succeeded"|"failed"|"cancelled"));if(aggregate){if(aggregate==="partial_failed"||aggregate==="failed"){row.error_code=aggregate==="partial_failed"?"PIPELINE_SOME_CLIPS_FAILED":"PIPELINE_ALL_CLIPS_FAILED";await client.query("UPDATE pipelines SET error_code=$2 WHERE id=$1",[id,row.error_code]);}await this.finish(client,row,aggregate);}}
    }
  });}
}
