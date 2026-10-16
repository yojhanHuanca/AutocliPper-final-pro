// Opt-in acceptance against the existing LOCAL stack. Does not start/stop services.
// Own example.test accounts, Mailpit only, synthetic speech fixture; actual storage/FFmpeg/whisper.cpp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const base = 'http://localhost:3000/v1';
const password = 'AutoClipper-frontend-QA-only-2026!'; // Public, synthetic local test credential; never use with a real account.
const execute = promisify(execFile);
const pause = () => new Promise(resolve => setTimeout(resolve, 1500));
function client() {
  const jar = new Map(); let csrf = '';
  return { async request(route, method = 'GET', body, extra = {}) {
    const response = await fetch(base + route, { method, headers: { origin: 'http://localhost:4200', 'content-type': 'application/json', cookie: [...jar].map(([k,v])=>`${k}=${v}`).join('; '), ...(csrf ? {'X-CSRF-Token':csrf}:{}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    for (const raw of response.headers.getSetCookie()) { const pair = raw.split(';')[0], index=pair.indexOf('='); jar.set(pair.slice(0,index),pair.slice(index+1)); }
    const value = await response.json(); if (route === '/auth/csrf' && response.ok) csrf=value.csrfToken;
    return { status: response.status, value, headers: response.headers };
  } };
}
async function wait(route, c, timeout = 120000) {
  const deadline=Date.now()+timeout; let last;
  while(Date.now()<deadline) { last=await c.request(route); assert.equal(last.status,200,JSON.stringify(last.value)); if(['succeeded','failed','cancelled'].includes(last.value.status ?? last.value.inspection?.status)) return last.value; await pause(); }
  throw new Error(`Timed out waiting for ${route}: ${last?.value?.status ?? last?.value?.inspection?.status}`);
}
async function account() {
  const c=client(),email=`frontend-qa-${randomUUID()}@example.test`;
  assert.equal((await c.request('/auth/csrf')).status,200);
  assert.equal((await c.request('/auth/register','POST',{email,password,name:'Frontend QA · cuenta de prueba'})).status,202);
  let token; const deadline=Date.now()+30000;
  while(Date.now()<deadline&&!token) {
    const list=await(await fetch('http://localhost:19025/api/v1/messages')).json();
    for(const item of list.messages??[]) if(item.To?.some(to=>to.Address===email)) { const message=await(await fetch(`http://localhost:19025/api/v1/message/${item.ID}`)).json(); const match=message.Text?.match(/https?:\/\/\S+/);if(match)token=new URL(match[0]).searchParams.get('token'); }
    if(!token)await pause();
  }
  assert.ok(token,'Own verification email was not received in local Mailpit.');
  assert.equal((await c.request('/auth/verify','POST',{token})).status,200);
  const login=await c.request('/auth/login','POST',{email,password});assert.equal(login.status,200);
  return { c,email,id:login.value.user.id };
}

test('frontend contract acceptance on the existing local stack',{timeout:240000},async t=>{
  assert.equal(process.env.FRONTEND_LIVE_ACCEPTANCE,'true','Set FRONTEND_LIVE_ACCEPTANCE=true to explicitly run real local acceptance.');
  assert.equal((await fetch(base+'/health/ready')).status,200);
  const owner=await account();const ids={email:owner.email};let spec,revision,pipeline;
  await mkdir('.local/acceptance',{recursive:true});
  await t.test('authenticated workspace and project creation/listing',async()=>{
    const workspace=await owner.c.request('/workspaces','POST',{name:'Frontend QA · espacio de prueba',kind:'personal'},{'Idempotency-Key':randomUUID()});assert.equal(workspace.status,201);ids.workspaceId=workspace.value.id;
    const created=await owner.c.request('/projects','POST',{workspaceId:ids.workspaceId,name:'Prueba frontend · voz sintética'},{'Idempotency-Key':randomUUID()});assert.equal(created.status,201);ids.projectId=created.value.id;
    const list=await owner.c.request(`/projects?workspaceId=${ids.workspaceId}`);assert.equal(list.status,200);assert.ok(list.value.items.some(p=>p.id===ids.projectId));
  });
  await t.test('real signed upload, checksum and inspection',async()=>{
    const source=path.resolve('.local/acceptance/source.mp4');
    await execute('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=0x34352f:s=320x240:r=24','-i',path.resolve('../autoclipper-backend-microservices/tests/fixtures/speech-es.wav'),'-shortest','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',source],{windowsHide:true,timeout:30000});
    const bytes=await readFile(source);const intent=await owner.c.request(`/projects/${ids.projectId}/uploads`,'POST',{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'video/mp4',mode:'put'},{'Idempotency-Key':randomUUID()});assert.equal(intent.status,201);ids.uploadId=intent.value.id;
    assert.equal((await fetch(intent.value.url,{method:'PUT',headers:intent.value.headers,body:bytes,credentials:'omit'})).ok,true);
    assert.equal((await owner.c.request(`/uploads/${ids.uploadId}/confirm`,'POST',{})).status,200);
    const inspected=await wait(`/uploads/${ids.uploadId}`,owner.c,40000);assert.equal(inspected.inspection.status,'succeeded');assert.ok(inspected.inspection.result.durationSeconds>8);
  });
  await t.test('one pipeline executes real local whisper.cpp and MP4/SRT/VTT exports',async()=>{
    const providers=await owner.c.request('/analyses/providers');assert.equal(providers.value.transcription.whisper_cpp.configured,true);
    const body={version:1,provider:'whisper_cpp',language:'es',selection:{mode:'none'},startSeconds:0,endSeconds:8,aspect:'square'};const key=randomUUID();
    const created=await owner.c.request(`/uploads/${ids.uploadId}/pipelines`,'POST',body,{'Idempotency-Key':key});assert.equal(created.status,201,JSON.stringify(created.value));ids.pipelineId=created.value.id;
    assert.equal((await owner.c.request(`/uploads/${ids.uploadId}/pipelines`,'POST',body,{'Idempotency-Key':key})).value.id,ids.pipelineId);
    pipeline=await wait(`/pipelines/${ids.pipelineId}`,owner.c);assert.equal(pipeline.status,'succeeded');assert.equal(pipeline.usageState,'accepted');
    const analysis=await owner.c.request(`/analyses/${pipeline.analysisId}`);assert.equal(analysis.value.transcript.provider,'whisper_cpp');assert.match(analysis.value.transcript.segments.map(s=>s.text).join(' '),/proyecto/i);
    for(const kind of ['video','srt','vtt']) {const signed=await owner.c.request(`/pipelines/${ids.pipelineId}/download?kind=${kind}`);assert.equal(signed.status,200);const bytes=Buffer.from(await(await fetch(signed.value.url,{credentials:'omit'})).arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),signed.value.sha256);}
  });
  await t.test('versioned edits reject stale writes and preserve history',async()=>{
    spec={version:1,kind:'clip',startSeconds:0,endSeconds:8,aspect:'square',subtitles:{source:'transcript',analysisId:pipeline.analysisId,style:{template:'clean',position:'bottom',fontSize:24}}};
    const created=await owner.c.request(`/uploads/${ids.uploadId}/edits`,'POST',{name:'Clip QA · transcripción local real',spec},{'Idempotency-Key':randomUUID()});assert.equal(created.status,201);ids.editId=created.value.id;
    const get=await owner.c.request(`/edits/${ids.editId}`);assert.ok(get.headers.get('etag'));
    const updated=await owner.c.request(`/edits/${ids.editId}`,'PATCH',{version:1,spec:{...spec,aspect:'vertical'}},{'If-Match':get.headers.get('etag')});assert.equal(updated.status,200);revision=updated.value;
    assert.equal((await owner.c.request(`/edits/${ids.editId}`,'PATCH',{version:1,spec})).status,412);
    const restored=await owner.c.request(`/edits/${ids.editId}/restore`,'POST',{version:2,revisionVersion:1});assert.equal(restored.status,201);revision=restored.value;
    const history=await owner.c.request(`/edits/${ids.editId}/revisions`);assert.equal(history.value.items.length,3);
  });
  await t.test('render saved revision, comment, request review and approve',async()=>{
    const render=await owner.c.request(`/edits/${ids.editId}/renders`,'POST',{revisionVersion:revision.version},{'Idempotency-Key':randomUUID()});assert.equal(render.status,201);ids.renderId=render.value.id;assert.equal((await wait(`/processing/${ids.renderId}`,owner.c)).status,'succeeded');
    assert.equal((await owner.c.request(`/edits/${ids.editId}/comments`,'POST',{revisionVersion:revision.version,timeSeconds:2,text:'Comentario de aceptación frontend · fixture explícito'},{'Idempotency-Key':randomUUID()})).status,201);
    const review=await owner.c.request(`/edits/${ids.editId}/review`);const requested=await owner.c.request(`/edits/${ids.editId}/review`,'POST',{version:revision.version,reviewVersion:review.value.reviewVersion});assert.equal(requested.status,201);
    const approved=await owner.c.request(`/edits/${ids.editId}/approvals`,'POST',{version:revision.version,reviewVersion:requested.value.reviewVersion});assert.equal(approved.status,201);assert.equal(approved.value.status,'approved');
  });
  await t.test('real consumption is reconciled and another account is denied',async()=>{
    const usage=await owner.c.request(`/consumption/workspaces/${ids.workspaceId}`);assert.equal(usage.status,200);assert.ok(usage.value.consumedSeconds>0);assert.equal(usage.value.reservedSeconds,0);
    const ledger=await owner.c.request(`/consumption/workspaces/${ids.workspaceId}/ledger`);assert.equal(ledger.value.items.filter(e=>e.pipelineId===ids.pipelineId).length,9);
    const other=await account();assert.equal((await other.c.request(`/edits/${ids.editId}`)).status,403);assert.equal((await other.c.request(`/pipelines/${ids.pipelineId}/download?kind=video`)).status,403);assert.equal((await other.c.request(`/consumption/workspaces/${ids.workspaceId}`)).status,403);
    await other.c.request('/auth/logout','POST',{});
  });
  await writeFile('.local/acceptance/result.json',JSON.stringify({at:new Date().toISOString(),...ids,syntheticSource:true,realWhisperCpp:true},null,2));
  console.log('Local acceptance IDs saved to ignored .local/acceptance/result.json; no session tokens or signed URLs stored.');
  await owner.c.request('/auth/logout','POST',{});
});
