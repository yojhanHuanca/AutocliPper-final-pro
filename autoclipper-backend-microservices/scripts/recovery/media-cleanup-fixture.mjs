import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {DeleteObjectCommand,HeadObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {ProcessingRuntime} from '../../apps/autoclipper-media-processing-service/dist/application/processing-runtime.js';

const files=['clip.mp4','audio.wav','captions.srt','captions.vtt'];
const prefix=(workspaceId,taskId)=>`workspaces/${workspaceId}/media/derivatives/${taskId}/`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function verifyMediaCleanup(config,storageEndpoint,bucket,sourceTaskId){
  const databaseUrl=`postgresql://autoclipper_media_runtime:${config.password}@target-pg:5432/autoclipper_media`;
  Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:databaseUrl,REDIS_URL:'redis://target-redis:6379/0',S3_ENDPOINT:storageEndpoint,S3_BUCKET:bucket,S3_REGION:'us-east-1',S3_FORCE_PATH_STYLE:'true',S3_ACCESS_KEY:config.accessKey,S3_SECRET_KEY:config.secretKey,INTERNAL_TOKEN:config.internalToken,MEDIA_WORKERS:'inspection'});
  const db=new pg.Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
  const owner=new pg.Pool({connectionString:`postgresql://autoclipper_media_owner:${config.password}@target-pg:5432/autoclipper_media`,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
  const s3=new S3Client({endpoint:storageEndpoint,forcePathStyle:true,region:'us-east-1',credentials:{accessKeyId:config.accessKey,secretAccessKey:config.secretKey}});
  const taskId=randomUUID(),peerTaskId=randomUUID(),workspaceId=randomUUID(),peerWorkspaceId=randomUUID();let runtime;
  const run=async()=>{runtime=new ProcessingRuntime();await runtime.onModuleInit();};
  const stop=async()=>{if(runtime){const current=runtime;runtime=undefined;await current.onModuleDestroy();}};
  async function expectMissing(key){await assert.rejects(s3.send(new HeadObjectCommand({Bucket:bucket,Key:key})),error=>error.$metadata?.httpStatusCode===404||error.name==='NotFound');}
  try{
    const inspection=(await db.query("SELECT id FROM inspection_tasks WHERE id=$1 AND status='succeeded'",[sourceTaskId])).rows[0];assert.ok(inspection,'cleanup fixture requires a restored succeeded inspection');
    await db.query("INSERT INTO processing_tasks(id,workspace_id,inspection_id,spec,request_hash,status,correlation_id,finished_at,cleanup_pending) VALUES($1,$2,$3,'{}',$4,'failed',$5,now(),true),($6,$7,$3,'{}',$4,'failed',$8,now(),false)",[taskId,workspaceId,sourceTaskId,'a'.repeat(64),randomUUID(),peerTaskId,peerWorkspaceId,randomUUID()]);
    await db.query('INSERT INTO processing_outbox(task_id,delivered_at) VALUES($1,now()),($2,now())',[taskId,peerTaskId]);
    for(const file of files){await s3.send(new PutObjectCommand({Bucket:bucket,Key:prefix(workspaceId,taskId)+file,Body:Buffer.from(`purge-${file}`)}));await s3.send(new PutObjectCommand({Bucket:bucket,Key:prefix(peerWorkspaceId,peerTaskId)+file,Body:Buffer.from(`preserve-${file}`)}));}
    await owner.query(`CREATE FUNCTION recovery_fail_media_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure after derivative deletion' USING ERRCODE='40001'; END $$`);
    await owner.query(`CREATE TRIGGER recovery_fail_media_cleanup BEFORE UPDATE OF cleanup_pending ON processing_tasks FOR EACH ROW WHEN (OLD.id='${taskId}'::uuid AND OLD.cleanup_pending AND NOT NEW.cleanup_pending) EXECUTE FUNCTION recovery_fail_media_cleanup()`);
    await run();
    const deadline=Date.now()+20000;let deleted=false;
    while(Date.now()<deadline){const state=(await db.query('SELECT cleanup_pending FROM processing_tasks WHERE id=$1',[taskId])).rows[0];if(state?.cleanup_pending){const heads=await Promise.all(files.map(async file=>{try{await s3.send(new HeadObjectCommand({Bucket:bucket,Key:prefix(workspaceId,taskId)+file}));return true;}catch(error){return error.$metadata?.httpStatusCode===404||error.name==='NotFound'?false:(()=>{throw error;})();}}));if(heads.every(value=>!value)){deleted=true;break;}}await sleep(100);}
    assert.ok(deleted,'first cleanup must delete its own artifacts before injected SQL failure');assert.equal((await db.query('SELECT cleanup_pending FROM processing_tasks WHERE id=$1',[taskId])).rows[0].cleanup_pending,true);
    for(const file of files)assert.equal((await s3.send(new HeadObjectCommand({Bucket:bucket,Key:prefix(peerWorkspaceId,peerTaskId)+file}))).ContentLength,`preserve-${file}`.length);
    await stop();await owner.query('DROP TRIGGER recovery_fail_media_cleanup ON processing_tasks');await owner.query('DROP FUNCTION recovery_fail_media_cleanup()');
    await run();
    const retryDeadline=Date.now()+20000;while(Date.now()<retryDeadline&&(await db.query('SELECT cleanup_pending FROM processing_tasks WHERE id=$1',[taskId])).rows[0].cleanup_pending)await sleep(100);
    assert.equal((await db.query('SELECT cleanup_pending FROM processing_tasks WHERE id=$1',[taskId])).rows[0].cleanup_pending,false,'fresh Media process must finish interrupted cleanup');
    for(const file of files){await expectMissing(prefix(workspaceId,taskId)+file);assert.equal((await s3.send(new HeadObjectCommand({Bucket:bucket,Key:prefix(peerWorkspaceId,peerTaskId)+file}))).ContentLength,`preserve-${file}`.length);}
    await stop();await run();await sleep(1200);assert.equal((await db.query('SELECT cleanup_pending FROM processing_tasks WHERE id=$1',[taskId])).rows[0].cleanup_pending,false);
    return{status:'passed',cleanup:'failed-task-derivatives-v1',deletedArtifacts:files.length,retryAfterDelete:true,mediaRestartRecovered:true,workspaceIsolation:true,idempotent:true};
  }finally{
    await stop();
    try{await owner.query('DROP TRIGGER IF EXISTS recovery_fail_media_cleanup ON processing_tasks');await owner.query('DROP FUNCTION IF EXISTS recovery_fail_media_cleanup()');}catch{/* cleanup is best effort if setup failed before creating the fixture trigger */}
    for(const id of[taskId,peerTaskId])for(const file of files)try{await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:prefix(id===taskId?workspaceId:peerWorkspaceId,id)+file}));}catch{/* cleanup is best effort while preserving the acceptance failure */}
    await Promise.all([db.end(),owner.end()]);s3.destroy();
  }
}
