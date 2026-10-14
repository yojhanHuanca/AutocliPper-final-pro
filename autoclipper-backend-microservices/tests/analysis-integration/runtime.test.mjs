import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {clearTimeout} from 'node:timers';
import {PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {eventually} from '@autoclipper/testing';
import {AnalysisRuntime} from '../../apps/autoclipper-content-analysis-service/dist/application/analysis-runtime.js';
import {AnalysisError} from '../../apps/autoclipper-content-analysis-service/dist/domain/transcript.js';
// Explicit fixture provider, installed only in this test process. PostgreSQL,
// Redis and S3 remain real. This suite is NOT real ASR/LLM acceptance.
test('analysis persistence, recovery, bounded retries, cancellation and unknown paid outcomes with an explicit fixture provider',{timeout:180000},async t=>{
  assert.equal(process.env.ANALYSIS_INTEGRATION_ISOLATED,'true','Stop other analysis workers before this isolated suite');
  const execute=promisify(execFile);
  for(let index=0;index<2;index++)await execute(process.execPath,['scripts/migrate-service.mjs','analysis'],{env:process.env,timeout:30000,windowsHide:true});
  const directory=await mkdtemp(join(tmpdir(),'analysis-recovery-'));process.env.TEMP_DIR=directory;
  const hash='a'.repeat(64);process.env.WHISPER_MODEL_SHA256=hash;process.env.DEEPGRAM_MODEL_VERSION='fixture-version';process.env.OLLAMA_MODEL_SHA256=hash;process.env.DEEPGRAM_USD_PER_MINUTE='0.1';process.env.AI_MAX_ESTIMATED_USD_PER_JOB='1';
  const workspace=randomUUID(),audioId=randomUUID(),key=`workspaces/${workspace}/media/derivatives/${audioId}/audio.wav`,jobs=[];let runtime,calls=0,mode='normal',selectionCalls=0;
  const fixture={language:'es',languageSource:'detected',durationSeconds:13.8,segments:[{startSeconds:0,endSeconds:4,text:'EXPLICIT TEST PROVIDER FIXTURE'}],provider:'whisper_cpp',model:'fixture-only',revision:hash,engineVersion:'fixture-only',modelSha256:hash,requestId:null,estimatedExternalCostUsd:0,diarization:false};
  const provider={name:'whisper_cpp',configured:async()=>true,transcribe:async(_path,duration,_language,signal)=>{calls++;if(mode==='slow'){await new Promise((resolve,reject)=>{const timeout=setTimeout(resolve,10000);signal.addEventListener('abort',()=>{clearTimeout(timeout);reject(new AnalysisError('CANCELLED'));},{once:true});});}if(mode==='unknown')throw new AnalysisError('PROVIDER_OUTCOME_UNKNOWN',false,true);return{...fixture,durationSeconds:duration};}};
  async function start(enabled=true){process.env.ANALYSIS_WORKER_ENABLED=String(enabled);runtime=new AnalysisRuntime();runtime.providers.whisper_cpp=provider;runtime.providers.deepgram={...provider,name:'deepgram'};runtime.selector.configured=async()=>true;runtime.selector.select=async()=>{selectionCalls++;if(selectionCalls===1)throw new AnalysisError('FIXTURE_SELECTION_RETRY',true);return{segments:[{startSeconds:0,endSeconds:4,title:'Explicit fixture',description:'Fixture',hashtags:['#fixture'],explanation:'Not real LLM output'}],provider:'ollama',model:'fixture:1',revision:hash,promptVersion:'segment-selection-v1',usage:{inputTokens:1,outputTokens:1},estimatedExternalCostUsd:0};};await runtime.onModuleInit();}
  async function stop(){if(runtime){await runtime.onModuleDestroy();runtime=undefined;}}
  let source;
  async function submit(extra={},spec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'}}){const id=randomUUID();jobs.push(id);await runtime.submit({id,workspaceId:workspace,creatorId:audioId,correlationId:randomUUID(),source:{...source,...extra},spec,cancelRequested:false});return id;}
  async function terminal(id){let value;await eventually(async()=>{value=await runtime.status(id,workspace);return['succeeded','failed','cancelled'].includes(value.status);},45000);return value;}
  try{
    await start(false);const bytes=await readFile(new URL('../fixtures/speech-es.wav',import.meta.url));const stored=await runtime.s3.send(new PutObjectCommand({Bucket:runtime.config.S3_BUCKET,Key:key,Body:bytes}));source={audioProcessingId:audioId,objectKey:key,expectedBytes:bytes.length,expectedEtag:stored.ETag,expectedSha256:createHash('sha256').update(bytes).digest('hex'),durationSeconds:13.8};
    await t.test('acknowledged outbox recovers a Redis job lost before worker startup',async()=>{
      const id=await submit();await eventually(async()=>Boolean((await runtime.pool.query('SELECT delivered_at FROM analysis_outbox WHERE job_id=$1',[id])).rows[0]?.delivered_at),10000);await runtime.queue.getJob(id).then(job=>job.remove());await stop();await start();const value=await terminal(id);assert.equal(value.status,'succeeded',JSON.stringify(value));assert.equal(value.attempts,1);assert.equal(calls,1);assert.equal(value.transcript.model,'fixture-only');assert.equal(value.selection,null);
      await assert.rejects(runtime.status(id,randomUUID()));
      await runtime.submit({id,workspaceId:workspace,creatorId:audioId,correlationId:randomUUID(),source,spec:{version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'}},cancelRequested:false});await stop();await start();assert.equal((await terminal(id)).attempts,1);assert.equal(calls,1);
    });
    await t.test('a persisted transcript is reused when selection retries',async()=>{
      const before=calls;const id=await submit({},{version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'llm',count:1,minSeconds:2,maxSeconds:4}});const value=await terminal(id);assert.equal(value.status,'succeeded',JSON.stringify(value));assert.equal(value.attempts,2);assert.equal(calls-before,1);assert.equal(selectionCalls,2);assert.equal(value.phases.length,3);assert.equal(value.selection.promptVersion,'segment-selection-v1');
    });
    await t.test('queued and running cancellations persist and remove temporary audio',async()=>{
      await stop();await start(false);let id=await submit();await runtime.cancel(id,workspace);await stop();await start();assert.equal((await terminal(id)).status,'cancelled');mode='slow';id=await submit();await eventually(async()=>(await runtime.status(id,workspace)).status==='transcribing',10000);await runtime.cancel(id,workspace);assert.equal((await terminal(id)).status,'cancelled');mode='normal';
    });
    await t.test('audio hash mismatch is permanent and missing storage retries exactly three times',async()=>{
      const before=calls;const mismatch=await terminal(await submit({expectedSha256:'b'.repeat(64)}));assert.equal(mismatch.status,'failed');assert.equal(mismatch.errorCode,'AUDIO_CHECKSUM_MISMATCH');assert.equal(mismatch.attempts,1);
      const missingId=randomUUID();const missing=await terminal(await submit({audioProcessingId:missingId,objectKey:`workspaces/${workspace}/media/derivatives/${missingId}/audio.wav`}));assert.equal(missing.attempts,3);assert.equal(missing.status,'failed');assert.equal(calls,before);
    });
    await t.test('uncertain paid response and a persisted started attempt never trigger a second provider call',async()=>{
      mode='unknown';const before=calls;let id=await submit({},{version:1,provider:'deepgram',selection:{mode:'none'}});let value=await terminal(id);assert.equal(value.status,'failed');assert.equal(value.providerOutcomeUnknown,true);assert.equal(value.attempts,1);assert.equal(calls-before,1);mode='normal';await stop();await start(false);id=await submit({},{version:1,provider:'deepgram',selection:{mode:'none'}});await runtime.pool.query("INSERT INTO provider_attempts(id,job_id,provider,state) VALUES($1,$2,'deepgram','started')",[randomUUID(),id]);await stop();await start();value=await terminal(id);assert.equal(value.errorCode,'PROVIDER_OUTCOME_UNKNOWN');assert.equal(value.providerOutcomeUnknown,true);assert.equal(calls-before,1);
    });
    await t.test('cross-workspace sources are rejected and every terminal path cleans temporary files',async()=>{
      await assert.rejects(runtime.submit({id:randomUUID(),workspaceId:randomUUID(),creatorId:audioId,correlationId:randomUUID(),source,spec:{version:1,provider:'whisper_cpp'},cancelRequested:false}));await stop();assert.deepEqual(await readdir(directory),[]);
    });
  }finally{
    if(!runtime)await start(false);
    for(const id of jobs){const job=await runtime.queue.getJob(id);if(job)await job.remove();}
    await runtime.pool.query('DELETE FROM analysis_jobs WHERE id=ANY($1::uuid[])',[jobs]);await runtime.s3.send(new DeleteObjectCommand({Bucket:runtime.config.S3_BUCKET,Key:key}));await stop();await rm(directory,{recursive:true,force:true});
  }
});
