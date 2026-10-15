import {BadRequestException,ConflictException,ForbiddenException,HttpException,NotFoundException,PreconditionFailedException,UnauthorizedException} from "@nestjs/common";
import type {Request} from "express";
import type pg from "pg";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {EditorSpec,ValidatedProcessingSpec} from "@autoclipper/api-contracts";
import {authenticatedUser,body,digest,opaqueToken,requireCsrf,requireInternal,uuid,workspaceAccess,type ServiceConfig} from "@autoclipper/http-security";
import type {DerivativesManager} from "./derivatives.manager.js";

type Draft={id:string;upload_id:string;workspace_id:string;name:string;current_version:number;review_version:number;review_status:"draft"|"review"|"approved";approved_revision_version:number|null};
type Revision={id:string;version:number;spec:EditorSpec;render_spec:ValidatedProcessingSpec};
type Comment={id:string;draft_id:string;revision_version:number;author_id:string;time_seconds:number;text:string;version:number;request_hash:string;created_at:Date;deleted_at:Date|null};
type Link={id:string;draft_id:string;revision_version:number;creator_id:string;processing_id:string|null;expires_at:Date;revoked_at:Date|null;created_at:Date;workspace_id:string;current_version:number;review_status:Draft["review_status"];name:string};
const version=z.number().int().positive().max(2147483646);
const stateInput=z.object({version,reviewVersion:version}).strict();
const commentInput=z.object({revisionVersion:version,timeSeconds:z.number().finite().min(0).max(120),text:z.string().trim().min(1).max(2000).refine(value=>[...value].every(character=>character==="\n"||character.charCodeAt(0)>=32))}).strict();
const linkInput=z.object({revisionVersion:version,processingId:z.uuid().optional(),expiresInSeconds:z.number().int().min(60).max(604800).default(86400)}).strict();

