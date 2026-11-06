import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtemp,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand,HeadObjectCommand } from '@aws-sdk/client-s3';
import { canTransition, validateMetadata, validateObjectKey } from '../apps/autoclipper-media-processing-service/dist/domain/inspection.js';
import { withInspectedSource } from '../apps/autoclipper-media-processing-service/dist/infrastructure/probe.js';
import { inspectionEvent } from '@autoclipper/event-contracts';

const valid = { format: { duration: '2.0', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 320, height: 240 }] };
test('metadata validates format, finite duration and video dimensions', () => {
  assert.equal(validateMetadata(valid, 10).durationSeconds, 2);
  assert.equal(validateMetadata({ ...valid, format: { ...valid.format, duration: '10' } }, 10).durationSeconds, 10);
  assert.throws(() => validateMetadata({ ...valid, format: { ...valid.format, duration: 'Infinity' } }, 10));
  assert.throws(() => validateMetadata(valid, 1), /MEDIA_LIMIT_EXCEEDED/);
  assert.throws(() => validateMetadata({ ...valid, format: { ...valid.format, duration: '10.001' } }, 10), /MEDIA_LIMIT_EXCEEDED/);
  assert.throws(() => validateMetadata({ ...valid, streams: [] }, 10));
  assert.throws(() => validateMetadata({ ...valid, format: { ...valid.format, format_name: 'hls' } }, 10));
});

test('inspection rejects configured byte-limit overflow before accessing object storage',async t=>{
  const workspaceId=randomUUID(),root=await mkdtemp(join(tmpdir(),'inspection-size-fixture-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;const s3={send:async()=>{calls++;throw new Error('unexpected storage request');}};
  const config={S3_BUCKET:'fixture',MAX_PROBE_BYTES:3,TEMP_DIR:root,PROBE_TIMEOUT_MS:100,FFPROBE_PATH:'must-not-run',MAX_VIDEO_SECONDS:30};
  const task={objectKey:`workspaces/${workspaceId}/media/source.mp4`,workspaceId,expectedBytes:4,expectedEtag:'fixture-etag',expectedSha256:'a'.repeat(64)};
  await assert.rejects(withInspectedSource(s3,config,task,async()=>assert.fail('must not inspect an oversized object')),error=>error.code==='MEDIA_LIMIT_EXCEEDED');
  assert.equal(calls,0);assert.deepEqual(await readdir(root),[]);
});

test('inspection bounds downloaded bytes and checks SHA-256 before invoking FFprobe',async t=>{
  const workspaceId=randomUUID(),root=await mkdtemp(join(tmpdir(),'inspection-stream-fixture-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const config={S3_BUCKET:'fixture',MAX_PROBE_BYTES:3,TEMP_DIR:root,PROBE_TIMEOUT_MS:100,FFPROBE_PATH:'must-not-run',MAX_VIDEO_SECONDS:30};
  const makeTask=(bytes,sha256)=>({objectKey:`workspaces/${workspaceId}/media/source.mp4`,workspaceId,expectedBytes:bytes,expectedEtag:'fixture-etag',expectedSha256:sha256});
  const client=(bytes,headBytes=bytes)=>({send:async command=>command instanceof HeadObjectCommand?{ContentLength:headBytes,ETag:'fixture-etag'}:command instanceof GetObjectCommand?{Body:Readable.from([Buffer.from(bytes)])}:assert.fail('unexpected S3 command')});
  await assert.rejects(withInspectedSource(client('abcd',3),config,makeTask(3,createHash('sha256').update('abc').digest('hex')),async()=>assert.fail('oversized input must not reach FFprobe')),error=>error.code==='MEDIA_LIMIT_EXCEEDED');
  assert.deepEqual(await readdir(root),[],'temporary file must be removed after an oversized stream');
  await assert.rejects(withInspectedSource(client('abc',3),config,makeTask(3,'b'.repeat(64)),async()=>assert.fail('checksum mismatch must not reach FFprobe')),error=>error.code==='CHECKSUM_MISMATCH');
  assert.deepEqual(await readdir(root),[],'temporary file must be removed after checksum failure');
  await assert.rejects(withInspectedSource(client('abc',2),config,makeTask(3,createHash('sha256').update('abc').digest('hex')),async()=>assert.fail('changed head metadata must not reach FFprobe')),error=>error.code==='OBJECT_CHANGED');
  assert.deepEqual(await readdir(root),[]);
});

test('inspection storage read aborts at its configured timeout and removes its temporary directory',async t=>{
  const workspaceId=randomUUID(),root=await mkdtemp(join(tmpdir(),'inspection-timeout-fixture-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const config={S3_BUCKET:'fixture',MAX_PROBE_BYTES:3,TEMP_DIR:root,PROBE_TIMEOUT_MS:20,FFPROBE_PATH:'must-not-run',MAX_VIDEO_SECONDS:30};
  let aborted=false;const s3={send:async(command,{abortSignal}={})=>{
    if(command instanceof HeadObjectCommand)return{ContentLength:1,ETag:'fixture-etag'};
    if(command instanceof GetObjectCommand)return new Promise((_resolve,reject)=>{if(abortSignal.aborted){aborted=true;reject(new Error('fixture abort'));return;}abortSignal.addEventListener('abort',()=>{aborted=true;reject(new Error('fixture abort'));},{once:true});});
    assert.fail('unexpected S3 command');
  }};
  const task={objectKey:`workspaces/${workspaceId}/media/source.mp4`,workspaceId,expectedBytes:1,expectedEtag:'fixture-etag',expectedSha256:'a'.repeat(64)};
  await assert.rejects(withInspectedSource(s3,config,task,async()=>assert.fail('timeout must prevent FFprobe')));
  assert.equal(aborted,true);assert.deepEqual(await readdir(root),[],'temporary directory must be removed after timeout');
});
test('object references reject cross-workspace keys, traversal and external URLs', () => {
  const workspace = randomUUID();
  validateObjectKey(`workspaces/${workspace}/media/source.mp4`, workspace);
  for (const key of [`workspaces/${randomUUID()}/media/source.mp4`, `workspaces/${workspace}/media/../../secrets`, 'http://169.254.169.254/latest/meta-data']) assert.throws(() => validateObjectKey(key, workspace));
});
test('terminal jobs cannot be re-entered; events accept only versioned task references', () => {
  assert.equal(canTransition('queued', 'running'), true);
  assert.equal(canTransition('running', 'queued'), true);
  assert.equal(canTransition('succeeded', 'running'), false);
  assert.equal(canTransition('failed', 'queued'), false);
  const event = { version: 1, taskId: randomUUID(), correlationId: randomUUID() };
  assert.equal(inspectionEvent.safeParse(event).success, true);
  assert.equal(inspectionEvent.safeParse({ ...event, url: 'http://localhost' }).success, false);
  assert.equal(inspectionEvent.safeParse({ ...event, version: 2 }).success, false);
});
