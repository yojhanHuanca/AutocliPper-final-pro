import {Injectable,type OnModuleInit,type OnModuleDestroy,HttpException,ConflictException,NotFoundException,BadRequestException} from "@nestjs/common";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {Queue,Worker,UnrecoverableError,type Job} from "bullmq";
import {Redis} from "ioredis";
import {HeadBucketCommand} from "@aws-sdk/client-s3";
import {z} from "zod";
import {analysisSpec,type AnalysisSpec} from "@autoclipper/api-contracts";
import {digest,body} from "@autoclipper/http-security";
import {logger,recordAnalysisAttempt} from "@autoclipper/observability";
import {analysisConfig,analysisS3,redisConnection} from "../infrastructure/connections.js";
import {withAudio,type AudioSource} from "../infrastructure/audio.js";
import {WhisperProvider} from "../infrastructure/whisper.js";
import {DeepgramProvider} from "../infrastructure/deepgram.js";
import {OllamaSelector} from "../infrastructure/ollama.js";
import {AnalysisError,validateTranscript,type Transcript,type TranscriptionProvider} from "../domain/transcript.js";

const queueName="content-analysis-v1";
export const sourceSchema=z.object({audioProcessingId:z.uuid(),objectKey:z.string().max(512),expectedBytes:z.number().int().positive().max(134217728),expectedEtag:z.string().min(1).max(200),expectedSha256:z.string().regex(/^[a-f0-9]{64}$/),durationSeconds:z.number().finite().positive().max(3600)}).strict();
type Row={id:string;workspace_id:string;creator_id:string;source:AudioSource;spec:AnalysisSpec;request_hash:string;transcription_revision:string;selection_revision:string|null;status:string;attempts:number;cancel_requested:boolean;provider_outcome_unknown:boolean;correlation_id:string;error_code:string|null;started_at:Date|null;finished_at:Date|null};
type Saved={id:string;data:Transcript;input_sha256:string};
@Injectable()
export class AnalysisRuntime implements OnModuleInit,OnModuleDestroy {
  readonly config=analysisConfig();
  readonly pool=new pg.Pool({connectionString:this.config.DATABASE_URL,max:5,connectionTimeoutMillis:2000,statement_timeout:5000});
  readonly s3=analysisS3(this.config);
  readonly redis=new Redis({...redisConnection(this.config.REDIS_URL),lazyConnect:true,maxRetriesPerRequest:1,commandTimeout:2000,retryStrategy:()=>null});
  readonly queue=new Queue(queueName,{connection:{...redisConnection(this.config.REDIS_URL),maxRetriesPerRequest:1,enableOfflineQueue:false}});
  readonly whisper=new WhisperProvider();readonly deepgram=new DeepgramProvider();readonly selector=new OllamaSelector();
  readonly providers:Record<AnalysisSpec["provider"],TranscriptionProvider>={whisper_cpp:this.whisper,deepgram:this.deepgram};
  private worker:Worker|undefined;private timer:NodeJS.Timeout|undefined;private working:Promise<void>|undefined;private stopping=false;private cursor:string|undefined;
  private readonly active=new Map<string,AbortController>();
  private revision(provider:AnalysisSpec["provider"]){return provider==="whisper_cpp"?this.whisper.expectedHash:this.deepgram.version;}
  async capabilities(){return{transcription:{whisper_cpp:{configured:await this.providers.whisper_cpp.configured(),maxSeconds:300,diarization:false},deepgram:{configured:await this.providers.deepgram.configured(),maxSeconds:3600,diarization:true}},selection:{ollama:{configured:await this.selector.configured()}},paidExecutionEnabled:this.deepgram.approved};}
  async preflight(spec:AnalysisSpec,duration:number){
    if(!await this.providers[spec.provider].configured())return{ready:false,code:"TRANSCRIPTION_NOT_CONFIGURED",httpStatus:503};
    if(spec.provider==="whisper_cpp"&&duration>300)return{ready:false,code:"LOCAL_TRANSCRIPTION_DURATION_LIMIT",httpStatus:400};
    if(spec.provider==="deepgram"&&Math.ceil(duration)*this.deepgram.unitPrice/60>this.deepgram.budget)return{ready:false,code:"AI_BUDGET_NOT_AUTHORIZED",httpStatus:503};
    if(spec.selection.mode==="llm"&&spec.selection.minSeconds*spec.selection.count>duration)return{ready:false,code:"INVALID_SELECTION_REQUEST",httpStatus:400};
    if(spec.selection.mode==="llm"&&!await this.selector.configured())return{ready:false,code:"SELECTION_NOT_CONFIGURED",httpStatus:503};
    return{ready:true,code:null,httpStatus:200};
  }
  async onModuleInit(){
    this.pool.on("error",()=>logger.error({code:"ANALYSIS_DATABASE_ERROR"}));this.redis.on("error",()=>logger.error({code:"ANALYSIS_REDIS_ERROR"}));this.queue.on("error",()=>logger.error({code:"ANALYSIS_QUEUE_ERROR"}));
    if(this.config.ANALYSIS_WORKER_ENABLED){this.worker=new Worker(queueName,job=>this.process(job),{connection:{...redisConnection(this.config.REDIS_URL),maxRetriesPerRequest:null},concurrency:1,lockDuration:30000,maxStalledCount:2});this.worker.on("error",()=>logger.error({code:"ANALYSIS_WORKER_ERROR"}));}await this.queue.waitUntilReady();
    this.timer=setInterval(()=>{if(!this.stopping&&!this.working)this.working=Promise.all([this.dispatch(),this.cleanupFailedArtifacts()]).catch(()=>logger.warn({code:"ANALYSIS_BACKGROUND_RETRY"})).then(()=>{}).finally(()=>{this.working=undefined;});},1000);this.timer.unref();
  }
  private async tx<T>(work:(client:pg.PoolClient)=>Promise<T>){const client=await this.pool.connect();try{await client.query("BEGIN");const value=await work(client);await client.query("COMMIT");return value;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  private async cleanupFailedArtifacts(){
    const pending=(await this.pool.query<{id:string}>("SELECT id FROM analysis_jobs WHERE cleanup_pending=true ORDER BY finished_at,id LIMIT 50")).rows;
    for(const row of pending)await this.tx(async client=>{
      await client.query("DELETE FROM segment_selections WHERE job_id=$1",[row.id]);
      await client.query("DELETE FROM transcripts WHERE job_id=$1",[row.id]);
      await client.query("UPDATE analysis_jobs SET cleanup_pending=false WHERE id=$1 AND cleanup_pending=true",[row.id]);
    });
  }
  async submit(input:{id:string;workspaceId:string;creatorId:string;correlationId:string;source:unknown;spec:unknown;cancelRequested:boolean}){
    const spec=body(analysisSpec,input.spec),source=body(sourceSchema,input.source);
    if(source.objectKey!==`workspaces/${input.workspaceId}/media/derivatives/${source.audioProcessingId}/audio.wav`)throw new BadRequestException();
    const hash=digest(JSON.stringify({source,spec}));
    const prior=(await this.pool.query<Row>("SELECT * FROM analysis_jobs WHERE id=$1",[input.id])).rows[0];
    if(!prior&&!input.cancelRequested){
      const checked=await this.preflight(spec,source.durationSeconds);if(!checked.ready)throw new HttpException({code:checked.code},checked.httpStatus);
    }
    await this.tx(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`analysis-workspace:${input.workspaceId}`]);
      const exists=(await client.query<Row>("SELECT * FROM analysis_jobs WHERE id=$1",[input.id])).rows[0];
      if(!exists){const count=(await client.query<{count:string}>("SELECT count(*) FROM analysis_jobs WHERE workspace_id=$1 AND status IN ('queued','transcribing','selecting')",[input.workspaceId])).rows[0];if(Number(count?.count??0)>=4)throw new ConflictException();}
      await client.query("INSERT INTO analysis_jobs(id,workspace_id,creator_id,source,spec,request_hash,correlation_id,cancel_requested,transcription_revision,selection_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING",[input.id,input.workspaceId,input.creatorId,source,spec,hash,input.correlationId,input.cancelRequested,this.revision(spec.provider)||"unconfigured",spec.selection.mode==="llm"?this.selector.digest:null]);
      const current=(await client.query<Row>("SELECT * FROM analysis_jobs WHERE id=$1",[input.id])).rows[0];if(!current||current.request_hash!==hash||current.workspace_id!==input.workspaceId||current.creator_id!==input.creatorId)throw new ConflictException();
      if(input.cancelRequested)await client.query("UPDATE analysis_jobs SET cancel_requested=true WHERE id=$1 AND status IN ('queued','transcribing','selecting')",[input.id]);
      await client.query("INSERT INTO analysis_outbox(job_id) VALUES($1) ON CONFLICT DO NOTHING",[input.id]);
    });return{id:input.id};
  }
  async status(id:string,workspaceId:string){
    const row=(await this.pool.query<Row>("SELECT * FROM analysis_jobs WHERE id=$1 AND workspace_id=$2",[id,workspaceId])).rows[0];if(!row)throw new NotFoundException();
    const transcript=(await this.pool.query<Saved>("SELECT id,data,input_sha256 FROM transcripts WHERE job_id=$1",[id])).rows[0];
    const selection=(await this.pool.query<{data:unknown}>("SELECT data FROM segment_selections WHERE job_id=$1",[id])).rows[0]?.data??null;
    const phases=(await this.pool.query("SELECT phase,attempt,started_at,finished_at,error_code FROM analysis_phase_attempts WHERE job_id=$1 ORDER BY started_at,id",[id])).rows.map(value=>({phase:value.phase,attempt:value.attempt,startedAt:value.started_at,finishedAt:value.finished_at,errorCode:value.error_code}));
    return{id:row.id,status:row.status,attempts:row.attempts,errorCode:row.error_code,startedAt:row.started_at?.toISOString()??null,finishedAt:row.finished_at?.toISOString()??null,transcript:transcript?{id:transcript.id,...transcript.data}:null,selection,providerOutcomeUnknown:row.provider_outcome_unknown,phases};
  }
  async cancel(id:string,workspaceId:string){const updated=await this.pool.query("UPDATE analysis_jobs SET cancel_requested=true WHERE id=$1 AND workspace_id=$2 RETURNING id",[id,workspaceId]);if(!updated.rows[0])throw new NotFoundException();this.active.get(id)?.abort();return{cancellationRequested:true};}
  private async dispatch(){
    const rows=(await this.pool.query<Row>("SELECT * FROM analysis_jobs WHERE status IN ('queued','transcribing','selecting') AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 100",[this.cursor??null])).rows;this.cursor=rows.length===100?rows.at(-1)?.id:undefined;
    for(const row of rows){const job=await this.queue.getJob(row.id);if(!job)await this.pool.query("UPDATE analysis_outbox SET delivered_at=NULL WHERE job_id=$1",[row.id]);else if(await job.getState()==="failed"){
      const lease=await this.pool.connect();try{const locked=(await lease.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",[`analysis:${row.id}`])).rows[0]?.locked;if(locked)await lease.query("UPDATE analysis_jobs SET status='failed',error_code='RECOVERY_RETRIES_EXHAUSTED',finished_at=now(),cleanup_pending=true WHERE id=$1 AND status IN ('queued','transcribing','selecting')",[row.id]);}finally{try{await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[`analysis:${row.id}`]);}finally{lease.release();}}
    }}
    const pending=(await this.pool.query<{job_id:string}>("SELECT job_id FROM analysis_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 50")).rows;
    for(const row of pending){await this.queue.add("analyze",{version:1,jobId:row.job_id},{jobId:row.job_id,attempts:3,backoff:{type:"exponential",delay:1000},removeOnComplete:false,removeOnFail:false});await this.pool.query("UPDATE analysis_outbox SET delivered_at=now() WHERE job_id=$1 AND delivered_at IS NULL",[row.job_id]);}
  }
  private async process(job:Job){
    const parsed=z.object({version:z.literal(1),jobId:z.uuid()}).strict().safeParse(job.data);if(!parsed.success)throw new UnrecoverableError("INVALID_EVENT");const id=parsed.data.jobId;
    const lease=await this.pool.connect();const lost=()=>this.active.get(id)?.abort();lease.on("error",lost);let timer:NodeJS.Timeout|undefined;
    try{
      if(!(await lease.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",[`analysis:${id}`])).rows[0]?.locked)throw new Error("ANALYSIS_LEASE_BUSY");
      const task=(await lease.query<Row>("SELECT * FROM analysis_jobs WHERE id=$1",[id])).rows[0];if(!task||!["queued","transcribing","selecting"].includes(task.status))return;
      const attempt=task.attempts+1,abort=new AbortController();this.active.set(id,abort);let checking=false;
      timer=setInterval(()=>{if(checking)return;checking=true;void this.pool.query<{cancel_requested:boolean}>("SELECT cancel_requested FROM analysis_jobs WHERE id=$1",[id]).then(result=>{if(result.rows[0]?.cancel_requested)abort.abort();}).catch(()=>abort.abort()).finally(()=>{checking=false;});},500);timer.unref();
      await lease.query("UPDATE analysis_jobs SET attempts=$2,started_at=COALESCE(started_at,now()),error_code=NULL WHERE id=$1",[id,attempt]);
      await lease.query("UPDATE analysis_phase_attempts SET finished_at=now(),error_code='WORKER_INTERRUPTED' WHERE job_id=$1 AND finished_at IS NULL",[id]);
      const started=performance.now();let phase:"transcribing"|"selecting"="transcribing";
      try{
        if(task.cancel_requested)throw new AnalysisError("CANCELLED");if(attempt>3)throw new AnalysisError("RECOVERY_RETRIES_EXHAUSTED");
        let saved=(await lease.query<Saved>("SELECT id,data,input_sha256 FROM transcripts WHERE job_id=$1",[id])).rows[0];
        if(!saved){
          if(task.transcription_revision!==this.revision(task.spec.provider))throw new AnalysisError("MODEL_CONFIGURATION_CHANGED");
          if(task.spec.provider==="deepgram"&&(await lease.query("SELECT id FROM provider_attempts WHERE job_id=$1 AND provider='deepgram' AND state IN ('started','unknown') LIMIT 1",[id])).rows[0])throw new AnalysisError("PROVIDER_OUTCOME_UNKNOWN",false,true);
          await lease.query("UPDATE analysis_jobs SET status='transcribing' WHERE id=$1",[id]);await lease.query("INSERT INTO analysis_phase_attempts(id,job_id,phase,attempt) VALUES($1,$2,'transcribing',$3)",[randomUUID(),id,attempt]);
          const provider=this.providers[task.spec.provider];const externalAttempt=randomUUID();
          if(!await provider.configured())throw new AnalysisError("TRANSCRIPTION_NOT_CONFIGURED");
          if(task.spec.provider==="deepgram"&&Math.ceil(task.source.durationSeconds)*this.deepgram.unitPrice/60>this.deepgram.budget)throw new AnalysisError("AI_BUDGET_NOT_AUTHORIZED");
          const transcript=await withAudio(this.s3,this.config.S3_BUCKET,this.config.TEMP_DIR,task.workspace_id,task.source,abort.signal,async path=>{
            await lease.query("INSERT INTO provider_attempts(id,job_id,provider,state,estimated_external_cost_usd) VALUES($1,$2,$3,'started',$4)",[externalAttempt,id,task.spec.provider,task.spec.provider==="deepgram"?Math.ceil(task.source.durationSeconds)*this.deepgram.unitPrice/60:0]);
            try{const result=validateTranscript(await provider.transcribe(path,task.source.durationSeconds,task.spec.language,abort.signal),task.source.durationSeconds);if(result.revision!==task.transcription_revision)throw new AnalysisError("TRANSCRIPT_MODEL_VERSION_MISMATCH");return result;}catch(error){await lease.query("UPDATE provider_attempts SET state=$2,finished_at=now() WHERE id=$1",[externalAttempt,error instanceof AnalysisError&&error.outcomeUnknown?"unknown":"failed"]);throw error;}
          });
          saved=await this.tx(async client=>{const transcriptId=randomUUID();await client.query("INSERT INTO transcripts(id,job_id,language,provider,model,revision,input_sha256,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id) DO NOTHING",[transcriptId,id,transcript.language,transcript.provider,transcript.model,transcript.revision,task.source.expectedSha256,transcript]);await client.query("UPDATE provider_attempts SET state='succeeded',request_id=$2,estimated_external_cost_usd=$3,finished_at=now() WHERE id=$1",[externalAttempt,transcript.requestId,transcript.estimatedExternalCostUsd]);await client.query("UPDATE analysis_phase_attempts SET finished_at=now() WHERE job_id=$1 AND phase='transcribing' AND attempt=$2",[id,attempt]);return(await client.query<Saved>("SELECT id,data,input_sha256 FROM transcripts WHERE job_id=$1",[id])).rows[0]!;});
        }
        if(saved.input_sha256!==task.source.expectedSha256)throw new AnalysisError("TRANSCRIPT_SOURCE_MISMATCH");
        if(abort.signal.aborted)throw new AnalysisError("CANCELLED");
        if(task.spec.selection.mode==="llm"){
          phase="selecting";if(task.selection_revision!==this.selector.digest)throw new AnalysisError("SELECTION_CONFIGURATION_CHANGED");
          const exists=(await lease.query("SELECT job_id FROM segment_selections WHERE job_id=$1",[id])).rows[0];
          if(!exists){await lease.query("UPDATE analysis_jobs SET status='selecting' WHERE id=$1",[id]);await lease.query("INSERT INTO analysis_phase_attempts(id,job_id,phase,attempt) VALUES($1,$2,'selecting',$3)",[randomUUID(),id,attempt]);const selection=await this.selector.select(saved.data,task.spec.selection,abort.signal);await this.tx(async client=>{await client.query("INSERT INTO segment_selections(job_id,model,revision,prompt_version,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[id,selection.model,selection.revision,selection.promptVersion,selection]);await client.query("UPDATE analysis_phase_attempts SET finished_at=now() WHERE job_id=$1 AND phase='selecting' AND attempt=$2",[id,attempt]);});}
        }
        const complete=await lease.query("UPDATE analysis_jobs SET status='succeeded',finished_at=now() WHERE id=$1 AND NOT cancel_requested AND attempts=$2 RETURNING id",[id,attempt]);if(!complete.rows[0])throw new AnalysisError("CANCELLED");
        recordAnalysisAttempt(task.spec.provider,"succeeded",(performance.now()-started)/1000,task.source.durationSeconds);
        logger.info({code:"ANALYSIS_COMPLETED",jobId:id,correlationId:task.correlation_id,provider:task.spec.provider,durationMs:Math.round(performance.now()-started),sourceSeconds:task.source.durationSeconds,estimatedExternalCostUsd:saved.data.estimatedExternalCostUsd});
      }catch(error){
        const known=error instanceof AnalysisError?error:new AnalysisError(abort.signal.aborted?"CANCELLED":"ANALYSIS_DEPENDENCY_ERROR",!abort.signal.aborted);
        const terminal=!known.retryable||attempt>=3;
        recordAnalysisAttempt(task.spec.provider,terminal?(known.code==="CANCELLED"?"cancelled":"failed"):"retry",(performance.now()-started)/1000);
        await lease.query("UPDATE analysis_phase_attempts SET finished_at=COALESCE(finished_at,now()),error_code=$3 WHERE job_id=$1 AND phase=$2 AND attempt=$4 AND finished_at IS NULL",[id,phase,known.code,attempt]);
        await lease.query("UPDATE analysis_jobs SET status=$2,error_code=$3,provider_outcome_unknown=$4,finished_at=$5,cleanup_pending=$6 WHERE id=$1",[id,terminal?(known.code==="CANCELLED"?"cancelled":"failed"):"queued",known.code,known.outcomeUnknown,terminal?new Date():null,terminal]);logger.warn({code:known.code,jobId:id,correlationId:task.correlation_id});
        if(terminal)throw new UnrecoverableError(known.code);
        // eslint-disable-next-line preserve-caught-error
        throw new Error(known.code);
      }
    }finally{if(timer)clearInterval(timer);this.active.delete(id);lease.removeListener("error",lost);try{await lease.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[`analysis:${id}`]);}finally{lease.release();}}
  }
  async readiness(){await this.pool.query("SELECT 1 FROM analysis_jobs LIMIT 1");if(this.redis.status==="wait"||this.redis.status==="end")await this.redis.connect();await this.redis.ping();await this.s3.send(new HeadBucketCommand({Bucket:this.config.S3_BUCKET}));return !this.stopping&&(!this.config.ANALYSIS_WORKER_ENABLED||Boolean(this.worker?.isRunning()));}
  async onModuleDestroy(){this.stopping=true;if(this.timer)clearInterval(this.timer);await this.working;await this.worker?.close();await this.queue.close();this.redis.disconnect();this.s3.destroy();await this.pool.end();}
}
