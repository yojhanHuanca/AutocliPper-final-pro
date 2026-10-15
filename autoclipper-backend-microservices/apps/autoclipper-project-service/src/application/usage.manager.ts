import {ConflictException} from "@nestjs/common";
import type pg from "pg";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {usageAdmission,usageReport,type UsageReport,type UsageStage,type UsageReservation,type ProcessingStatus,type AnalysisStatus} from "@autoclipper/api-contracts";
import {body,digest,internalJson,type ServiceConfig} from "@autoclipper/http-security";
import {logger} from "@autoclipper/observability";
type Row={id:string;workspace_id:string;usage_state:"legacy"|"pending"|"accepted"|"rejected";usage_spec:UsageReservation|null};
type Children={audio?:{status:string;settled_at:Date|null;result:ProcessingStatus["result"]}|undefined;render?:{status:string;settled_at:Date|null;result:ProcessingStatus["result"]}|undefined;analysis?:{finished_at:Date|null;cached_status:AnalysisStatus|null}|undefined};
export class UsageManager {
  private admissionCursor:string|undefined;
  private eventCursor:string|undefined;
  constructor(private readonly pool:pg.Pool,private readonly config:ServiceConfig,private readonly url:string){}
  // Called inside the same Project transaction as a stage transition. No HTTP
  // here: the immutable outbox must survive loss before or after remote commit.
  async capture(client:pg.PoolClient,row:Row,children:Children,skipMissing=false){
    if(row.usage_state!=="accepted")return;
    for(const stage of ["audio","analysis","render"]as const){
      const child=children[stage];let outcome:UsageReport["outcome"]|undefined,duration=0;
      if(!child){if(skipMissing)outcome="skipped";}
      else if(stage==="analysis"){
        const analysis=children.analysis!;if(analysis.finished_at){const status=analysis.cached_status?.status;if(status==="succeeded"){outcome="succeeded";duration=analysis.cached_status!.transcript!.durationSeconds;}else if(status==="cancelled"||status==="failed")outcome=status;}
      }else{
        const processed=stage==="audio"?children.audio!:children.render!;if(processed.settled_at){if(processed.status==="succeeded"){outcome="succeeded";duration=processed.result!.durationSeconds;}else if(processed.status==="cancelled"||processed.status==="failed")outcome=processed.status;}
      }
      if(!outcome)continue;
      const report=body(usageReport,{version:1,eventId:randomUUID(),pipelineId:row.id,workspaceId:row.workspace_id,stage,outcome,actualDurationSeconds:duration});
      const prior=(await client.query<{payload:UsageReport}>("SELECT payload FROM pipeline_usage_outbox WHERE pipeline_id=$1 AND stage=$2",[row.id,stage])).rows[0];
      if(prior){const canonical=body(usageReport,prior.payload);if(digest(JSON.stringify({...canonical,eventId:undefined}))!==digest(JSON.stringify({...report,eventId:undefined})))throw new ConflictException();continue;}
      await client.query("INSERT INTO pipeline_usage_outbox(id,pipeline_id,stage,payload) VALUES($1,$2,$3,$4)",[report.eventId,row.id,stage,report]);
    }
  }
  async reconciled(client:pg.PoolClient,row:Row){if(row.usage_state==="pending")return false;if(row.usage_state!=="accepted")return true;return Number((await client.query<{count:string}>("SELECT count(*) FROM pipeline_usage_outbox WHERE pipeline_id=$1 AND delivered_at IS NOT NULL",[row.id])).rows[0]?.count??0)===3;}
  async dispatch(){
    const pending=(await this.pool.query<Row>("SELECT id,workspace_id,usage_state,usage_spec FROM pipelines WHERE usage_state='pending' AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 25",[this.admissionCursor??null])).rows;this.admissionCursor=pending.length===25?pending.at(-1)?.id:undefined;
    for(const row of pending)try{const result=body(usageAdmission,await internalJson(this.url,"/v1/internal/usage-reservations",this.config,row.usage_spec));await this.pool.query("UPDATE pipelines SET usage_state=$2,usage_error=$3 WHERE id=$1 AND usage_state='pending'",[row.id,result.admitted?"accepted":"rejected",result.code]);}catch{logger.warn({code:"USAGE_ADMISSION_RETRY",pipelineId:row.id});}
    const events=(await this.pool.query<{id:string;payload:UsageReport;stage:UsageStage}>("SELECT o.* FROM pipeline_usage_outbox o JOIN pipelines p ON p.id=o.pipeline_id WHERE o.delivered_at IS NULL AND p.usage_state='accepted' AND ($1::uuid IS NULL OR o.id>$1) ORDER BY o.id LIMIT 25",[this.eventCursor??null])).rows;this.eventCursor=events.length===25?events.at(-1)?.id:undefined;
    for(const event of events)try{body(z.object({accepted:z.literal(true)}).strict(),await internalJson(this.url,"/v1/internal/usage-settlements",this.config,event.payload));await this.pool.query("UPDATE pipeline_usage_outbox SET delivered_at=now() WHERE id=$1 AND delivered_at IS NULL",[event.id]);}catch{logger.warn({code:"USAGE_SETTLEMENT_RETRY",eventId:event.id});}
  }
}
