import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {eventually} from '@autoclipper/testing';
import {verifiedAccountFixture} from '../helpers/verified-account-fixture.mjs';
const execute=promisify(execFile);
test('development usage scope: manual audio/render remain outside the ledger and legacy metadata preserves existing downloads without retroactive consumption',{timeout:90000},async()=>{
  const alice=await verifiedAccountFixture(),bob=await verifiedAccountFixture(),headers=()=>({'idempotency-key':randomUUID()});
  const pool=new pg.Pool({connectionString:process.env.PROJECT_DATABASE_URL,connectionTimeoutMillis:3000}),root=process.env.TEST_TEMP_DIR??'.local';await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'usage-scope-'));
  try{
    const workspace=await alice.c.request('/workspaces','POST',{kind:'personal',name:'Explicit manual and legacy usage scope'},headers());assert.equal(workspace.status,201);const project=await alice.c.request('/projects','POST',{workspaceId:workspace.value.id,name:'Actual media and explicit legacy metadata fixture'},headers());assert.equal(project.status,201);
    const path=join(directory,'source.mp4');await execute(process.env.FFMPEG_PATH??'ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=320x240:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',path],{timeout:15000,windowsHide:true});const bytes=await readFile(path);
    const upload=await alice.c.request(`/projects/${project.value.id}/uploads`,'POST',{mode:'put',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'video/mp4'},headers());assert.equal(upload.status,201);assert.ok((await fetch(upload.value.url,{method:'PUT',headers:upload.value.headers,body:bytes})).ok);assert.equal((await alice.c.request(`/uploads/${upload.value.id}/confirm`,'POST')).status,200);await eventually(async()=>(await alice.c.request(`/uploads/${upload.value.id}`)).value.inspection?.status==='succeeded',20000);
    const audio=await alice.c.request(`/uploads/${upload.value.id}/processing`,'POST',{version:1,kind:'audio'},headers()),clip=await alice.c.request(`/uploads/${upload.value.id}/processing`,'POST',{version:1,kind:'clip',startSeconds:0,endSeconds:1,aspect:'square'},headers());assert.equal(audio.status,201);assert.equal(clip.status,201);
    for(const id of [audio.value.id,clip.value.id]){let state;await eventually(async()=>{state=(await alice.c.request(`/processing/${id}`)).value;return['succeeded','failed','cancelled'].includes(state.status);},30000);assert.equal(state.status,'succeeded');}
    const usagePath=`/consumption/workspaces/${workspace.value.id}`,usage=await alice.c.request(usagePath);assert.equal(usage.status,200);assert.equal(usage.value.plan,null);assert.equal(usage.value.consumedSeconds,0);assert.equal(usage.value.reservedSeconds,0);assert.deepEqual((await alice.c.request(usagePath+'/ledger')).value.items,[]);
    const original=await alice.c.request(`/processing/${clip.value.id}/download?kind=video`);assert.equal(original.status,200);const checksum=createHash('sha256').update(Buffer.from(await(await fetch(original.value.url)).arrayBuffer())).digest('hex');
    // Explicit historical metadata fixture, attached to already completed real
    // artifacts. It does not claim an earlier ASR run or backfill consumption.
    const legacyId=randomUUID(),spec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'},startSeconds:0,endSeconds:1,aspect:'square'};
    await pool.query("INSERT INTO pipelines(id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,spec,correlation_id,status,version,remaining_reservation_bytes,finished_at,usage_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'succeeded',5,0,now(),'legacy')",[legacyId,upload.value.id,project.value.id,workspace.value.id,alice.id,randomUUID(),'a'.repeat(64),spec,randomUUID()]);await pool.query('UPDATE processing_requests SET pipeline_id=$1 WHERE id=ANY($2::uuid[])',[legacyId,[audio.value.id,clip.value.id]]);
    const legacy=await alice.c.request(`/pipelines/${legacyId}`);assert.equal(legacy.status,200);assert.equal(legacy.value.usageState,'legacy');assert.equal(legacy.value.renderProcessingId,clip.value.id);assert.equal((await bob.c.request(`/pipelines/${legacyId}`)).status,403);
    const signed=await alice.c.request(`/pipelines/${legacyId}/download?kind=video`);assert.equal(signed.status,200);const received=Buffer.from(await(await fetch(signed.value.url)).arrayBuffer());assert.equal(createHash('sha256').update(received).digest('hex'),checksum);assert.equal((await alice.c.request(usagePath)).value.consumedSeconds,0);assert.equal(Number((await pool.query('SELECT count(*) FROM pipeline_usage_outbox WHERE pipeline_id=$1',[legacyId])).rows[0].count),0);assert.equal((await alice.c.request(`/projects/${project.value.id}`,'DELETE')).status,200);
  }finally{await pool.end();await rm(directory,{recursive:true,force:true});}
});
