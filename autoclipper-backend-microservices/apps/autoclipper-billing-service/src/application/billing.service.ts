import {ConflictException,ForbiddenException,Injectable,NotFoundException,type OnModuleDestroy,type OnModuleInit} from "@nestjs/common";
import type {Request} from "express";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {z} from "zod";
import {usageReservation,usageReport,usageBudgets,type UsageStage} from "@autoclipper/api-contracts";
import {authenticatedUser,body,digest,loadServiceConfig,workspaceAccess} from "@autoclipper/http-security";
import {logger} from "@autoclipper/observability";

type Plan={id:string;version:string;kind:"development";label:string;processing_seconds_per_month:number;active_pipelines:number};
type Reservation={pipeline_id:string;workspace_id:string;period_start:Date;budgets:Record<UsageStage,number>;state:"open"|"settled"};
type Admission={request_hash:string;admitted:boolean;code:string|null};
export function consumptionPeriod(now=new Date()){return{start:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)),end:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1))};}
@Injectable()
export class BillingService implements OnModuleInit,OnModuleDestroy {
  readonly config=loadServiceConfig();
  readonly pool=new pg.Pool({connectionString:this.config.DATABASE_URL,max:5,connectionTimeoutMillis:2000,statement_timeout:5000});
  private plan:Plan|undefined;
  async onModuleInit(){
    this.pool.on("error",()=>logger.error({code:"BILLING_DATABASE_ERROR"}));
    const parsed=z.object({DEV_PROCESSING_SECONDS_PER_MONTH:z.coerce.number().int().min(1).max(100000000).default(3600),DEV_ACTIVE_PIPELINES:z.coerce.number().int().min(1).max(4).default(4)}).safeParse(process.env);
    if(!parsed.success)throw new Error("Invalid development consumption limits");
    const limits=parsed.data,version=digest(JSON.stringify({kind:"development",unit:"material_seconds_per_stage",policy:"successful-material-v1",...limits}));
    await this.pool.query("INSERT INTO plan_versions(id,version,kind,label,processing_seconds_per_month,active_pipelines) VALUES($1,$2,'development','Local development allocation; not a commercial offer',$3,$4) ON CONFLICT(version) DO NOTHING",[randomUUID(),version,limits.DEV_PROCESSING_SECONDS_PER_MONTH,limits.DEV_ACTIVE_PIPELINES]);
    this.plan=(await this.pool.query<Plan>("SELECT * FROM plan_versions WHERE version=$1",[version])).rows[0]!;
  }
  private async tx<T>(work:(client:pg.PoolClient)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const value=await work(client);await client.query("COMMIT");return value;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  private admission(row:Admission,hash:string){if(row.request_hash!==hash)throw new ConflictException();return{admitted:row.admitted,code:row.code};}
  async reserve(input:unknown){
    const spec=body(usageReservation,input),hash=digest(JSON.stringify(spec)),prior=(await this.pool.query<Admission>("SELECT * FROM usage_admissions WHERE pipeline_id=$1",[spec.pipelineId])).rows[0];if(prior)return this.admission(prior,hash);
    let allowed=true;try{await workspaceAccess(this.config,spec.creatorId,spec.workspaceId,"editor");}catch(error){if(error instanceof ForbiddenException)allowed=false;else throw error;}
    return this.tx(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`usage-admission:${spec.pipelineId}`]);
      const existing=(await client.query<Admission>("SELECT * FROM usage_admissions WHERE pipeline_id=$1",[spec.pipelineId])).rows[0];if(existing)return this.admission(existing,hash);
      const record=async(admitted:boolean,code:string|null)=>{await client.query("INSERT INTO usage_admissions(pipeline_id,workspace_id,request_hash,admitted,code) VALUES($1,$2,$3,$4,$5)",[spec.pipelineId,spec.workspaceId,hash,admitted,code]);return{admitted,code};};
      if(!allowed)return record(false,"USAGE_AUTHORIZATION_REVOKED");
      if(!this.plan)throw new ConflictException();
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`usage-workspace:${spec.workspaceId}`]);
      await client.query("INSERT INTO workspace_entitlements(workspace_id,plan_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[spec.workspaceId,this.plan.id]);
      const plan=(await client.query<Plan>("SELECT p.* FROM plan_versions p JOIN workspace_entitlements e ON e.plan_version_id=p.id WHERE e.workspace_id=$1",[spec.workspaceId])).rows[0]!;
      const period=consumptionPeriod(),budgets=usageBudgets(spec),total=budgets.audio+budgets.analysis+budgets.render;
      await client.query("INSERT INTO usage_periods(workspace_id,period_start,period_end,plan_version_id,budget_seconds) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[spec.workspaceId,period.start,period.end,plan.id,plan.processing_seconds_per_month]);
      const active=(await client.query<{count:string}>("SELECT count(*) FROM usage_reservations WHERE workspace_id=$1 AND state='open'",[spec.workspaceId])).rows[0];if(Number(active?.count??0)>=plan.active_pipelines)return record(false,"PROCESSING_CONCURRENCY_EXCEEDED");
      const updated=await client.query("UPDATE usage_periods SET reserved_seconds=reserved_seconds+$3 WHERE workspace_id=$1 AND period_start=$2 AND consumed_seconds+reserved_seconds+$3<=budget_seconds RETURNING workspace_id",[spec.workspaceId,period.start,total]);if(!updated.rows[0])return record(false,"PROCESSING_ALLOWANCE_EXCEEDED");
      await client.query("INSERT INTO usage_reservations(pipeline_id,workspace_id,creator_id,period_start,request_hash,budgets) VALUES($1,$2,$3,$4,$5,$6)",[spec.pipelineId,spec.workspaceId,spec.creatorId,period.start,hash,budgets]);
      for(const stage of ["audio","analysis","render"]as const)await client.query("INSERT INTO usage_ledger(pipeline_id,workspace_id,period_start,stage,kind,seconds) VALUES($1,$2,$3,$4,'reserve',$5)",[spec.pipelineId,spec.workspaceId,period.start,stage,budgets[stage]]);
      return record(true,null);
    });
  }
  async settle(input:unknown){
    const spec=body(usageReport,input),hash=digest(JSON.stringify({...spec,eventId:undefined}));
    return this.tx(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`usage-event:${spec.eventId}`]);
      const receipt=(await client.query<{request_hash:string}>("SELECT request_hash FROM usage_inbox WHERE event_id=$1",[spec.eventId])).rows[0];if(receipt){if(receipt.request_hash!==hash)throw new ConflictException();return{accepted:true};}
      const row=(await client.query<Reservation>("SELECT * FROM usage_reservations WHERE pipeline_id=$1 AND workspace_id=$2 FOR UPDATE",[spec.pipelineId,spec.workspaceId])).rows[0];if(!row)throw new NotFoundException();
      const settled=(await client.query<{request_hash:string}>("SELECT request_hash FROM usage_stage_settlements WHERE pipeline_id=$1 AND stage=$2",[spec.pipelineId,spec.stage])).rows[0];if(settled&&settled.request_hash!==hash)throw new ConflictException();
      await client.query("INSERT INTO usage_inbox(event_id,pipeline_id,stage,request_hash) VALUES($1,$2,$3,$4)",[spec.eventId,row.pipeline_id,spec.stage,hash]);if(settled)return{accepted:true};
      const seconds=spec.outcome==="succeeded"?Math.ceil(spec.actualDurationSeconds):0,budget=row.budgets[spec.stage];if(seconds>budget)throw new ConflictException();
      await client.query("INSERT INTO usage_stage_settlements(pipeline_id,stage,event_id,request_hash,outcome,actual_seconds) VALUES($1,$2,$3,$4,$5,$6)",[row.pipeline_id,spec.stage,spec.eventId,hash,spec.outcome,seconds]);
      await client.query("UPDATE usage_periods SET reserved_seconds=reserved_seconds-$3,consumed_seconds=consumed_seconds+$4 WHERE workspace_id=$1 AND period_start=$2",[row.workspace_id,row.period_start,budget,seconds]);
      for(const [kind,units]of [["consume",seconds],["release",budget-seconds]]as const)await client.query("INSERT INTO usage_ledger(pipeline_id,workspace_id,period_start,stage,kind,seconds) VALUES($1,$2,$3,$4,$5,$6)",[row.pipeline_id,row.workspace_id,row.period_start,spec.stage,kind,units]);
      const count=(await client.query<{count:string}>("SELECT count(*) FROM usage_stage_settlements WHERE pipeline_id=$1",[row.pipeline_id])).rows[0];if(Number(count?.count??0)===3)await client.query("UPDATE usage_reservations SET state='settled',settled_at=now() WHERE pipeline_id=$1",[row.pipeline_id]);return{accepted:true};
    });
  }
  private async authorize(req:Request,workspaceId:string){const user=await authenticatedUser(req,this.config);await workspaceAccess(this.config,user.id,workspaceId,"reader");}
  private presentPlan(plan:Plan){return{kind:plan.kind,label:plan.label,version:plan.version,processingSecondsPerMonth:plan.processing_seconds_per_month,activePipelines:plan.active_pipelines};}
  async consumption(req:Request,workspaceId:string){
    await this.authorize(req,workspaceId);const period=consumptionPeriod(),plan=(await this.pool.query<Plan>("SELECT p.* FROM plan_versions p JOIN workspace_entitlements e ON e.plan_version_id=p.id WHERE e.workspace_id=$1",[workspaceId])).rows[0];
    const usage=(await this.pool.query<{consumed_seconds:number;reserved_seconds:number;budget_seconds:number}>("SELECT consumed_seconds,reserved_seconds,budget_seconds FROM usage_periods WHERE workspace_id=$1 AND period_start=$2",[workspaceId,period.start])).rows[0];
    const consumed=usage?.consumed_seconds??0,reserved=usage?.reserved_seconds??0,budget=usage?.budget_seconds??plan?.processing_seconds_per_month??0;
    return{workspaceId,unit:"material_seconds_per_stage",plan:plan?this.presentPlan(plan):null,periodStart:period.start.toISOString(),periodEnd:period.end.toISOString(),consumedSeconds:consumed,consumedMinutes:consumed/60,reservedSeconds:reserved,availableSeconds:budget-consumed-reserved};
  }
  async ledger(req:Request,workspaceId:string,beforeId?:string){await this.authorize(req,workspaceId);const before=beforeId===undefined?null:body(z.string().regex(/^[1-9][0-9]{0,18}$/u).refine(value=>BigInt(value)<=9223372036854775807n),beforeId);const rows=(await this.pool.query<{id:string;pipeline_id:string;stage:string;kind:string;seconds:number;at:Date;period_start:Date}>("SELECT * FROM usage_ledger WHERE workspace_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 50",[workspaceId,before])).rows;return{items:rows.map(row=>({id:row.id,pipelineId:row.pipeline_id,stage:row.stage,kind:row.kind,seconds:row.seconds,at:row.at.toISOString(),periodStart:row.period_start.toISOString()})),nextBeforeId:rows.length===50?rows.at(-1)!.id:null};}
  async onModuleDestroy(){await this.pool.end();}
}
