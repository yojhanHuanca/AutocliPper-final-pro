import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {AnalysisRuntime} from '../../apps/autoclipper-content-analysis-service/dist/application/analysis-runtime.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function verifyAnalysisCleanup(config,storageEndpoint,bucket){
  const databaseUrl=`postgresql://autoclipper_analysis_runtime:${config.password}@target-pg:5432/autoclipper_analysis`;
  Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:databaseUrl,REDIS_URL:'redis://target-redis:6379/0',S3_ENDPOINT:storageEndpoint,S3_BUCKET:bucket,S3_REGION:'us-east-1',S3_ACCESS_KEY:config.accessKey,S3_SECRET_KEY:config.secretKey,INTERNAL_TOKEN:config.internalToken,ANALYSIS_WORKER_ENABLED:'false'});
  const db=new pg.Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
  const owner=new pg.Pool({connectionString:`postgresql://autoclipper_analysis_owner:${config.password}@target-pg:5432/autoclipper_analysis`,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
  const failed=randomUUID(),cancelled=randomUUID(),success=randomUUID(),peer=randomUUID(),workspace=randomUUID(),peerWorkspace=randomUUID();let runtime;
  const run=async()=>{runtime=new AnalysisRuntime();await runtime.onModuleInit();};
  const stop=async()=>{if(runtime){const current=runtime;runtime=undefined;await current.onModuleDestroy();}};
  const insertJob=async(id,ws,status,pending)=>db.query("INSERT INTO analysis_jobs(id,workspace_id,creator_id,source,spec,request_hash,status,correlation_id,transcription_revision,cleanup_pending,finished_at) VALUES($1,$2,$3,'{}','{}',$4,$5,$6,'fixture',$7,now())",[id,ws,randomUUID(),'a'.repeat(64),status,randomUUID(),pending]);
  const insertArtifacts=async(id)=>{await db.query("INSERT INTO transcripts(id,job_id,language,provider,model,revision,input_sha256,data) VALUES($1,$2,'es','whisper_cpp','fixture','fixture',$3,'{\"text\":\"private transcript\",\"segments\":[]}')",[randomUUID(),id,'b'.repeat(64)]);await db.query("INSERT INTO segment_selections(job_id,model,revision,prompt_version,data) VALUES($1,'fixture','fixture','fixture','{\"segments\":[\"private selection\"]}')",[id]);};
  try{
    await insertJob(failed,workspace,'failed',true);await insertJob(cancelled,workspace,'cancelled',true);await insertJob(success,workspace,'succeeded',false);await insertJob(peer,peerWorkspace,'failed',false);
    for(const id of[failed,cancelled,success,peer])await insertArtifacts(id);
    await owner.query(`CREATE FUNCTION recovery_fail_analysis_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='${failed}'::uuid AND OLD.cleanup_pending AND NOT NEW.cleanup_pending THEN RAISE EXCEPTION 'fixture failure after analysis artifact deletion' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`);
    await owner.query('CREATE TRIGGER recovery_fail_analysis_cleanup BEFORE UPDATE OF cleanup_pending ON analysis_jobs FOR EACH ROW EXECUTE FUNCTION recovery_fail_analysis_cleanup()');
    await run();const deadline=Date.now()+20000;let failedAfterInjected=false;
    while(Date.now()<deadline){const row=(await db.query('SELECT cleanup_pending FROM analysis_jobs WHERE id=$1',[failed])).rows[0];const transcript=(await db.query('SELECT 1 FROM transcripts WHERE job_id=$1',[failed])).rows[0];if(row?.cleanup_pending&&transcript){failedAfterInjected=true;break;}await sleep(100);}
    assert.ok(failedAfterInjected,'injected transaction failure must leave cleanup pending and artifacts intact');
    await stop();await owner.query('DROP TRIGGER recovery_fail_analysis_cleanup ON analysis_jobs');await owner.query('DROP FUNCTION recovery_fail_analysis_cleanup()');await run();
    const retryDeadline=Date.now()+20000;while(Date.now()<retryDeadline&&(await db.query('SELECT cleanup_pending FROM analysis_jobs WHERE id=$1',[failed])).rows[0].cleanup_pending)await sleep(100);
    for(const id of[failed,cancelled]){assert.equal((await db.query('SELECT cleanup_pending FROM analysis_jobs WHERE id=$1',[id])).rows[0].cleanup_pending,false);assert.equal((await db.query('SELECT count(*) FROM transcripts WHERE job_id=$1',[id])).rows[0].count,'0');assert.equal((await db.query('SELECT count(*) FROM segment_selections WHERE job_id=$1',[id])).rows[0].count,'0');}
    for(const id of[success,peer]){assert.ok((await db.query('SELECT 1 FROM transcripts WHERE job_id=$1',[id])).rows[0]);assert.ok((await db.query('SELECT 1 FROM segment_selections WHERE job_id=$1',[id])).rows[0]);}
    assert.ok((await db.query('SELECT source,spec,status FROM analysis_jobs WHERE id=$1',[failed])).rows[0].source);
    await stop();await run();await sleep(1200);assert.equal((await db.query('SELECT cleanup_pending FROM analysis_jobs WHERE id=$1',[failed])).rows[0].cleanup_pending,false);
    return{status:'passed',scope:'failed-cancelled-analysis-text-artifacts-v1',purgedJobs:2,deletedArtifacts:4,retryAfterTransactionFailure:true,analysisRestartRecovered:true,workspaceIsolation:true,successfulAnalysisPreserved:true,sourceReferencesPreserved:true,idempotent:true};
  }finally{
    await stop();try{await owner.query('DROP TRIGGER IF EXISTS recovery_fail_analysis_cleanup ON analysis_jobs');await owner.query('DROP FUNCTION IF EXISTS recovery_fail_analysis_cleanup()');}catch{/* best effort teardown */}
    await db.query('DELETE FROM analysis_jobs WHERE id=ANY($1::uuid[])',[[failed,cancelled,success,peer]]).catch(()=>{});await Promise.all([db.end(),owner.end()]);
  }
}