export class CollaborationManager {
  private readonly publicRates=new Map<string,{count:number;until:number}>();
  constructor(private readonly pool:pg.Pool,private readonly config:ServiceConfig,private readonly derivatives:DerivativesManager,private readonly authorize:(req:Request,id:string,minimum:"reader"|"editor"|"admin")=>Promise<unknown>){}
  private async tx<T>(work:(client:pg.PoolClient)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  private async resource(req:Request,id:string,minimum:"reader"|"editor"|"admin"="reader"){
    const draft=(await this.pool.query<Draft>("SELECT * FROM editor_drafts WHERE id=$1",[id])).rows[0];if(!draft)throw new NotFoundException();await this.authorize(req,draft.upload_id,minimum);return draft;
  }
  private async revision(client:pg.Pool|pg.PoolClient,draftId:string,number:number){const row=(await client.query<Revision>("SELECT id,version,spec,render_spec FROM editor_revisions WHERE draft_id=$1 AND version=$2",[draftId,number])).rows[0];if(!row)throw new NotFoundException();return row;}
  private state(row:Draft){return{version:row.current_version,reviewVersion:row.review_version,status:row.review_status,approvedRevisionVersion:row.approved_revision_version};}
  private async audit(client:pg.PoolClient,draftId:string,userId:string,action:string,details:Record<string,unknown>,correlationId:string){await client.query("INSERT INTO editor_audit(id,draft_id,actor_id,action,details,correlation_id) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),draftId,userId,action,details,correlationId]);}
  async review(req:Request,id:string){const draft=await this.resource(req,id);const approvals=(await this.pool.query<{id:string;revision_version:number;review_version:number;approver_id:string;created_at:Date}>("SELECT id,revision_version,review_version,approver_id,created_at FROM editor_approvals WHERE draft_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",[id])).rows;return{...this.state(draft),approvals:approvals.map(row=>({id:row.id,revisionVersion:row.revision_version,reviewVersion:row.review_version,approverId:row.approver_id,createdAt:row.created_at.toISOString()}))};}
  async transition(req:Request,id:string,input:unknown,action:"request"|"approve"|"return",correlationId:string){
    requireCsrf(req,this.config);await this.resource(req,id,action==="request"?"editor":"admin");const data=body(stateInput,input),user=await authenticatedUser(req,this.config);
    return this.tx(async client=>{
      const draft=(await client.query<Draft>("SELECT * FROM editor_drafts WHERE id=$1 FOR UPDATE",[id])).rows[0]!;
      if(draft.current_version!==data.version||draft.review_version!==data.reviewVersion)throw new PreconditionFailedException();
      if((action==="request"&&draft.review_status!=="draft")||(action==="approve"&&draft.review_status!=="review")||(action==="return"&&draft.review_status==="draft"))throw new ConflictException();
      const status=action==="request"?"review":action==="approve"?"approved":"draft";
      const updated=(await client.query<Draft>("UPDATE editor_drafts SET review_status=$2,review_version=review_version+1,approved_revision_version=$3,updated_at=now() WHERE id=$1 RETURNING *",[id,status,action==="approve"?data.version:null])).rows[0]!;
      if(action==="approve")await client.query("INSERT INTO editor_approvals(id,draft_id,revision_version,review_version,approver_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),id,data.version,updated.review_version,user.id,correlationId]);
      await this.audit(client,id,user.id,action==="request"?"review.requested":action==="approve"?"review.approved":"review.returned",{revisionVersion:data.version,reviewVersion:updated.review_version},correlationId);
      return this.state(updated);
    });
  }
  private presentComment(row:Comment,publicView=false){return{id:row.id,revisionVersion:row.revision_version,...(!publicView?{authorId:row.author_id}:{}),timeSeconds:row.time_seconds,text:row.deleted_at?null:row.text,version:row.version,createdAt:row.created_at.toISOString(),deletedAt:row.deleted_at?.toISOString()??null};}
  private async commentPage(draftId:string,revisionVersion:number,before:unknown,publicView=false){
    const cursor=before===undefined?null:uuid(String(before));
    if(cursor&&!(await this.pool.query("SELECT id FROM editor_comments WHERE id=$1 AND draft_id=$2 AND revision_version=$3",[cursor,draftId,revisionVersion])).rows.length)throw new BadRequestException();
    const rows=(await this.pool.query<Comment>("SELECT * FROM editor_comments WHERE draft_id=$1 AND revision_version=$2 AND ($3::uuid IS NULL OR sequence<(SELECT sequence FROM editor_comments WHERE id=$3)) ORDER BY sequence DESC LIMIT 50",[draftId,revisionVersion,cursor])).rows;
    return{items:rows.map(row=>this.presentComment(row,publicView)),nextBeforeId:rows.length===50?rows.at(-1)?.id:null};
  }
  async comments(req:Request,id:string,number:unknown,before:unknown){const draft=await this.resource(req,id);const selected=number===undefined?draft.current_version:body(z.coerce.number().int().positive().max(2147483646),number);await this.revision(this.pool,id,selected);return this.commentPage(id,selected,before);}
  async comment(req:Request,id:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);await this.resource(req,id,"editor");const data=body(commentInput,input),user=await authenticatedUser(req,this.config),key=uuid(String(req.headers["idempotency-key"]??"")),hash=digest(JSON.stringify({id,...data}));
    return this.tx(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`comment:${user.id}:${key}`]);
      const prior=(await client.query<Comment>("SELECT * FROM editor_comments WHERE author_id=$1 AND idempotency_key=$2",[user.id,key])).rows[0];if(prior){if(prior.request_hash!==hash)throw new ConflictException();return this.presentComment(prior);}
      await client.query("SELECT id FROM editor_drafts WHERE id=$1 FOR UPDATE",[id]);const revision=await this.revision(client,id,data.revisionVersion);if(data.timeSeconds>revision.spec.endSeconds-revision.spec.startSeconds)throw new BadRequestException();
      const count=(await client.query<{count:string}>("SELECT count(*) FROM editor_comments WHERE draft_id=$1 AND revision_version=$2",[id,data.revisionVersion])).rows[0]!;if(Number(count.count)>=500)throw new ConflictException();
      const row=(await client.query<Comment>("INSERT INTO editor_comments(id,draft_id,revision_version,author_id,time_seconds,text,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[randomUUID(),id,data.revisionVersion,user.id,data.timeSeconds,data.text,key,hash])).rows[0]!;
      await this.audit(client,id,user.id,"comment.created",{commentId:row.id,revisionVersion:data.revisionVersion,timeSeconds:data.timeSeconds},correlationId);return this.presentComment(row);
    });
  }
  async deleteComment(req:Request,id:string,commentId:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);const draft=await this.resource(req,id,"editor"),data=body(z.object({version}).strict(),input),user=await authenticatedUser(req,this.config);
    const comment=(await this.pool.query<Comment>("SELECT * FROM editor_comments WHERE id=$1 AND draft_id=$2",[commentId,id])).rows[0];if(!comment)throw new NotFoundException();if(comment.author_id!==user.id)await workspaceAccess(this.config,user.id,draft.workspace_id,"admin");
    return this.tx(async client=>{const row=(await client.query<Comment>("UPDATE editor_comments SET deleted_at=now(),version=version+1 WHERE id=$1 AND draft_id=$2 AND version=$3 AND deleted_at IS NULL RETURNING *",[commentId,id,data.version])).rows[0];if(!row)throw new PreconditionFailedException();await this.audit(client,id,user.id,"comment.deleted",{commentId,revisionVersion:row.revision_version},correlationId);return this.presentComment(row);});
  }
  private presentLink(row:Link){return{id:row.id,revisionVersion:row.revision_version,processingId:row.processing_id,createdAt:row.created_at.toISOString(),expiresAt:row.expires_at.toISOString(),revokedAt:row.revoked_at?.toISOString()??null};}
  async links(req:Request,id:string){await this.resource(req,id,"editor");const rows=(await this.pool.query<Link>("SELECT id,revision_version,processing_id,created_at,expires_at,revoked_at FROM editor_review_links WHERE draft_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50",[id])).rows;return{items:rows.map(row=>this.presentLink(row))};}
  async createLink(req:Request,id:string,input:unknown,correlationId:string){
    requireCsrf(req,this.config);await this.resource(req,id,"editor");const data=body(linkInput,input),user=await authenticatedUser(req,this.config),token=opaqueToken();
    return this.tx(async client=>{
      await client.query("SELECT id FROM editor_drafts WHERE id=$1 FOR UPDATE",[id]);const revision=await this.revision(client,id,data.revisionVersion);
      if(data.processingId)await this.derivatives.assertReviewExport(revision.id,data.processingId);
      const count=(await client.query<{count:string}>("SELECT count(*) FROM editor_review_links WHERE draft_id=$1 AND revoked_at IS NULL AND expires_at>now()",[id])).rows[0]!;if(Number(count.count)>=20)throw new ConflictException();
      const row=(await client.query<Link>("INSERT INTO editor_review_links(id,draft_id,revision_version,creator_id,token_hash,processing_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 second') RETURNING *",[randomUUID(),id,data.revisionVersion,user.id,digest(token),data.processingId??null,data.expiresInSeconds])).rows[0]!;
      await this.audit(client,id,user.id,"link.created",{linkId:row.id,revisionVersion:data.revisionVersion,videoEnabled:!!data.processingId},correlationId);return{...this.presentLink(row),token,path:`/v1/review-links/${token}`};
    });
  }
  async revokeLink(req:Request,id:string,linkId:string,correlationId:string){
    requireCsrf(req,this.config);const draft=await this.resource(req,id,"editor"),user=await authenticatedUser(req,this.config),link=(await this.pool.query<Link>("SELECT * FROM editor_review_links WHERE id=$1 AND draft_id=$2",[linkId,id])).rows[0];if(!link)throw new NotFoundException();if(link.creator_id!==user.id)await workspaceAccess(this.config,user.id,draft.workspace_id,"admin");
    return this.tx(async client=>{const changed=await client.query("UPDATE editor_review_links SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id",[linkId]);if(changed.rows.length)await this.audit(client,id,user.id,"link.revoked",{linkId},correlationId);return{revoked:true};});
  }
  private publicRate(req:Request){
    requireInternal(req,this.config);const now=Date.now(),raw=req.headers["x-client-ip"],key=digest(typeof raw==="string"?raw.slice(0,64):req.ip??"unknown");
    let window=this.publicRates.get(key);if(!window||window.until<=now){for(const [entry,value]of this.publicRates)if(value.until<=now)this.publicRates.delete(entry);if(this.publicRates.size>=1024&&!this.publicRates.has(key))throw new HttpException("Rate limited",429);window={count:0,until:now+60000};this.publicRates.set(key,window);}if(++window.count>50)throw new HttpException("Rate limited",429);
  }
  private async publicLink(req:Request,token:string,client:pg.Pool|pg.PoolClient=this.pool,lock=false){
    this.publicRate(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new NotFoundException();
    const link=(await client.query<Link>(`SELECT l.*,d.workspace_id,d.current_version,d.review_status,d.name FROM editor_review_links l JOIN editor_drafts d ON d.id=l.draft_id JOIN projects p ON p.id=d.project_id JOIN uploads u ON u.id=d.upload_id JOIN editor_revisions r ON r.draft_id=l.draft_id AND r.version=l.revision_version LEFT JOIN uploads su ON su.id=r.secondary_upload_id LEFT JOIN projects sp ON sp.id=su.project_id WHERE (r.secondary_upload_id IS NULL OR (su.state='confirmed' AND sp.deleted_at IS NULL AND su.workspace_id=d.workspace_id)) AND l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>clock_timestamp() AND p.deleted_at IS NULL AND u.state='confirmed'${lock?" FOR UPDATE OF l":""}`,[digest(token)])).rows[0];if(!link)throw new NotFoundException();
    try{await workspaceAccess(this.config,link.creator_id,link.workspace_id,"editor");}catch(error){if(error instanceof ForbiddenException||error instanceof UnauthorizedException)throw new NotFoundException();throw error;}
    return link;
  }
  async publicView(req:Request,token:string,before:unknown){const link=await this.publicLink(req,token),revision=await this.revision(this.pool,link.draft_id,link.revision_version),render=revision.render_spec;if(render.kind!=="clip")throw new NotFoundException();return{name:link.name,revisionVersion:revision.version,status:link.current_version===revision.version?link.review_status:"superseded",spec:{version:render.version,kind:render.kind,startSeconds:render.startSeconds,endSeconds:render.endSeconds,aspect:render.aspect,framing:render.framing,...(render.splitScreen?{splitScreen:{layout:render.splitScreen.layout,primaryRatio:render.splitScreen.primaryRatio,startSeconds:render.splitScreen.startSeconds,shortInput:render.splitScreen.shortInput,audio:render.splitScreen.audio,framing:render.splitScreen.framing}}:{}),...(render.subtitles?{subtitles:{cues:render.subtitles.cues,style:render.subtitles.style}}:{})},videoEnabled:!!link.processing_id,expiresAt:link.expires_at.toISOString(),comments:await this.commentPage(link.draft_id,revision.version,before,true)};}
  async publicVideo(req:Request,token:string){return this.tx(async client=>{const link=await this.publicLink(req,token,client,true);if(!link.processing_id)throw new NotFoundException();const revision=await this.revision(client,link.draft_id,link.revision_version);return this.derivatives.downloadForReview(revision.id,link.processing_id,link.expires_at);});}
  async auditLog(req:Request,id:string,before:unknown){await this.resource(req,id,"admin");const cursor=before===undefined?null:uuid(String(before));if(cursor&&!(await this.pool.query("SELECT id FROM editor_audit WHERE id=$1 AND draft_id=$2",[cursor,id])).rows.length)throw new BadRequestException();const rows=(await this.pool.query<{id:string;actor_id:string;action:string;details:unknown;correlation_id:string;created_at:Date}>("SELECT * FROM editor_audit WHERE draft_id=$1 AND ($2::uuid IS NULL OR sequence<(SELECT sequence FROM editor_audit WHERE id=$2)) ORDER BY sequence DESC LIMIT 50",[id,cursor])).rows;return{items:rows.map(row=>({id:row.id,actorId:row.actor_id,action:row.action,details:row.details,correlationId:row.correlation_id,createdAt:row.created_at.toISOString()})),nextBeforeId:rows.length===50?rows.at(-1)?.id:null};}
}
