import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {eventually} from '@autoclipper/testing';
import {account} from '../helpers/accounts.mjs';
const execute=promisify(execFile);
test('REAL local ASR: account → upload → audio → whisper.cpp → manual excerpt → subtitled clip → authorized downloads',{timeout:240000},async t=>{
  assert.equal(process.env.LOCAL_AI_ACCEPTANCE,'true','This resource-consuming test requires explicit local opt-in');
  const alice=await account(),bob=await account();
  const providers=await alice.c.request('/analyses/providers');assert.equal(providers.status,200);assert.equal(providers.value.transcription.whisper_cpp.configured,true);assert.equal(providers.value.paidExecutionEnabled,false);
  const workspace=await alice.c.request('/workspaces','POST',{kind:'personal',name:'Real ASR acceptance'},{'idempotency-key':randomUUID()});assert.equal(workspace.status,201);
  const project=await alice.c.request('/projects','POST',{workspaceId:workspace.value.id,name:'Synthetic Spanish speech with real inference'},{'idempotency-key':randomUUID()});assert.equal(project.status,201);
  const root=process.env.TEST_TEMP_DIR??'.local';await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'real-asr-'));
  const ffmpeg=process.env.FFMPEG_PATH??'ffmpeg';let uploadId,audioId,analysisId,transcript,clipId;
  async function wait(path,timeout=90000){let value;await eventually(async()=>{const response=await alice.c.request(path);value=response.value;return response.status===200&&['succeeded','failed','cancelled'].includes(value.status);},timeout);assert.equal(value.status,'succeeded',JSON.stringify(value));return value;}
  try{
    await t.test('upload and inspect an explicitly synthetic speech video',async()=>{
      const source=join(directory,'source.mp4');await execute(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=30','-i',fileURLToPath(new URL('../fixtures/speech-es.wav',import.meta.url)),'-shortest','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',source],{timeout:30000,windowsHide:true});const bytes=await readFile(source);
      const intent=await alice.c.request(`/projects/${project.value.id}/uploads`,'POST',{mode:'put',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'video/mp4'},{'idempotency-key':randomUUID()});assert.equal(intent.status,201);uploadId=intent.value.id;assert.ok((await fetch(intent.value.url,{method:'PUT',headers:intent.value.headers,body:bytes})).ok);assert.equal((await alice.c.request(`/uploads/${uploadId}/confirm`,'POST')).status,200);await eventually(async()=>(await alice.c.request(`/uploads/${uploadId}`)).value.inspection?.status==='succeeded',30000);
      const audio=await alice.c.request(`/uploads/${uploadId}/processing`,'POST',{version:1,kind:'audio'},{'idempotency-key':randomUUID()});assert.equal(audio.status,201);audioId=audio.value.id;assert.equal((await wait(`/processing/${audioId}`)).sampleRate,16000);
    });
    await t.test('idempotent real whisper.cpp transcription persists language timestamps and model provenance',async()=>{
      const spec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'}},key=randomUUID();
      const created=await alice.c.request(`/processing/${audioId}/analyses`,'POST',spec,{'idempotency-key':key});assert.equal(created.status,201);analysisId=created.value.id;
      assert.equal((await alice.c.request(`/processing/${audioId}/analyses`,'POST',spec,{'idempotency-key':key})).value.id,analysisId);
      const result=await wait(`/analyses/${analysisId}`,120000);transcript=result.transcript;assert.equal(result.selection,null);assert.equal(result.providerOutcomeUnknown,false);assert.equal(transcript.provider,'whisper_cpp');assert.equal(transcript.language,'es');assert.equal(transcript.languageSource,'detected');assert.equal(transcript.modelSha256,'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21');assert.equal(transcript.diarization,false);assert.equal(transcript.estimatedExternalCostUsd,0);assert.match(transcript.segments.map(s=>s.text).join(' ').toLowerCase(),/proyecto.*convierte/u);assert.ok(result.phases.every(phase=>phase.startedAt&&phase.finishedAt));assert.equal((await alice.c.request(`/analyses/${analysisId}`)).value.transcript.id,transcript.id);
      const unavailable=await alice.c.request(`/processing/${audioId}/analyses`,'POST',{...spec,selection:{mode:'llm',count:1,minSeconds:2,maxSeconds:5}},{'idempotency-key':randomUUID()});assert.equal(unavailable.status,503);assert.equal(unavailable.value.code,'SELECTION_NOT_CONFIGURED');
    });
    await t.test('render uses the saved transcript and downloads actual MP4 SRT and VTT',async()=>{
      const endSeconds=Math.min(8,transcript.durationSeconds),spec={version:1,startSeconds:0,endSeconds,aspect:'square'},key=randomUUID();
      const result=await alice.c.request(`/analyses/${analysisId}/renders`,'POST',spec,{'idempotency-key':key});assert.equal(result.status,201);clipId=result.value.id;assert.equal((await alice.c.request(`/analyses/${analysisId}/renders`,'POST',spec,{'idempotency-key':key})).value.id,clipId);
      const rendered=await wait(`/processing/${clipId}`);assert.equal(rendered.spec.subtitles.provenance,'transcript');assert.equal(rendered.spec.subtitles.transcriptId,transcript.id);assert.equal(rendered.width,720);assert.equal(rendered.height,720);
      for(const kind of ['video','srt','vtt']){const signed=await alice.c.request(`/processing/${clipId}/download?kind=${kind}`);assert.equal(signed.status,200);const response=await fetch(signed.value.url);assert.ok(response.ok);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),signed.value.sha256);if(kind==='video')await writeFile(join(directory,'clip.mp4'),bytes);else assert.ok(bytes.toString().includes(transcript.segments[0].text));}
      const frame=await execute(ffmpeg,['-v','error','-ss','1','-i',join(directory,'clip.mp4'),'-vf','crop=720:150:0:570','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:1048576,timeout:15000,windowsHide:true});let bright=0;for(let i=0;i<frame.stdout.length;i+=3)if(frame.stdout[i]>180&&frame.stdout[i+1]>180&&frame.stdout[i+2]>180)bright++;assert.ok(bright>20);
      assert.equal((await alice.c.request(`/analyses/${analysisId}/renders`,'POST',{version:1,proposalIndex:0,aspect:'square'},{'idempotency-key':randomUUID()})).status,400);
    });
    await t.test('another user is denied transcript, rendering, cancellation and downloads',async()=>{
      assert.equal((await bob.c.request(`/analyses/${analysisId}`)).status,403);assert.equal((await bob.c.request(`/analyses/${analysisId}`,'DELETE')).status,403);assert.equal((await bob.c.request(`/analyses/${analysisId}/renders`,'POST',{version:1,startSeconds:0,endSeconds:3,aspect:'square'},{'idempotency-key':randomUUID()})).status,403);assert.equal((await bob.c.request(`/processing/${clipId}/download?kind=video`)).status,403);
      assert.equal((await alice.c.request(`/projects/${project.value.id}`,'DELETE')).status,200);assert.equal((await alice.c.request(`/analyses/${analysisId}`)).status,404);assert.equal((await alice.c.request(`/processing/${clipId}/download?kind=video`)).status,404);
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});
