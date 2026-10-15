import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {eventually} from '@autoclipper/testing';
import {verifiedAccountFixture} from '../helpers/verified-account-fixture.mjs';
const execute=promisify(execFile),spec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'},startSeconds:0,endSeconds:1,aspect:'square'};
test('pipeline HTTP boundary authorizes inspected own uploads, rejects client stages and honors local provider availability',{timeout:60000},async()=>{
  const alice=await verifiedAccountFixture(),bob=await verifiedAccountFixture(),headers=()=>({'idempotency-key':randomUUID()});
  const pool=new pg.Pool({connectionString:process.env.PROJECT_DATABASE_URL,connectionTimeoutMillis:3000}),root=process.env.TEST_TEMP_DIR??'.local';await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'pipeline-boundary-'));
  try{
    const workspace=await alice.c.request('/workspaces','POST',{kind:'personal',name:'Pipeline boundary'},headers());assert.equal(workspace.status,201);const project=await alice.c.request('/projects','POST',{workspaceId:workspace.value.id,name:'Actual inspected pipeline source'},headers());assert.equal(project.status,201);
    const path=join(directory,'source.mp4');await execute(process.env.FFMPEG_PATH??'ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',path],{timeout:15000,windowsHide:true});const bytes=await readFile(path);
    const upload=await alice.c.request(`/projects/${project.value.id}/uploads`,'POST',{mode:'put',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'video/mp4'},headers());assert.equal(upload.status,201);const url=`/uploads/${upload.value.id}/pipelines`;
    assert.equal((await alice.c.request(url,'POST',spec,headers())).status,409);
    assert.ok((await fetch(upload.value.url,{method:'PUT',headers:upload.value.headers,body:bytes})).ok);assert.equal((await alice.c.request(`/uploads/${upload.value.id}/confirm`,'POST')).status,200);await eventually(async()=>(await alice.c.request(`/uploads/${upload.value.id}`)).value.inspection?.status==='succeeded',20000);
    assert.equal((await bob.c.request(url,'POST',spec,headers())).status,403);assert.equal((await alice.c.request(url,'POST',spec,{...headers(),'x-csrf-token':'wrong'})).status,403);
    for(const changed of [{provider:'deepgram'},{selection:{mode:'llm'}},{endSeconds:3},{analysisId:randomUUID()}])assert.equal((await alice.c.request(url,'POST',{...spec,...changed},headers())).status,400);
    const before=(await pool.query('SELECT reserved_bytes FROM workspace_storage WHERE workspace_id=$1',[workspace.value.id])).rows[0],providers=await alice.c.request('/analyses/providers');assert.equal(providers.status,200);
    const created=await alice.c.request(url,'POST',spec,headers());if(!providers.value.transcription.whisper_cpp.configured){assert.equal(created.status,503);assert.equal(created.value.code,'TRANSCRIPTION_NOT_CONFIGURED');assert.equal(Number((await pool.query('SELECT count(*) FROM pipelines WHERE upload_id=$1',[upload.value.id])).rows[0].count),0);}
    else{assert.equal(created.status,201);assert.equal((await alice.c.request(`/pipelines/${created.value.id}`,'DELETE')).status,200);await eventually(async()=>(await alice.c.request(`/pipelines/${created.value.id}`)).value.status==='cancelled',30000);assert.equal((await bob.c.request(`/pipelines/${created.value.id}`)).status,403);}
    assert.equal(Number((await pool.query('SELECT reserved_bytes FROM workspace_storage WHERE workspace_id=$1',[workspace.value.id])).rows[0].reserved_bytes),Number(before.reserved_bytes));assert.equal((await alice.c.request(`/projects/${project.value.id}`,'DELETE')).status,200);
  }finally{await pool.end();await rm(directory,{recursive:true,force:true});}
});
