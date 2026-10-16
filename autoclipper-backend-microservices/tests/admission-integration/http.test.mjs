import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {configureHttp} from '@autoclipper/observability';
import {eventually} from '@autoclipper/testing';
import {ProjectService} from '../../apps/autoclipper-project-service/dist/application/project.service.js';
import {ProjectController} from '../../apps/autoclipper-project-service/dist/interfaces/project.controller.js';
import {DerivativesController} from '../../apps/autoclipper-project-service/dist/interfaces/derivatives.controller.js';
import {AnalysisController} from '../../apps/autoclipper-project-service/dist/interfaces/analysis.controller.js';
import {EditorController} from '../../apps/autoclipper-project-service/dist/interfaces/editor.controller.js';
import {PipelineController} from '../../apps/autoclipper-project-service/dist/interfaces/pipeline.controller.js';
import {verifiedAccountFixture} from '../helpers/verified-account-fixture.mjs';
import {client} from '../helpers/accounts.mjs';
const execute=promisify(execFile),key=()=>({'idempotency-key':randomUUID()}),sha=bytes=>createHash('sha256').update(bytes).digest('hex');

// Real Nest HTTP, session/CSRF, roles, PostgreSQL, S3 and FFmpeg workers.
// Only the Project dispatch timer is driven explicitly, to test cancellation
// across a mode restart deterministically. Completed transcript/proposal rows
// below are explicit fixtures, never represented as ASR or LLM execution.
test('server admission mode closes every manual creation route and preserves historical access',{timeout:240000},async t=>{
  assert.equal(process.env.ADMISSION_INTEGRATION_ISOLATED,'true');
  await assert.rejects(fetch('http://project:3004/v1/health/live',{signal:AbortSignal.timeout(2000)}),'Stop the application Project dispatcher first');
  const accounts=await Promise.all([verifiedAccountFixture(),verifiedAccountFixture(),verifiedAccountFixture()]);
  const [owner,editor]=accounts;
  const workspace=await owner.c.request('/workspaces','POST',{kind:'team',name:'HTTP commercial admission fixture'},key());assert.equal(workspace.status,201);
  const workspaceId=workspace.value.id,wp=new pg.Pool({connectionString:process.env.WORKSPACE_DATABASE_URL});
  try{await wp.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'editor')",[workspaceId,editor.id]);}finally{await wp.end();}
  const root=process.env.TEST_TEMP_DIR??'/tmp/fixtures';await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'admission-'));
  let app,service,users,projectId,uploadId,audioId,analysisId,clipId,pendingAudio,pendingAnalysis,legacyId;
  const variants=[],edits=[];
  const start=async mode=>{
    process.env.PROCESSING_ADMISSION_MODE=mode;service=new ProjectService();assert.equal(service.config.PROCESSING_ADMISSION_MODE,mode);
    service.onModuleInit=async()=>assert.equal(process.env.ADMISSION_INTEGRATION_ISOLATED,'true');
    class TestModule{} Module({providers:[{provide:ProjectService,useValue:service}],controllers:[ProjectController,DerivativesController,AnalysisController,EditorController,PipelineController]})(TestModule);
    app=await NestFactory.create(TestModule,{logger:false});configureHttp(app,service.config,'admission-verifier');await app.listen(0,'127.0.0.1');
    const base=await app.getUrl();users=accounts.map(account=>{const c=client(base,{'x-csrf-token':account.c.jar.get('autoclipper_csrf')});for(const [name,value]of account.c.jar)c.jar.set(name,value);return c;});
  };
  const stop=async()=>{if(app){await app.close();app=undefined;service=undefined;}};
  const step=()=>service.dispatch();
  const complete=async(id,expected='succeeded',kind='processing')=>{let value;await eventually(async()=>{await step();const response=await users[0].request(`/${kind}/${id}`);assert.equal(response.status,200);value=response.value;return['succeeded','failed','cancelled'].includes(value.status)&&!value.cleanupPending;},60000);assert.equal(value.status,expected,JSON.stringify(value));return value;};
  const snapshot=async()=>({processing:(await service.pool.query('SELECT count(*) FROM processing_requests WHERE workspace_id=$1',[workspaceId])).rows[0].count,analysis:(await service.pool.query('SELECT count(*) FROM analysis_requests WHERE workspace_id=$1',[workspaceId])).rows[0].count,storage:(await service.pool.query('SELECT used_bytes,reserved_bytes FROM workspace_storage WHERE workspace_id=$1',[workspaceId])).rows[0]});
  try{
    await start('development');
    const project=await users[0].request('/projects','POST',{workspaceId,name:'Admission matrix'},key());assert.equal(project.status,201);projectId=project.value.id;
    const source=join(directory,'source.mp4'),realAsr=process.env.ADMISSION_REAL_ASR==='true';
    await execute(process.env.FFMPEG_PATH??'ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=30',...(realAsr?['-i','tests/fixtures/speech-es.wav']:['-f','lavfi','-i','sine=frequency=440:sample_rate=48000']),'-t',realAsr?'13.8':'2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',source],{timeout:20000,windowsHide:true});const bytes=await readFile(source);
    const upload=await users[0].request(`/projects/${projectId}/uploads`,'POST',{mode:'put',bytes:bytes.length,sha256:sha(bytes),contentType:'video/mp4'},key());assert.equal(upload.status,201);uploadId=upload.value.id;assert.ok((await fetch(upload.value.url,{method:'PUT',headers:upload.value.headers,body:bytes})).ok);assert.equal((await users[0].request(`/uploads/${uploadId}/confirm`,'POST')).status,200);await eventually(async()=>{await step();return(await users[0].request(`/uploads/${uploadId}`)).value.inspection?.status==='succeeded';},25000);
    await t.test('development permits actual audio and all direct clip variants',async()=>{
      const audio=await users[0].request(`/uploads/${uploadId}/processing`,'POST',{version:1,kind:'audio'},key());assert.equal(audio.status,201);audioId=audio.value.id;await complete(audioId);variants.push({name:'audio',path:`/uploads/${uploadId}/processing`,body:{version:1,kind:'audio'}});
      for(const aspect of ['source','vertical','square','horizontal']){
        const body={version:1,kind:'clip',startSeconds:0,endSeconds:1,aspect,...(aspect==='square'?{framing:{x:0,y:1},subtitles:{provenance:'user',cues:[{startSeconds:0,endSeconds:1,text:'Explicit user caption'}],style:{template:'boxed',fontSize:24,position:'top'}}}:{})};const replayKey=key();const route={name:`direct ${aspect}`,path:`/uploads/${uploadId}/processing`,body,replayKey};variants.push(route);const response=await users[0].request(route.path,'POST',body,replayKey);assert.equal(response.status,201,JSON.stringify(response.value));clipId=response.value.id;await complete(clipId);
      }
    });
    const req={headers:{origin:'http://localhost:4200',cookie:[...owner.c.jar].map(([k,v])=>`${k}=${v}`).join(';'),'x-csrf-token':owner.c.jar.get('autoclipper_csrf')}};
    const audio=await service.derivatives.audioForAnalysis(req,audioId);analysisId=randomUUID();
    const fixture={id:analysisId,status:'succeeded',attempts:1,errorCode:null,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),transcript:{id:randomUUID(),language:'es',languageSource:'requested',durationSeconds:audio.source.durationSeconds,segments:[{startSeconds:0,endSeconds:1,text:'EXPLICIT TRANSCRIPT FIXTURE'}],provider:'whisper_cpp',model:'explicit-fixture',revision:'explicit-fixture',engineVersion:'explicit-fixture',modelSha256:null,requestId:null,estimatedExternalCostUsd:0,diarization:false},selection:{segments:[{startSeconds:0,endSeconds:1,title:'Explicit proposal fixture',description:'No inference',hashtags:[],explanation:'Fixture only'}],provider:'ollama',model:'explicit-fixture',revision:'a'.repeat(64),promptVersion:'segment-selection-v1',usage:{inputTokens:1,outputTokens:1},estimatedExternalCostUsd:0},providerOutcomeUnknown:false,phases:[]};
    const analysisSpec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'}};
    const insertAnalysis=async(id,cached)=>service.pool.query('INSERT INTO analysis_requests(id,audio_processing_id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,source,spec,correlation_id,cached_status,delivered_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)',[id,audioId,uploadId,projectId,workspaceId,owner.id,randomUUID(),'a'.repeat(64),audio.source,analysisSpec,randomUUID(),cached,cached?new Date():null]);
    await insertAnalysis(analysisId,fixture);
    await t.test('development reaches provider preflight and permits manual/proposal transcript renders',async()=>{
      for(const provider of ['whisper_cpp','deepgram'])for(const selection of [{mode:'none'},{mode:'llm',count:1,minSeconds:1,maxSeconds:2,instructions:''}]){
        const route={name:`analysis ${provider}/${selection.mode}`,path:`/processing/${audioId}/analyses`,body:{...analysisSpec,provider,selection}};variants.push(route);const response=await users[0].request(route.path,'POST',route.body,key());assert.ok([201,503].includes(response.status),JSON.stringify(response.value));assert.notEqual(response.value.code,'MANUAL_PROCESSING_NOT_ADMITTED');if(response.status===201){assert.equal((await users[0].request(`/analyses/${response.value.id}`,'DELETE')).status,200);await complete(response.value.id,'cancelled','analyses');}else assert.ok(['TRANSCRIPTION_NOT_CONFIGURED','SELECTION_NOT_CONFIGURED','PAID_AI_DISABLED'].includes(response.value.code),JSON.stringify(response.value));
      }
      for(const times of [{startSeconds:0,endSeconds:1},{proposalIndex:0}]){const route={name:'transcript '+JSON.stringify(times),path:`/analyses/${analysisId}/renders`,body:{version:1,...times,aspect:'square'}};variants.push(route);const response=await users[0].request(route.path,'POST',route.body,key());assert.equal(response.status,201,JSON.stringify(response.value));await complete(response.value.id);}
    });
    const base={version:1,kind:'clip',startSeconds:0,endSeconds:1,aspect:'square',subtitles:{source:'none'}};
    await t.test('development exports immutable editor variants including split and transcript snapshots',async()=>{
      for(const spec of [base,{...base,subtitles:{source:'user',cues:[{startSeconds:0,endSeconds:1,text:'Saved user fixture'}]}},{...base,subtitles:{source:'transcript',analysisId}},{...base,splitScreen:{secondaryUploadId:uploadId,layout:'side_by_side',primaryRatio:0.5,startSeconds:0,shortInput:'reject',audio:'secondary'}}]){
        const response=await users[0].request(`/uploads/${uploadId}/edits`,'POST',{name:'Explicit saved variant',spec},key());assert.equal(response.status,201,JSON.stringify(response.value));edits.push(response.value.id);const route={name:'editor '+spec.subtitles.source+(spec.splitScreen?'/split':''),path:`/edits/${response.value.id}/renders`,body:{revisionVersion:1}};variants.push(route);const rendered=await users[0].request(route.path,'POST',route.body,key());assert.equal(rendered.status,201,JSON.stringify(rendered.value));await complete(rendered.value.id);
      }
    });
    const original=await users[0].request(`/processing/${clipId}/download?kind=video`);assert.equal(original.status,200);const checksum=sha(Buffer.from(await(await fetch(original.value.url)).arrayBuffer()));
    // Historical metadata fixture references completed real media; it does not
    // claim that a historical pipeline performed ASR or received an entitlement.
    legacyId=randomUUID();const legacySpec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'},startSeconds:0,endSeconds:1,aspect:'horizontal'};
    await service.pool.query("INSERT INTO pipelines(id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,spec,correlation_id,status,version,remaining_reservation_bytes,finished_at,usage_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'succeeded',5,0,now(),'legacy')",[legacyId,uploadId,projectId,workspaceId,owner.id,randomUUID(),'a'.repeat(64),legacySpec,randomUUID()]);await service.pool.query('UPDATE processing_requests SET pipeline_id=$1 WHERE id=ANY($2::uuid[])',[legacyId,[audioId,clipId]]);
    // Pending historical intentions are created before the mode restart. No
    // timer can submit them until DELETE is tested in commercial mode.
    const pending=await users[0].request(`/uploads/${uploadId}/processing`,'POST',{version:1,kind:'audio'},key());assert.equal(pending.status,201);pendingAudio=pending.value.id;pendingAnalysis=randomUUID();await insertAnalysis(pendingAnalysis,null);
    await stop();await start('commercial');
    await t.test('owner and ordinary editor cannot bypass any manual route through headers or replay',async()=>{
      const before=await snapshot();for(const actor of [users[0],users[1]])for(const route of variants){const response=await actor.request(route.path,'POST',route.body,{...key(),'x-processing-admission-mode':'development','x-user-role':'owner','x-service-token':'untrusted-browser-value'});assert.equal(response.status,403,route.name+JSON.stringify(response.value));assert.equal(response.value.code,'MANUAL_PROCESSING_NOT_ADMITTED',route.name);}
      const replay=variants.find(route=>route.replayKey);assert.equal((await users[0].request(replay.path,'POST',replay.body,replay.replayKey)).value.code,'MANUAL_PROCESSING_NOT_ADMITTED');assert.deepEqual(await snapshot(),before,'Refusals must create no outbox, stage or storage reservation');
      for(const route of variants){assert.equal((await users[2].request(route.path,'POST',route.body,key())).status,403,route.name);}
    });
    await t.test('commercial mode preserves reads, immutable history, real downloads and metadata editing without retrocharge',async()=>{
      for(const path of [`/processing/${audioId}`,`/analyses/${analysisId}`,`/projects/${projectId}/processing`,...edits.flatMap(id=>[`/edits/${id}`,`/edits/${id}/revisions`,`/edits/${id}/revisions/1`,`/edits/${id}/exports`])])assert.equal((await users[1].request(path)).status,200,path);
      const signed=await users[1].request(`/processing/${clipId}/download?kind=video`);assert.equal(signed.status,200);assert.equal(sha(Buffer.from(await(await fetch(signed.value.url)).arrayBuffer())),checksum);assert.equal((await users[2].request(`/processing/${clipId}/download?kind=video`)).status,403);
      const legacy=await users[1].request(`/pipelines/${legacyId}`);assert.equal(legacy.status,200);assert.equal(legacy.value.usageState,'legacy');const legacyDownload=await users[1].request(`/pipelines/${legacyId}/download?kind=video`);assert.equal(legacyDownload.status,200);assert.equal(sha(Buffer.from(await(await fetch(legacyDownload.value.url)).arrayBuffer())),checksum);assert.equal((await users[2].request(`/pipelines/${legacyId}`)).status,403);
      const created=await users[1].request(`/uploads/${uploadId}/edits`,'POST',{name:'Commercial metadata only',spec:{...base,subtitles:{source:'transcript',analysisId}}},key());assert.equal(created.status,201);assert.equal((await users[1].request(`/edits/${edits[0]}`,'PATCH',{version:1,spec:base})).status,200);assert.equal((await users[1].request(`/edits/${edits[0]}/restore`,'POST',{version:2,revisionVersion:1})).status,201);
      for(const revisionVersion of [1,3])assert.equal((await users[0].request(`/edits/${edits[0]}/renders`,'POST',{revisionVersion},key())).value.code,'MANUAL_PROCESSING_NOT_ADMITTED');
      const usage=await owner.c.request(`/consumption/workspaces/${workspaceId}`);assert.equal(usage.value.plan,null);assert.equal(usage.value.consumedSeconds,0);assert.equal(usage.value.reservedSeconds,0);assert.deepEqual((await owner.c.request(`/consumption/workspaces/${workspaceId}/ledger`)).value.items,[]);
    });
    await t.test('commercial mode cancels preexisting pending audio and analysis through actual workers',async()=>{
      assert.equal((await users[0].request(`/processing/${pendingAudio}`)).value.status,'queued');assert.equal((await users[1].request(`/processing/${pendingAudio}`,'DELETE')).status,200);assert.equal((await users[1].request(`/analyses/${pendingAnalysis}`,'DELETE')).status,200);await complete(pendingAudio,'cancelled');await complete(pendingAnalysis,'cancelled','analyses');assert.equal((await snapshot()).storage.reserved_bytes,'0');
    });
    await t.test('commercial pipeline creation reaches provider admission and the real local opt-in uses the ledger',async()=>{
      const providers=await users[0].request('/analyses/providers');assert.equal(providers.status,200);const spec={version:1,provider:'whisper_cpp',language:'es',selection:{mode:'none'},startSeconds:0,endSeconds:realAsr?8:1,aspect:'square'};const response=await users[0].request(`/uploads/${uploadId}/pipelines`,'POST',spec,key());
      if(realAsr){assert.equal(providers.value.transcription.whisper_cpp.configured,true);assert.equal(response.status,201,JSON.stringify(response.value));const state=await complete(response.value.id,'succeeded','pipelines');assert.equal(state.usageState,'accepted');for(const kind of ['video','srt','vtt'])assert.equal((await users[0].request(`/pipelines/${state.id}/download?kind=${kind}`)).status,200);const analysis=await users[0].request(`/analyses/${state.analysisId}`);assert.equal(analysis.value.transcript.modelSha256,'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21');const usage=await owner.c.request(`/consumption/workspaces/${workspaceId}`);assert.ok(usage.value.consumedSeconds>0);assert.equal(usage.value.reservedSeconds,0);const ledger=(await owner.c.request(`/consumption/workspaces/${workspaceId}/ledger`)).value.items;assert.equal(ledger.filter(row=>row.pipelineId===state.id).length,9);assert.equal((await users[2].request(`/pipelines/${state.id}`)).status,403);
      }else{assert.equal(providers.value.transcription.whisper_cpp.configured,false,'Use ADMISSION_REAL_ASR=true with the local ASR stack');assert.equal(response.status,503);assert.equal(response.value.code,'TRANSCRIPTION_NOT_CONFIGURED');}
    });
  }finally{await stop();await rm(directory,{recursive:true,force:true});}
});
