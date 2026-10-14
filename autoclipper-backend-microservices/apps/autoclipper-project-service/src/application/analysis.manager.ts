import {BadRequestException,ConflictException,HttpException,NotFoundException} from "@nestjs/common";
import type {Request} from "express";
import type pg from "pg";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {analysisSpec,analysisStatus,transcriptRenderSpec,type AnalysisSpec,type AnalysisStatus} from "@autoclipper/api-contracts";
import {authenticatedUser,body,digest,internalJson,requireCsrf,uuid,type ServiceConfig} from "@autoclipper/http-security";
import {logger} from "@autoclipper/observability";
import type {DerivativesManager} from "./derivatives.manager.js";

type Audio=Awaited<ReturnType<DerivativesManager["audioForAnalysis"]>>;
type Row={id:string;audio_processing_id:string;upload_id:string;project_id:string;workspace_id:string;creator_id:string;request_hash:string;source:Audio["source"];spec:AnalysisSpec;correlation_id:string;delivered_at:Date|null;cancel_requested:boolean;cancel_delivered_at:Date|null;finished_at:Date|null;cached_status:AnalysisStatus|null};
const terminal=(status:string)=>["succeeded","failed","cancelled"].includes(status);
const preflight=z.object({ready:z.boolean(),code:z.string().nullable(),httpStatus:z.number().int().min(200).max(599)}).strict();
export class AnalysisManager {
  private cursor:string|undefined;
  constructor(private readonly pool:pg.Pool,private readonly config:ServiceConfig,private readonly url:string,private readonly derivatives:DerivativesManager,private readonly authorize:(req:Request,id:string,minimum:"reader"|"editor")=>Promise<unknown>){}
  private async tx<T>(work:(client:pg.PoolClient)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  async providers(req:Request){await authenticatedUser(req,this.config);return internalJson(this.url,"/v1/internal/analysis-providers",this.config,{});}
  async begin(req:Request,audioId:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);
    const audio=await this.derivatives.audioForAnalysis(req,audioId),spec=body(analysisSpec,input),user=await authenticatedUser(req,this.config),key=uuid(String(req.headers["idempotency-key"]??"")),hash=digest(JSON.stringify({audioId,spec}));
    const prior=(await this.pool.query<Row>("SELECT * FROM analysis_requests WHERE creator_id=$1 AND idempotency_key=$2",[user.id,key])).rows[0];
    if(prior){if(prior.request_hash!==hash)throw new ConflictException();return{id:prior.id,status:prior.cached_status?.status??"queued"};}
    const checked=body(preflight,await internalJson(this.url,"/v1/internal/analysis-preflight",this.config,{spec,durationSeconds:audio.source.durationSeconds}));
    if(!checked.ready)throw new HttpException({code:checked.code},checked.httpStatus);
    return this.tx(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`analysis-idempotency:${user.id}:${key}`]);
      const existing=(await client.query<Row>("SELECT * FROM analysis_requests WHERE creator_id=$1 AND idempotency_key=$2",[user.id,key])).rows[0];
      if(existing){if(existing.request_hash!==hash)throw new ConflictException();return{id:existing.id,status:existing.cached_status?.status??"queued"};}
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`analysis-workspace:${audio.workspaceId}`]);
      const count=(await client.query<{count:string}>("SELECT count(*) FROM analysis_requests WHERE workspace_id=$1 AND finished_at IS NULL",[audio.workspaceId])).rows[0];if(Number(count?.count??0)>=4)throw new ConflictException();
      const id=randomUUID();await client.query("INSERT INTO analysis_requests(id,audio_processing_id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,source,spec,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[id,audioId,audio.uploadId,audio.projectId,audio.workspaceId,user.id,key,hash,audio.source,spec,correlationId]);return{id,status:"queued"};
    });
  }
  private async resource(req:Request,id:string,minimum:"reader"|"editor"="reader"){
    const row=(await this.pool.query<Row>("SELECT * FROM analysis_requests WHERE id=$1",[id])).rows[0];if(!row)throw new NotFoundException();await this.authorize(req,row.upload_id,minimum);return row;
  }
  private async synchronize(row:Row):Promise<AnalysisStatus>{
    if(row.finished_at&&row.cached_status)return row.cached_status;
    if(!row.delivered_at)return{id:row.id,status:"queued",attempts:0,errorCode:null,startedAt:null,finishedAt:null,transcript:null,selection:null,providerOutcomeUnknown:false,phases:[]};
    const value=body(analysisStatus,await internalJson(this.url,"/v1/internal/analysis-status",this.config,{id:row.id,workspaceId:row.workspace_id}));
    if(value.id!==row.id||(value.status==="succeeded"&&!value.transcript))throw new ConflictException();
    await this.pool.query("UPDATE analysis_requests SET cached_status=$2,finished_at=$3 WHERE id=$1 AND finished_at IS NULL",[row.id,value,terminal(value.status)?value.finishedAt:null]);return value;
  }
  async status(req:Request,id:string){return this.synchronize(await this.resource(req,id));}
  async cancel(req:Request,id:string){requireCsrf(req,this.config);const row=await this.resource(req,id,"editor"),state=await this.synchronize(row);if(terminal(state.status))throw new ConflictException();await this.pool.query("UPDATE analysis_requests SET cancel_requested=true WHERE id=$1 AND finished_at IS NULL",[id]);return{cancellationRequested:true};}
  async render(req:Request,id:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);const row=await this.resource(req,id,"editor"),state=await this.synchronize(row),spec=body(transcriptRenderSpec,input);
    if(state.status!=="succeeded"||!state.transcript)throw new ConflictException();
    const times="proposalIndex" in spec?state.selection?.segments[spec.proposalIndex]:spec;
    if(!times)throw new BadRequestException();
    const {startSeconds,endSeconds}=times;
    if(endSeconds-startSeconds<0.1||endSeconds-startSeconds>120||endSeconds>state.transcript.durationSeconds)throw new BadRequestException();
    const cues=state.transcript.segments.filter(segment=>segment.startSeconds<endSeconds&&segment.endSeconds>startSeconds).map(segment=>({startSeconds:Math.max(startSeconds,segment.startSeconds),endSeconds:Math.min(endSeconds,segment.endSeconds),text:Array.from(segment.text.replace(/[<>\\{}]/gu," "),character=>character.charCodeAt(0)<32?" ":character).join("").trim()})).filter(cue=>cue.text&&cue.endSeconds-cue.startSeconds>=0.01);
    // Reject excessive caption density/length instead of silently dropping words.
    if(!cues.length||cues.length>200||cues.some(cue=>cue.text.length>500))throw new BadRequestException();
    return this.derivatives.beginFromTranscript(req,row.upload_id,{version:1,kind:"clip",startSeconds,endSeconds,aspect:spec.aspect,subtitles:{provenance:"transcript",transcriptId:state.transcript.id,cues}},correlationId);
  }
  async dispatch(){
    const pending=(await this.pool.query<Row>("SELECT * FROM analysis_requests WHERE delivered_at IS NULL ORDER BY created_at LIMIT 25")).rows;
    for(const row of pending)try{await internalJson(this.url,"/v1/internal/analyses",this.config,{id:row.id,workspaceId:row.workspace_id,creatorId:row.creator_id,source:row.source,spec:row.spec,correlationId:row.correlation_id,cancelRequested:row.cancel_requested});await this.pool.query("UPDATE analysis_requests SET delivered_at=now() WHERE id=$1",[row.id]);}catch{logger.warn({code:"ANALYSIS_ADMISSION_RETRY",jobId:row.id});}
    const rows=(await this.pool.query<Row>("SELECT * FROM analysis_requests WHERE finished_at IS NULL AND delivered_at IS NOT NULL AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 25",[this.cursor??null])).rows;this.cursor=rows.length===25?rows.at(-1)?.id:undefined;
    for(const row of rows)try{if(row.cancel_requested&&!row.cancel_delivered_at){await internalJson(this.url,"/v1/internal/analysis-cancel",this.config,{id:row.id,workspaceId:row.workspace_id});await this.pool.query("UPDATE analysis_requests SET cancel_delivered_at=now() WHERE id=$1",[row.id]);}await this.synchronize(row);}catch{logger.warn({code:"ANALYSIS_RECONCILIATION_RETRY",jobId:row.id});}
  }
}
