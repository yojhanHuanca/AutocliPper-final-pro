import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import {ProjectService} from '../../apps/autoclipper-project-service/dist/application/project.service.js';
import {verifiedAccountFixture} from '../helpers/verified-account-fixture.mjs';
const execute=promisify(execFile),spec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'},startSeconds:0,endSeconds:4,aspect:'square'},reservation=202375168;
// Explicit inspection/preflight and completed-stage SQL fixtures. This suite
// proves Project transactions/recovery/roles against real Pg/identity/workspace;
// it does NOT claim media execution or inference. The opt-in suite proves those.
test('durable pipeline transitions, crash replay, cancellation, limits and quota with explicit stage fixtures',{timeout:120000},async t=>{
  assert.equal(process.env.PIPELINE_INTEGRATION_ISOLATED,'true');
  await assert.rejects(fetch('http://project:3004/v1/health/live',{signal:AbortSignal.timeout(2000)}),'Stop the application Project dispatcher before this isolated suite');
  for(let i=0;i<2;i++)await execute(process.execPath,['scripts/migrate-service.mjs','project'],{env:process.env,timeout:30000});
  const alice=await verifiedAccountFixture(),bob=await verifiedAccountFixture();
  const workspace=await alice.c.request('/workspaces','POST',{kind:'team',name:'Explicit pipeline persistence fixture'},{'idempotency-key':randomUUID()});assert.equal(workspace.status,201);
  let ready=true,service;const uploadId=randomUUID(),projectId=randomUUID(),workspaceId=workspace.value.id;
  const server=createServer(async(req,res)=>{let data='';for await(const chunk of req)data+=chunk;const input=JSON.parse(data||'{}');assert.equal(req.headers['x-service-token'],process.env.INTERNAL_TOKEN);res.setHeader('content-type','application/json');if(req.url==='/v1/internal/inspection-status'&&input.id===uploadId)res.end(JSON.stringify({status:'succeeded',result:{durationSeconds:8,width:320,height:240,audioCodec:'aac'}}));else if(req.url==='/v1/internal/analysis-preflight')res.end(JSON.stringify({ready,code:ready?null:'TRANSCRIPTION_NOT_CONFIGURED',httpStatus:ready?200:503}));else{res.statusCode=404;res.end('{}');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;process.env.MEDIA_URL=url;process.env.ANALYSIS_URL=url;
  const request=(user,key=randomUUID())=>({headers:{origin:'http://localhost:4200',cookie:[...user.c.jar].map(([k,v])=>`${k}=${v}`).join(';'),'x-csrf-token':user.c.jar.get('autoclipper_csrf'),'idempotency-key':key}});
  const start=()=>{service=new ProjectService();};
  const step=async()=>{await service.usage.dispatch();await service.pipelines.dispatch();await service.usage.dispatch();await service.pipelines.dispatch();};
  const stop=async()=>{if(service){await service.onModuleDestroy();service=undefined;}};
  const create=async(input=spec,key=randomUUID())=>service.pipelines.begin(request(alice,key),uploadId,input,randomUUID());
  const status=id=>service.pipelines.status(request(alice),id);
  const quota=async()=>Number((await service.pool.query('SELECT reserved_bytes FROM workspace_storage WHERE workspace_id=$1',[workspaceId])).rows[0].reserved_bytes);
  async function audioDone(id){const row=(await service.pool.query("SELECT id FROM processing_requests WHERE pipeline_id=$1 AND spec->>'kind'='audio'",[id])).rows[0];const result={durationSeconds:8,sampleRate:16000,artifacts:[{kind:'audio',objectKey:`workspaces/${workspaceId}/media/derivatives/${row.id}/audio.wav`,bytes:1000,etag:'"explicit-fixture"',sha256:'a'.repeat(64),contentType:'audio/wav'}]};await service.pool.query("UPDATE processing_requests SET status='succeeded',result=$2,finished_at=now(),settled_at=now(),delivered_at=now() WHERE id=$1",[row.id,result]);await service.pool.query('UPDATE workspace_storage SET reserved_bytes=reserved_bytes-134217728,used_bytes=used_bytes+1000 WHERE workspace_id=$1',[workspaceId]);}
  async function analysisDone(id,segments=[{startSeconds:0,endSeconds:4,text:'EXPLICIT STAGE FIXTURE; NOT INFERENCE'}]){const row=(await service.pool.query('SELECT id FROM analysis_requests WHERE pipeline_id=$1',[id])).rows[0];const value={id:row.id,status:'succeeded',attempts:1,errorCode:null,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),transcript:{id:randomUUID(),language:'es',languageSource:'detected',durationSeconds:8,segments,provider:'whisper_cpp',model:'explicit-fixture',revision:'a'.repeat(64),engineVersion:'fixture',modelSha256:'a'.repeat(64),requestId:null,estimatedExternalCostUsd:0,diarization:false},selection:null,providerOutcomeUnknown:false,phases:[]};await service.pool.query('UPDATE analysis_requests SET cached_status=$2,finished_at=now(),delivered_at=now() WHERE id=$1',[row.id,value]);}
  async function cancelledChildren(id){const children=(await service.pool.query('SELECT id,reservation_bytes FROM processing_requests WHERE pipeline_id=$1 AND settled_at IS NULL',[id])).rows;for(const child of children){await service.pool.query("UPDATE processing_requests SET status='cancelled',finished_at=now(),settled_at=now(),delivered_at=now() WHERE id=$1",[child.id]);await service.pool.query('UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$2 WHERE workspace_id=$1',[workspaceId,child.reservation_bytes]);}await service.pool.query("UPDATE analysis_requests SET cached_status=jsonb_build_object('status','cancelled'),finished_at=now(),delivered_at=now() WHERE pipeline_id=$1 AND finished_at IS NULL",[id]);}
  try{
    start();await service.pool.query("INSERT INTO projects(id,workspace_id,creator_id,name,idempotency_key,request_hash) VALUES($1,$2,$3,'Explicit pipeline fixture',$4,'fixture')",[projectId,workspaceId,alice.id,randomUUID()]);await service.pool.query("INSERT INTO uploads(id,workspace_id,project_id,creator_id,idempotency_key,request_hash,object_key,expected_bytes,sha256,content_type,mode,state,etag) VALUES($1,$2,$3,$4,$5,'fixture',$6,100,'fixture','video/mp4','put','confirmed','fixture')",[uploadId,workspaceId,projectId,alice.id,randomUUID(),`fixture/${uploadId}`]);await service.pool.query('INSERT INTO workspace_storage(workspace_id,used_bytes) VALUES($1,100)',[workspaceId]);
    await t.test('real identity/workspace permissions, strict manual contract and unavailable provider reserve nothing',async()=>{
      await assert.rejects(service.pipelines.begin(request(bob),uploadId,spec,randomUUID()),error=>error.getStatus()===403);
      for(const changed of [{provider:'deepgram'},{selection:{mode:'llm'}},{endSeconds:9}])await assert.rejects(create({...spec,...changed}),error=>error.getStatus()===400);
      ready=false;await assert.rejects(create(),error=>error.getStatus()===503);ready=true;assert.equal(await quota(),0);
      const previous=process.env.WORKSPACE_STORAGE_LIMIT_BYTES;try{process.env.WORKSPACE_STORAGE_LIMIT_BYTES='1000';await assert.rejects(create(),error=>error.getStatus()===409);assert.equal(await quota(),0);}finally{if(previous===undefined)delete process.env.WORKSPACE_STORAGE_LIMIT_BYTES;else process.env.WORKSPACE_STORAGE_LIMIT_BYTES=previous;}
    });
    await t.test('concurrent replay and real orchestrator process loss preserve exactly one child outbox and reservation',async()=>{
      const key=randomUUID(),created=await Promise.all([create(spec,key),create(spec,key)]);assert.equal(created[0].id,created[1].id);const id=created[0].id;assert.equal(await quota(),reservation);await assert.rejects(create({...spec,endSeconds:3},key),error=>error.getStatus()===409);
      await stop();await assert.rejects(execute(process.execPath,['tests/helpers/pipeline-crash.mjs'],{env:process.env,timeout:20000}),error=>error.signal==='SIGKILL');start();let state=await status(id);assert.equal(state.status,'audio');const audioId=state.audioProcessingId;assert.ok(audioId);assert.equal(state.reservedBytes,68157440);assert.equal(await quota(),reservation);
      await Promise.all([step(),step()]);assert.equal((await status(id)).audioProcessingId,audioId);assert.equal(Number((await service.pool.query('SELECT count(*) FROM processing_requests WHERE pipeline_id=$1',[id])).rows[0].count),1);
      await audioDone(id);await step();state=await status(id);assert.equal(state.status,'analysis');const analysisId=state.analysisId;await stop();start();await step();assert.equal((await status(id)).analysisId,analysisId);
      await analysisDone(id);await Promise.all([step(),step()]);state=await status(id);assert.equal(state.status,'render');assert.equal(state.reservedBytes,0);const render=(await service.pool.query("SELECT id,spec FROM processing_requests WHERE pipeline_id=$1 AND spec->>'kind'='clip'",[id])).rows[0];assert.equal(render.spec.subtitles.provenance,'transcript');assert.ok(render.spec.subtitles.transcriptId);assert.equal(await quota(),68157440);
      await service.pool.query("UPDATE processing_requests SET status='succeeded',finished_at=now(),settled_at=now(),delivered_at=now(),result=$2 WHERE id=$1",[render.id,{durationSeconds:4,width:720,height:720,artifacts:[]}]);await service.pool.query('UPDATE workspace_storage SET reserved_bytes=reserved_bytes-68157440 WHERE workspace_id=$1',[workspaceId]);await step();state=await status(id);assert.equal(state.status,'succeeded');assert.deepEqual(state.events.map(event=>event.status),['queued','audio','analysis','render','succeeded']);assert.equal(await quota(),0);await step();assert.equal((await status(id)).version,5);
      await assert.rejects(service.pool.query('UPDATE pipeline_events SET status=status WHERE pipeline_id=$1',[id]),error=>error.code==='23514');await assert.rejects(service.pipelines.status(request(bob),id),error=>error.getStatus()===403);
    });
    await t.test('loss after persisting a stage event and replay after a remote commit reconcile consumption once',async()=>{
      const {id}=await create();await step();await audioDone(id);await stop();await assert.rejects(execute(process.execPath,['tests/helpers/pipeline-crash.mjs','usage-outbox'],{env:process.env,timeout:20000}),error=>error.signal==='SIGKILL');start();assert.equal((await status(id)).status,'analysis');
      const event=(await service.pool.query("SELECT * FROM pipeline_usage_outbox WHERE pipeline_id=$1 AND stage='audio'",[id])).rows[0];assert.ok(event);assert.equal(event.delivered_at,null);await service.usage.dispatch();await service.pool.query('UPDATE pipeline_usage_outbox SET delivered_at=NULL WHERE id=$1',[event.id]);await service.usage.dispatch();await service.usage.dispatch();
      const ledger=await alice.c.request(`/consumption/workspaces/${workspaceId}/ledger`);assert.equal(ledger.status,200);const consumed=ledger.value.items.filter(row=>row.pipelineId===id&&row.stage==='audio'&&row.kind==='consume');assert.equal(consumed.length,1);assert.equal(consumed[0].seconds,8);
      await assert.rejects(service.pool.query("UPDATE pipeline_usage_outbox SET payload=jsonb_set(payload,'{actualDurationSeconds}','0') WHERE id=$1",[event.id]),error=>error.code==='23514');await service.pipelines.cancel(request(alice),id);await step();await cancelledChildren(id);await step();assert.equal((await status(id)).status,'cancelled');assert.equal(await quota(),0);
    });
    await t.test('queued cancellation and a four-intent workspace limit release unallocated reservations once',async()=>{
      const made=[];for(let i=0;i<4;i++)made.push(await create());assert.equal(await quota(),4*reservation);await assert.rejects(create(),error=>error.getStatus()===409);assert.equal(await quota(),4*reservation);
      for(const row of made)await service.pipelines.cancel(request(alice),row.id);await step();for(const row of made){const state=await status(row.id);assert.equal(state.status,'cancelled');assert.equal(state.audioProcessingId,null);}assert.equal(await quota(),0);await step();assert.equal(await quota(),0);
    });
    await t.test('cancellation after audio, during analysis and before render creation prevents the next stage and waits for settlement',async()=>{
      for(const phase of ['audio','analysis','analysis-finished','render']){
        const {id}=await create();await step();if(phase!=='audio'){await audioDone(id);await step();if(['analysis-finished','render'].includes(phase))await analysisDone(id);if(phase==='render')await step();}
        await service.pipelines.cancel(request(alice),id);await step();let state=await status(id);if(phase==='render')assert.ok(state.renderProcessingId);else assert.equal(state.renderProcessingId,null);if(phase!=='analysis-finished')assert.equal(state.status,'stopping');await cancelledChildren(id);await step();state=await status(id);assert.equal(state.status,'cancelled');assert.equal(state.reservedBytes,0);assert.equal(await quota(),0);
      }
    });
    await t.test('removing the delegated creator role stops an admitted stage before any further stage',async()=>{
      // Explicit membership fixture; revocation and subsequent authorization use
      // the real Workspace HTTP service. Project never receives this DB role.
      const workspacePool=new pg.Pool({connectionString:process.env.WORKSPACE_DATABASE_URL,connectionTimeoutMillis:3000});try{await workspacePool.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'editor')",[workspaceId,bob.id]);}finally{await workspacePool.end();}
      const created=await service.pipelines.begin(request(bob),uploadId,spec,randomUUID());await step();assert.equal((await status(created.id)).status,'audio');assert.equal((await alice.c.request(`/workspaces/${workspaceId}/members/${bob.id}`,'DELETE')).status,200);
      await step();assert.equal((await status(created.id)).status,'stopping');assert.equal((await status(created.id)).analysisId,null);await cancelledChildren(created.id);await step();const state=await status(created.id);assert.equal(state.status,'failed');assert.equal(state.errorCode,'PIPELINE_AUTHORIZATION_REVOKED');assert.equal(await quota(),0);
    });
    await t.test('deadline, source trash and invalid caption density fail without starting another stage',async()=>{
      let {id}=await create();await service.pool.query("UPDATE pipelines SET deadline_at=now()-interval '1 second' WHERE id=$1",[id]);await step();assert.equal((await status(id)).errorCode,'PIPELINE_DEADLINE_EXCEEDED');assert.equal(await quota(),0);
      ({id}=await create());await step();await audioDone(id);await step();await analysisDone(id,[{startSeconds:5,endSeconds:6,text:'No cues in requested excerpt'}]);await step();await step();assert.equal((await status(id)).status,'failed');assert.equal((await status(id)).errorCode,'PIPELINE_INVALID_CAPTIONS');assert.equal((await status(id)).renderProcessingId,null);assert.equal(await quota(),0);
      ({id}=await create());await service.pool.query('UPDATE projects SET deleted_at=now() WHERE id=$1',[projectId]);await step();const row=(await service.pool.query('SELECT * FROM pipelines WHERE id=$1',[id])).rows[0];assert.equal(row.status,'failed');assert.equal(row.error_code,'PIPELINE_AUTHORIZATION_REVOKED');assert.equal(await quota(),0);await assert.rejects(status(id),error=>error.getStatus()===404);
    });
  }finally{await stop();await new Promise(resolve=>server.close(resolve));}
});
