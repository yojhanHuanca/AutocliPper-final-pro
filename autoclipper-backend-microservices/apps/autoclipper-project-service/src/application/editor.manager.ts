import {BadRequestException,ConflictException,NotFoundException,PreconditionFailedException} from "@nestjs/common";
import type {Request} from "express";
import type pg from "pg";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {editorSpec,internalProcessingSpec,type EditorSpec,type ValidatedProcessingSpec} from "@autoclipper/api-contracts";
import {authenticatedUser,body,digest,requireCsrf,uuid,type ServiceConfig} from "@autoclipper/http-security";
import type {DerivativesManager} from "./derivatives.manager.js";
import type {AnalysisManager} from "./analysis.manager.js";
type Draft={id:string;upload_id:string;project_id:string;workspace_id:string;name:string;current_version:number;creator_id:string;request_hash:string;created_at:Date;updated_at:Date};
type Revision={id:string;draft_id:string;version:number;author_id:string;action:"created"|"updated"|"restored";restored_from_version:number|null;spec:EditorSpec;render_spec:ValidatedProcessingSpec;created_at:Date};
const version=z.number().int().min(1).max(2147483646);
export class EditorManager {
  constructor(private readonly pool:pg.Pool,private readonly config:ServiceConfig,private readonly derivatives:DerivativesManager,private readonly analyses:AnalysisManager,private readonly authorize:(req:Request,id:string,minimum:"reader"|"editor")=>Promise<unknown>){}
  private async tx<T>(work:(client:pg.PoolClient)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  private async resource(req:Request,id:string,minimum:"reader"|"editor"="reader"){
    const row=(await this.pool.query<Draft>("SELECT * FROM editor_drafts WHERE id=$1",[id])).rows[0];if(!row)throw new NotFoundException();await this.authorize(req,row.upload_id,minimum);return row;
  }
  private async revision(client:pg.Pool|pg.PoolClient,draftId:string,number:number){const row=(await client.query<Revision>("SELECT * FROM editor_revisions WHERE draft_id=$1 AND version=$2",[draftId,number])).rows[0];if(!row)throw new NotFoundException();return row;}
  private revisionSummary(row:Revision){return{id:row.id,version:row.version,authorId:row.author_id,action:row.action,restoredFromVersion:row.restored_from_version,createdAt:row.created_at.toISOString()};}
  private presentRevision(row:Revision){return{...this.revisionSummary(row),spec:row.spec,renderSpec:row.render_spec};}
  private present(draft:Draft,revision:Revision){return{id:draft.id,uploadId:draft.upload_id,projectId:draft.project_id,name:draft.name,version:draft.current_version,revision:this.presentRevision(revision)};}
  private async materialize(req:Request,uploadId:string,spec:EditorSpec){
    const source=await this.derivatives.sourceForEditor(req,uploadId);
    if(spec.endSeconds>source.metadata.durationSeconds)throw new BadRequestException();
    let subtitles:Extract<ValidatedProcessingSpec,{kind:"clip"}>["subtitles"];
    if(spec.subtitles.source==="user")subtitles={provenance:"user",cues:spec.subtitles.cues,...(spec.subtitles.style?{style:spec.subtitles.style}:{})};
    if(spec.subtitles.source==="transcript"){
      const prepared=await this.analyses.prepareRender(req,spec.subtitles.analysisId,{version:1,startSeconds:spec.startSeconds,endSeconds:spec.endSeconds,aspect:spec.aspect});
      if(prepared.uploadId!==uploadId)throw new BadRequestException();
      subtitles={...prepared.spec.subtitles,...(spec.subtitles.style?{style:spec.subtitles.style}:{})};
    }
    const renderSpec=body(internalProcessingSpec,{version:1,kind:"clip",startSeconds:spec.startSeconds,endSeconds:spec.endSeconds,aspect:spec.aspect,...(spec.framing?{framing:spec.framing}:{}),...(spec.splitScreen?{splitScreen:spec.splitScreen}:{}),...(subtitles?{subtitles}:{})});
    if(renderSpec.kind==="clip")await this.derivatives.validateEditorSplit(req,source,renderSpec);
    return{source,renderSpec};
  }
  private async insertRevision(client:pg.PoolClient,draftId:string,number:number,authorId:string,action:Revision["action"],spec:EditorSpec,renderSpec:ValidatedProcessingSpec,correlationId:string,restoredFrom:number|null=null){
    return(await client.query<Revision>("INSERT INTO editor_revisions(id,draft_id,version,author_id,action,spec,render_spec,correlation_id,restored_from_version,secondary_upload_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[randomUUID(),draftId,number,authorId,action,spec,renderSpec,correlationId,restoredFrom,renderSpec.kind==="clip"?renderSpec.splitScreen?.secondaryUploadId??null:null])).rows[0]!;
  }
  async create(req:Request,uploadId:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);await this.authorize(req,uploadId,"editor");
    const data=body(z.object({name:z.string().trim().min(1).max(150),spec:editorSpec}).strict(),input),user=await authenticatedUser(req,this.config),key=uuid(String(req.headers["idempotency-key"]??"")),hash=digest(JSON.stringify({uploadId,...data}));
    const prior=(await this.pool.query<Draft>("SELECT * FROM editor_drafts WHERE creator_id=$1 AND idempotency_key=$2",[user.id,key])).rows[0];if(prior){if(prior.request_hash!==hash)throw new ConflictException();return this.present(prior,await this.revision(this.pool,prior.id,prior.current_version));}
    const {source,renderSpec}=await this.materialize(req,uploadId,data.spec);
    return this.tx(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`editor:${user.id}:${key}`]);
      const existing=(await client.query<Draft>("SELECT * FROM editor_drafts WHERE creator_id=$1 AND idempotency_key=$2",[user.id,key])).rows[0];if(existing){if(existing.request_hash!==hash)throw new ConflictException();return this.present(existing,await this.revision(client,existing.id,existing.current_version));}
      const id=randomUUID(),draft=(await client.query<Draft>("INSERT INTO editor_drafts(id,upload_id,project_id,workspace_id,creator_id,name,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[id,uploadId,source.upload.project_id,source.upload.workspace_id,user.id,data.name,key,hash])).rows[0]!;
      const revision=await this.insertRevision(client,id,1,user.id,"created",data.spec,renderSpec,correlationId);return this.present(draft,revision);
    });
  }
  async get(req:Request,id:string){const draft=await this.resource(req,id);return this.present(draft,await this.revision(this.pool,id,draft.current_version));}
  async getRevision(req:Request,id:string,number:number){await this.resource(req,id);return this.presentRevision(await this.revision(this.pool,id,number));}
  async history(req:Request,id:string,before:unknown){await this.resource(req,id);const cursor=body(z.coerce.number().int().positive().max(2147483647).default(2147483647),before);const rows=(await this.pool.query<Revision>("SELECT id,draft_id,version,author_id,action,restored_from_version,created_at FROM editor_revisions WHERE draft_id=$1 AND version<$2 ORDER BY version DESC LIMIT 50",[id,cursor])).rows;return{items:rows.map(row=>this.revisionSummary(row)),nextBeforeVersion:rows.length===50?rows.at(-1)?.version:null};}
  async list(projectId:string){const rows=(await this.pool.query<Draft>("SELECT * FROM editor_drafts WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",[projectId])).rows;return{items:rows.map(row=>({id:row.id,uploadId:row.upload_id,name:row.name,version:row.current_version,updatedAt:row.updated_at.toISOString()}))};}
  async update(req:Request,id:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);const draft=await this.resource(req,id,"editor"),data=body(z.object({version,spec:editorSpec}).strict(),input),user=await authenticatedUser(req,this.config);
    if(req.headers["if-match"]!==undefined&&req.headers["if-match"]!==`"${data.version}"`)throw new PreconditionFailedException();
    if(draft.current_version!==data.version)throw new PreconditionFailedException();
    const {renderSpec}=await this.materialize(req,draft.upload_id,data.spec);
    return this.save(draft.id,data.version,user.id,"updated",data.spec,renderSpec,correlationId);
  }
  private async save(id:string,expectedVersion:number,authorId:string,action:Revision["action"],spec:EditorSpec,renderSpec:ValidatedProcessingSpec,correlationId:string,restoredFrom:number|null=null){return this.tx(async client=>{
    const draft=(await client.query<Draft>("UPDATE editor_drafts SET current_version=current_version+1,updated_at=now() WHERE id=$1 AND current_version=$2 RETURNING *",[id,expectedVersion])).rows[0];if(!draft)throw new PreconditionFailedException();
    const revision=await this.insertRevision(client,id,draft.current_version,authorId,action,spec,renderSpec,correlationId,restoredFrom);return this.present(draft,revision);
  });}
  async restore(req:Request,id:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);const draft=await this.resource(req,id,"editor"),data=body(z.object({version,revisionVersion:version}).strict(),input),user=await authenticatedUser(req,this.config);
    if(req.headers["if-match"]!==undefined&&req.headers["if-match"]!==`"${data.version}"`)throw new PreconditionFailedException();
    if(draft.current_version!==data.version)throw new PreconditionFailedException();const saved=await this.revision(this.pool,id,data.revisionVersion);
    if(saved.render_spec.kind==="clip"&&saved.render_spec.splitScreen)await this.derivatives.validateEditorSplit(req,await this.derivatives.sourceForEditor(req,draft.upload_id),saved.render_spec);
    return this.save(id,data.version,user.id,"restored",saved.spec,saved.render_spec,correlationId,saved.version);
  }
  async render(req:Request,id:string,input:unknown,correlationId:string){requireCsrf(req,this.config);const draft=await this.resource(req,id,"editor"),data=body(z.object({revisionVersion:version}).strict(),input),saved=await this.revision(this.pool,id,data.revisionVersion);return this.derivatives.beginFromEditor(req,draft.upload_id,saved.render_spec,correlationId,saved.id);}
  async exports(req:Request,id:string){await this.resource(req,id);return this.derivatives.listForEditor(id);}
}
