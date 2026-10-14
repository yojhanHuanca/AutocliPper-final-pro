import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {loadMediaConfig} from '@autoclipper/configuration';
import {createS3} from '../../apps/autoclipper-media-processing-service/dist/infrastructure/connections.js';
import {produceDerivative} from '../../apps/autoclipper-media-processing-service/dist/infrastructure/renderer.js';
const {AbortController}=globalThis;
test('audio extraction preserves the video timeline when speech starts late and ends early',{timeout:60000},async()=>{
  const config=loadMediaConfig(),s3=createS3(config),execute=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'audio-timeline-'));
  const workspace=randomUUID(),id=randomUUID(),objectKey=`workspaces/${workspace}/media/${id}/source.mp4`,outputKey=`workspaces/${workspace}/media/derivatives/${id}/audio.wav`;
  try{
    const path=join(directory,'source.mp4');await execute(config.FFMPEG_PATH,['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=30:d=3','-itsoffset','1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-t','3','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',path],{timeout:30000,windowsHide:true});const bytes=await readFile(path);const stored=await s3.send(new PutObjectCommand({Bucket:config.S3_BUCKET,Key:objectKey,Body:bytes}));
    const result=await produceDerivative(s3,{...config,TEMP_DIR:directory},{id,workspaceId:workspace,spec:{version:1,kind:'audio'}},{workspaceId:workspace,objectKey,expectedBytes:bytes.length,expectedEtag:stored.ETag,expectedSha256:createHash('sha256').update(bytes).digest('hex')},new AbortController().signal);assert.ok(Math.abs(result.durationSeconds-3)<0.1);
    const object=await s3.send(new GetObjectCommand({Bucket:config.S3_BUCKET,Key:outputKey}));await writeFile(join(directory,'audio.wav'),Buffer.from(await object.Body.transformToByteArray()));
    const raw=await execute(config.FFMPEG_PATH,['-v','error','-i',join(directory,'audio.wav'),'-f','s16le','-ac','1','-ar','16000','pipe:1'],{encoding:'buffer',maxBuffer:1048576,timeout:10000,windowsHide:true});
    const energy=(start,end)=>{let sum=0,count=0;for(let offset=Math.floor(start*16000)*2;offset<Math.floor(end*16000)*2;offset+=2){sum+=Math.abs(raw.stdout.readInt16LE(offset));count++;}return sum/count;};
    assert.ok(energy(0.1,0.7)<10,'Leading silence was lost');assert.ok(energy(1.2,1.7)>500,'Delayed sound was not aligned');assert.ok(energy(2.4,2.9)<10,'Trailing silence was not padded');
  }finally{await s3.send(new DeleteObjectCommand({Bucket:config.S3_BUCKET,Key:objectKey}));await s3.send(new DeleteObjectCommand({Bucket:config.S3_BUCKET,Key:outputKey}));s3.destroy();await rm(directory,{recursive:true,force:true});}
});
