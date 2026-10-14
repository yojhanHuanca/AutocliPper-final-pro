import {Injectable,type OnModuleInit,type OnModuleDestroy,ConflictException,NotFoundException,BadRequestException} from "@nestjs/common";
import {loadMediaConfig} from "@autoclipper/configuration";
import {internalProcessingSpec,type ValidatedProcessingSpec,type ProcessingStatus} from "@autoclipper/api-contracts";
import {digest} from "@autoclipper/http-security";
import {logger,recordDerivativeAttempt} from "@autoclipper/observability";
import {Queue,Worker,UnrecoverableError,type Job} from "bullmq";
import {DeleteObjectCommand} from "@aws-sdk/client-s3";
import pg from "pg";
import {createS3,redisConnection} from "../infrastructure/connections.js";
import {produceDerivative} from "../infrastructure/renderer.js";
import {InspectionError,type MediaMetadata} from "../domain/inspection.js";
import {validateProcessingSource,outputFiles,outputPrefix} from "../domain/processing.js";

export const PROCESSING_QUEUE="media-derivatives-v1";
type Task={id:string;workspace_id:string;inspection_id:string;spec:ValidatedProcessingSpec;request_hash:string;status:ProcessingStatus["status"];correlation_id:string;attempts:number;cancel_requested:boolean;cleanup_pending:boolean;result:ProcessingStatus["result"];error_code:string|null;started_at:Date|null;finished_at:Date|null};
type Source={id:string;workspace_id:string;object_key:string;expected_bytes:number;expected_etag:string;expected_sha256:string|null;status:string;result:MediaMetadata};
@Injectable()
export class ProcessingRuntime implements OnModuleInit,OnModuleDestroy {
  readonly config=loadMediaConfig();
  readonly pool=new pg.Pool({connectionString:this.config.DATABASE_URL,max:5,connectionTimeoutMillis:2000,statement_timeout:5000});
  readonly s3=createS3(this.config);
  readonly queue=new Queue(PROCESSING_QUEUE,{connection:{...redisConnection(this.config.REDIS_URL),maxRetriesPerRequest:1,enableOfflineQueue:false}});
  private worker:Worker|undefined;
  private timer:NodeJS.Timeout|undefined;
  private working:Promise<void>|undefined;
  private stopping=false;
  private cursor:string|undefined;
  private readonly active=new Map<string,AbortController>();
  async onModuleInit() {
    this.pool.on("error",()=>logger.error({code:"PROCESSING_DATABASE_ERROR"}));
    this.queue.on("error",()=>logger.error({code:"PROCESSING_QUEUE_ERROR"}));
    if(this.config.MEDIA_WORKERS!=="inspection") {
      this.worker=new Worker(PROCESSING_QUEUE,job=>this.process(job),{connection:{...redisConnection(this.config.REDIS_URL),maxRetriesPerRequest:null},concurrency:1,lockDuration:30000,maxStalledCount:2});
      this.worker.on("error",()=>logger.error({code:"RENDER_WORKER_ERROR"}));
    }
    await this.queue.waitUntilReady();
    this.timer=setInterval(()=>{
      if(!this.stopping&&!this.working)this.working=this.dispatch().catch(()=>logger.warn({code:"PROCESSING_DISPATCH_RETRY"})).finally(()=>{this.working=undefined;});
    },1000);this.timer.unref();
  }
  async submit(data:{id:string;workspaceId:string;inspectionId:string;spec:unknown;correlationId:string;cancelRequested?:boolean}) {
    const parsed=internalProcessingSpec.safeParse(data.spec);if(!parsed.success)throw new BadRequestException();
    const hash=digest(JSON.stringify({inspectionId:data.inspectionId,spec:parsed.data}));
    const source=(await this.pool.query<Source>("SELECT * FROM inspection_tasks WHERE id=$1 AND workspace_id=$2 AND status='succeeded'",[data.inspectionId,data.workspaceId])).rows[0];
    if(!source?.expected_sha256)throw new ConflictException();
    try{validateProcessingSource(parsed.data,source.result);}catch{throw new BadRequestException();}
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO processing_tasks(id,workspace_id,inspection_id,spec,request_hash,correlation_id,cancel_requested) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",[data.id,data.workspaceId,data.inspectionId,parsed.data,hash,data.correlationId,data.cancelRequested??false]);
      const current=(await client.query<Task>("SELECT * FROM processing_tasks WHERE id=$1",[data.id])).rows[0];
      if(!current||current.workspace_id!==data.workspaceId||current.request_hash!==hash)throw new ConflictException();
      if(data.cancelRequested)await client.query("UPDATE processing_tasks SET cancel_requested=true WHERE id=$1 AND status IN ('queued','running')",[data.id]);
      await client.query("INSERT INTO processing_outbox(task_id) VALUES($1) ON CONFLICT DO NOTHING",[data.id]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    return {id:data.id};
  }
  async status(id:string,workspaceId:string):Promise<ProcessingStatus> {
    const row=(await this.pool.query<Task>("SELECT * FROM processing_tasks WHERE id=$1 AND workspace_id=$2",[id,workspaceId])).rows[0];
    if(!row)throw new NotFoundException();
    return {id:row.id,status:row.status,attempts:row.attempts,errorCode:row.error_code,startedAt:row.started_at?.toISOString()??null,finishedAt:row.finished_at?.toISOString()??null,cleanupPending:row.cleanup_pending,result:row.result};
  }
  async cancel(id:string,workspaceId:string) {
    const row=await this.pool.query("UPDATE processing_tasks SET cancel_requested=true WHERE id=$1 AND workspace_id=$2 RETURNING id",[id,workspaceId]);
    if(!row.rows[0])throw new NotFoundException();
    this.active.get(id)?.abort();
    return {cancellationRequested:true};
  }
  private async cleanup(task:Pick<Task,"id"|"workspace_id">) {
    for(const file of outputFiles)await this.s3.send(new DeleteObjectCommand({Bucket:this.config.S3_BUCKET,Key:outputPrefix(task.workspace_id,task.id)+file}));
  }
  private async dispatch() {
    const rows=(await this.pool.query<Task>("SELECT * FROM processing_tasks WHERE status IN ('queued','running') AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 100",[this.cursor??null])).rows;
    this.cursor=rows.length===100?rows.at(-1)?.id:undefined;
    for(const row of rows) {
      const job=await this.queue.getJob(row.id);
      if(!job)await this.pool.query("UPDATE processing_outbox SET delivered_at=NULL WHERE task_id=$1",[row.id]);
      else if(await job.getState()==="failed") {
        const lease=await this.pool.connect();
        try{const locked=(await lease.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",[`derivative:${row.id}`])).rows[0]?.locked;
          if(locked)await lease.query("UPDATE processing_tasks SET status='failed',error_code='RECOVERY_RETRIES_EXHAUSTED',finished_at=now(),cleanup_pending=true WHERE id=$1 AND status IN ('queued','running')",[row.id]);
        }finally{try{await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[`derivative:${row.id}`]);}finally{lease.release();}}
      }
    }
    const pending=(await this.pool.query<{task_id:string}>("SELECT task_id FROM processing_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 50")).rows;
    for(const row of pending) {
      await this.queue.add("derive",{version:1,taskId:row.task_id},{jobId:row.task_id,attempts:3,backoff:{type:"exponential",delay:1000},removeOnComplete:false,removeOnFail:false});
      await this.pool.query("UPDATE processing_outbox SET delivered_at=now() WHERE task_id=$1 AND delivered_at IS NULL",[row.task_id]);
    }
    const abandoned=(await this.pool.query<Task>("SELECT * FROM processing_tasks WHERE cleanup_pending AND status IN ('failed','cancelled') ORDER BY finished_at LIMIT 20")).rows;
    for(const task of abandoned) {
      const lease=await this.pool.connect();
      try {
        const lock=(await lease.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",[`derivative:${task.id}`])).rows[0];
        if(lock?.locked){await this.cleanup(task);await lease.query("UPDATE processing_tasks SET cleanup_pending=false WHERE id=$1 AND status IN ('failed','cancelled')",[task.id]);}
      }catch{logger.warn({code:"DERIVATIVE_CLEANUP_RETRY",taskId:task.id});}
      finally{try{await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[`derivative:${task.id}`]);}finally{lease.release();}}
    }
  }
  private async process(job:Job) {
    const id=job.data?.version===1?job.data.taskId:undefined;
    if(typeof id!=="string"||!/^[a-f0-9-]{36}$/.test(id))throw new UnrecoverableError("INVALID_EVENT");
    const lease=await this.pool.connect();
    const leaseLost=()=>this.active.get(id)?.abort();lease.on("error",leaseLost);
    let poll:NodeJS.Timeout|undefined;
    try {
      const locked=(await lease.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",[`derivative:${id}`])).rows[0]?.locked;
      if(!locked)throw new Error("JOB_LEASE_BUSY");
      const task=(await lease.query<Task>("SELECT * FROM processing_tasks WHERE id=$1",[id])).rows[0];
      if(!task||!["queued","running"].includes(task.status))return;
      const attempt=task.attempts+1;
      const abort=new AbortController();this.active.set(id,abort);
      let checking=false;
      poll=setInterval(()=>{
        if(checking)return;checking=true;
        void this.pool.query<{cancel_requested:boolean}>("SELECT cancel_requested FROM processing_tasks WHERE id=$1",[id]).then(result=>{if(result.rows[0]?.cancel_requested)abort.abort();}).catch(()=>abort.abort()).finally(()=>{checking=false;});
      },500);poll.unref();
      await lease.query("UPDATE processing_tasks SET status='running',attempts=$2,started_at=COALESCE(started_at,now()),error_code=NULL WHERE id=$1",[id,attempt]);
      const started=performance.now();
      try {
        if(task.cancel_requested)throw new InspectionError("CANCELLED",false);
        if(attempt>3)throw new InspectionError("RECOVERY_RETRIES_EXHAUSTED",false);
        if(task.cleanup_pending)await this.cleanup(task);
        const source=(await lease.query<Source>("SELECT * FROM inspection_tasks WHERE id=$1 AND workspace_id=$2 AND status='succeeded'",[task.inspection_id,task.workspace_id])).rows[0];
        if(!source?.expected_sha256)throw new InspectionError("SOURCE_NOT_VALIDATED",false);
        const spec=internalProcessingSpec.parse(task.spec);
        const result=await produceDerivative(this.s3,this.config,{id,workspaceId:task.workspace_id,spec},{objectKey:source.object_key,workspaceId:source.workspace_id,expectedBytes:source.expected_bytes,expectedEtag:source.expected_etag,expectedSha256:source.expected_sha256},abort.signal);
        const succeeded=await lease.query("UPDATE processing_tasks SET status='succeeded',result=$2,finished_at=now(),cleanup_pending=false WHERE id=$1 AND NOT cancel_requested AND status='running' AND attempts=$3 RETURNING id",[id,result,attempt]);
        if(!succeeded.rows[0])throw new InspectionError("CANCELLED",false);
        recordDerivativeAttempt(task.spec.kind,"succeeded",(performance.now()-started)/1000,result.artifacts.reduce((total,a)=>total+a.bytes,0));
        logger.info({code:"DERIVATIVE_COMPLETED",taskId:id,correlationId:task.correlation_id,durationMs:Math.round(performance.now()-started),outputBytes:result.artifacts.reduce((total,a)=>total+a.bytes,0)});
      }catch(error) {
        const code=error instanceof InspectionError?error.code:abort.signal.aborted?"CANCELLED":"STORAGE_OR_NETWORK_ERROR";
        const terminal=code==="CANCELLED"||(error instanceof InspectionError&&!error.retryable)||attempt>=3;
        let cleanupPending=false;try{await this.cleanup(task);}catch{cleanupPending=true;}
        await lease.query("UPDATE processing_tasks SET status=$2,error_code=$3,finished_at=$4,cleanup_pending=$5,result=NULL WHERE id=$1",[id,terminal?(code==="CANCELLED"?"cancelled":"failed"):"queued",code,terminal?new Date():null,cleanupPending]);
        recordDerivativeAttempt(task.spec.kind,terminal?(code==="CANCELLED"?"cancelled":"failed"):"retry",(performance.now()-started)/1000);
        logger.warn({code,taskId:id,correlationId:task.correlation_id});
        if(terminal)throw new UnrecoverableError(code);
        // eslint-disable-next-line preserve-caught-error
        throw new Error(code);
      }
    }finally {
      if(poll)clearInterval(poll);this.active.delete(id);
      lease.removeListener("error",leaseLost);
      try{await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[`derivative:${id}`]);}finally{lease.release();}
    }
  }
  async readiness(){await this.pool.query("SELECT 1 FROM processing_tasks LIMIT 1");return this.config.MEDIA_WORKERS==="inspection"||Boolean(this.worker?.isRunning()&&!this.stopping);}
  async onModuleDestroy(){this.stopping=true;if(this.timer)clearInterval(this.timer);await this.working;await this.worker?.close();await this.queue.close();this.s3.destroy();await this.pool.end();}
}
