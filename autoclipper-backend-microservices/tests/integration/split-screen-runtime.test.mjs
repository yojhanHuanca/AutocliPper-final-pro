import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import pg from 'pg';
import {Queue} from 'bullmq';
import {PutObjectCommand,GetObjectCommand,DeleteObjectCommand,ListObjectsV2Command} from '@aws-sdk/client-s3';
import {loadMediaConfig} from '@autoclipper/configuration';
import {eventually} from '@autoclipper/testing';
import {ProcessingRuntime} from '../../apps/autoclipper-media-processing-service/dist/application/processing-runtime.js';
import {migrateMedia} from '../../apps/autoclipper-media-processing-service/dist/infrastructure/migrate.js';
import {createS3,redisConnection} from '../../apps/autoclipper-media-processing-service/dist/infrastructure/connections.js';
import {probeLocal} from '../../apps/autoclipper-media-processing-service/dist/infrastructure/probe.js';
const execute=promisify(execFile),config=loadMediaConfig();
test('persistent split-screen validates both sources, recovers, rejects changed or missing objects, cancels and cleans both inputs',{timeout:240000},async t=>{
  await migrateMedia(process.env.MIGRATION_DATABASE_URL);const pool=new pg.Pool({connectionString:config.DATABASE_URL}),s3=createS3(config),queue=new Queue('media-derivatives-v1',{connection:{...redisConnection(config.REDIS_URL),maxRetriesPerRequest:1}});
  const root=process.env.TEST_TEMP_DIR??'.local';await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'split-runtime-')),temporary=join(directory,'temporary'),workspace=randomUUID(),sources=[],tasks=[];let runtime;
  async function start(mode){process.env.MEDIA_WORKERS=mode;process.env.TEMP_DIR=relative(process.cwd(),temporary);assert.equal(isAbsolute(process.env.TEMP_DIR),false);runtime=new ProcessingRuntime();await runtime.onModuleInit();}
  async function stop(){if(runtime){const current=runtime;runtime=undefined;await current.onModuleDestroy();}}
  async function source(color,frequency,duration=4,size='640x240',owner=workspace){const id=randomUUID(),path=join(directory,`${id}.mp4`);await execute(config.FFMPEG_PATH,['-v','error','-f','lavfi','-i',`color=c=${color}:s=${size}:r=30`,'-f','lavfi','-i',`sine=frequency=${frequency}:sample_rate=48000`,'-t',String(duration),'-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p','-c:a','aac',path],{timeout:60000,windowsHide:true});const bytes=await readFile(path),key=`workspaces/${owner}/media/${id}/source.mp4`,stored=await s3.send(new PutObjectCommand({Bucket:config.S3_BUCKET,Key:key,Body:bytes})),sha=createHash('sha256').update(bytes).digest('hex'),metadata=await probeLocal(path,config);await pool.query("INSERT INTO inspection_tasks(id,workspace_id,object_key,expected_bytes,expected_etag,expected_sha256,correlation_id,status,result,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,'succeeded',$8,now(),now())",[id,owner,key,bytes.length,stored.ETag,sha,randomUUID(),metadata]);const value={id,key,bytes,sha};sources.push(value);return value;}
  async function submit(primary,secondary,patch={}){const spec={version:1,kind:'clip',startSeconds:0,endSeconds:3,aspect:'square',splitScreen:{secondaryUploadId:secondary.id,layout:'side_by_side',primaryRatio:0.4,startSeconds:0,shortInput:'freeze',audio:'secondary'},...patch},id=randomUUID();tasks.push(id);await runtime.submit({id,workspaceId:workspace,inspectionId:primary.id,spec,correlationId:randomUUID()});return id;}
  async function terminal(id){let row;await eventually(async()=>{row=(await pool.query('SELECT * FROM processing_tasks WHERE id=$1',[id])).rows[0];return['succeeded','failed','cancelled'].includes(row?.status)&&!row.cleanup_pending;},45000);return row;}
  async function restore(value){const stored=await s3.send(new PutObjectCommand({Bucket:config.S3_BUCKET,Key:value.key,Body:value.bytes}));await pool.query('UPDATE inspection_tasks SET expected_etag=$2,expected_sha256=$3 WHERE id=$1',[value.id,stored.ETag,value.sha]);}
  try{
    const primary=await source('red',440),secondary=await source('blue',880,1.2),foreign=await source('yellow',660,4,'640x240',randomUUID());
    await t.test('two-source outbox survives a lost Redis entry and produces a real correctly partitioned clip',async()=>{
      await start('inspection');const id=await submit(primary,secondary);await eventually(async()=>!!(await pool.query('SELECT delivered_at FROM processing_outbox WHERE task_id=$1',[id])).rows[0]?.delivered_at,10000);await stop();await(await queue.getJob(id)).remove();await start('render');const row=await terminal(id);assert.equal(row.status,'succeeded',JSON.stringify(row));assert.equal(row.secondary_inspection_id,secondary.id);assert.equal(row.attempts,1);assert.equal(row.result.width,720);assert.equal(row.result.height,720);assert.ok(Math.abs(row.result.durationSeconds-3)<0.1);
      const object=await s3.send(new GetObjectCommand({Bucket:config.S3_BUCKET,Key:row.result.artifacts[0].objectKey}));const bytes=Buffer.from(await object.Body.transformToByteArray());assert.equal(createHash('sha256').update(bytes).digest('hex'),row.result.artifacts[0].sha256);const path=join(directory,'result.mp4');await writeFile(path,bytes);const frame=(await execute(config.FFMPEG_PATH,['-v','error','-ss','2.5','-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',timeout:15000,maxBuffer:2097152,windowsHide:true})).stdout;const left=(360*720+100)*3,right=(360*720+500)*3;assert.ok(frame[left]>180&&frame[left+2]<50);assert.ok(frame[right+2]>180&&frame[right]<50);assert.equal((await probeLocal(path,config)).audioCodec,'aac');
    });
    await t.test('secondary workspace, short-input reject and HD/input limits are enforced before enqueue',async()=>{
      await assert.rejects(submit(primary,foreign),error=>error.getStatus()===409);await assert.rejects(submit(primary,secondary,{splitScreen:{secondaryUploadId:secondary.id,layout:'stacked',primaryRatio:0.5,startSeconds:0,shortInput:'reject',audio:'none'}}),error=>error.getStatus()===400);
      const metadata=(await pool.query('SELECT result FROM inspection_tasks WHERE id=$1',[secondary.id])).rows[0].result;await pool.query("UPDATE inspection_tasks SET result=jsonb_set(result,'{width}','3840') WHERE id=$1",[secondary.id]);try{await assert.rejects(submit(primary,secondary),error=>error.getStatus()===400);}finally{await pool.query('UPDATE inspection_tasks SET result=$2 WHERE id=$1',[secondary.id,metadata]);}
    });
    await t.test('SHA-256 of both downloaded sources is mandatory even when ETag and length still match',async()=>{
      for(const selected of [primary,secondary]){await pool.query('UPDATE inspection_tasks SET expected_sha256=$2 WHERE id=$1',[selected.id,'0'.repeat(64)]);const result=await terminal(await submit(primary,secondary));assert.equal(result.status,'failed');assert.equal(result.error_code,'CHECKSUM_MISMATCH');assert.equal(result.attempts,1);await restore(selected);}assert.deepEqual(await readdir(temporary),[]);
    });
    await t.test('a modified secondary object fails once; absent secondary retries three times with no partial outputs',async()=>{
      await s3.send(new PutObjectCommand({Bucket:config.S3_BUCKET,Key:secondary.key,Body:Buffer.from('Modified secondary')}));const changed=await terminal(await submit(primary,secondary));assert.equal(changed.error_code,'OBJECT_CHANGED');assert.equal(changed.attempts,1);
      await s3.send(new DeleteObjectCommand({Bucket:config.S3_BUCKET,Key:secondary.key}));const missing=await terminal(await submit(primary,secondary));assert.equal(missing.status,'failed');assert.equal(missing.attempts,3);assert.equal(missing.error_code,'STORAGE_OR_NETWORK_ERROR');assert.deepEqual(await readdir(temporary),[]);await restore(secondary);
    });
    await t.test('queued cancellation persists across restart; active cancellation removes both temporary inputs',async()=>{
      await stop();await start('inspection');const queued=await submit(primary,secondary);await runtime.cancel(queued,workspace);await stop();await start('render');assert.equal((await terminal(queued)).status,'cancelled');
      const long=await source('red',440,120,'1280x720'),id=await submit(long,secondary,{endSeconds:120,aspect:'vertical'});await eventually(async()=>{const row=(await pool.query('SELECT status FROM processing_tasks WHERE id=$1',[id])).rows[0];return row?.status==='running'&&(await readdir(temporary)).length===2;},30000);await runtime.cancel(id,workspace);const cancelled=await terminal(id);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.result,null);assert.deepEqual(await readdir(temporary),[]);const artifacts=await s3.send(new ListObjectsV2Command({Bucket:config.S3_BUCKET,Prefix:`workspaces/${workspace}/media/derivatives/${id}/`}));assert.deepEqual(artifacts.Contents??[],[]);
    });
  }finally{
    if(runtime)for(const id of tasks)try{await runtime.cancel(id,workspace);}catch{/* Rejected submissions have no persisted task. */}await stop();
    for(const id of tasks){const job=await queue.getJob(id);if(job)await job.remove();for(const file of ['clip.mp4','captions.srt','captions.vtt','audio.wav'])await s3.send(new DeleteObjectCommand({Bucket:config.S3_BUCKET,Key:`workspaces/${workspace}/media/derivatives/${id}/${file}`}));}
    await pool.query('DELETE FROM processing_tasks WHERE id=ANY($1::uuid[])',[tasks]);await pool.query('DELETE FROM inspection_tasks WHERE id=ANY($1::uuid[])',[sources.map(value=>value.id)]);for(const value of sources)await s3.send(new DeleteObjectCommand({Bucket:config.S3_BUCKET,Key:value.key}));await queue.close();s3.destroy();await pool.end();await rm(directory,{recursive:true,force:true});
  }
});
