import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { cookieName } from '@autoclipper/http-security';
import { ProjectService } from '../apps/autoclipper-project-service/dist/application/project.service.js';
import { PipelineManager } from '../apps/autoclipper-project-service/dist/application/pipeline.manager.js';

function requestWithCsrf(config) {
  const payload = `${Date.now()}.fixture-nonce`;
  const signature = createHmac('sha256', config.CSRF_SIGNING_KEY).update(payload).digest('base64url');
  const token = `${payload}.${signature}`;
  return {
    headers: {
      origin: config.CORS_ORIGIN,
      cookie: `autoclipper_csrf=${token}`,
      'x-csrf-token': token,
    },
  };
}

test('source import endpoint rejects unsupported Kick URLs before creating uploads', async () => {
  const service = Object.create(ProjectService.prototype);
  service.config = { CORS_ORIGIN: 'http://localhost:4200', CSRF_SIGNING_KEY: 'fixture-signing-key' };
  service.project = async () => ({ user: { id: 'user-id' }, project: { id: 'project-id' } });
  service.tx = async () => assert.fail('unsupported provider must be rejected before database writes');

  for (const [url, code] of [
    ['https://kick.com/channel/videos/1234567890', 'KICK_MEDIA_API_UNAVAILABLE'],
    ['https://kick.com/channel/clips/clip-id', 'KICK_MEDIA_API_UNAVAILABLE'],
  ]) {
    await assert.rejects(
      service.importSourceLink(requestWithCsrf(service.config), 'project-id', { url }, 'fixture-correlation'),
      error => error.getStatus?.() === 422 && error.getResponse?.().code === code,
    );
  }
});

test('Twitch VOD links require a bounded explicit interval before the import route can proceed', async () => {
  const service = Object.create(ProjectService.prototype);
  service.config = { CORS_ORIGIN: 'http://localhost:4200', CSRF_SIGNING_KEY: 'fixture-signing-key' };
  service.project = async () => ({ user: { id: 'user-id' }, project: { id: 'project-id' } });
  service.tx = async () => assert.fail('a missing or invalid VOD interval must not create an import');
  service.twitchSourceCapabilityStatus = async () => ({ configured: true, linked: true, clipScopeReady: true });
  const request = requestWithCsrf(service.config);
  const url = 'https://www.twitch.tv/videos/2916449488';

  const missing = await service.resolveSourceLink(request, 'project-id', { url });
  assert.equal(missing.state, 'input_required');
  assert.equal(missing.importable, false);
  assert.equal(missing.reasonCode, 'TWITCH_VOD_INTERVAL_REQUIRED');
  assert.equal(missing.nextAction, 'upload_authorized_file');
  assert.match(missing.message, /no puede seleccionar automáticamente momentos/u);
  assert.match(missing.nextStep, /clip de Twitch ya publicado|MP4/u);
  assert.doesNotMatch(missing.nextStep, /Indica un segundo final/u);
  await assert.rejects(
    service.importSourceLink(request, 'project-id', { url }, 'fixture-correlation'),
    error => error.getStatus?.() === 422 && error.getResponse?.().code === 'TWITCH_VOD_INTERVAL_REQUIRED',
  );

  const available = await service.resolveSourceLink(request, 'project-id', { url, vodOffsetSeconds: 90_125, durationSeconds: 30 });
  assert.equal(available.state, 'available');
  assert.equal(available.importable, true);
  assert.equal(available.vodOffsetSeconds, 90_125);
  assert.equal(available.durationSeconds, 30);
  const minimumValid = await service.resolveSourceLink(request, 'project-id', { url, vodOffsetSeconds: 5, durationSeconds: 5 });
  assert.equal(minimumValid.state, 'available');
  const maximumValid = await service.resolveSourceLink(request, 'project-id', { url, vodOffsetSeconds: 60, durationSeconds: 60 });
  assert.equal(maximumValid.state, 'available');
  for (const interval of [
    { vodOffsetSeconds: 4, durationSeconds: 5 },
    { vodOffsetSeconds: 60, durationSeconds: 61 },
    { vodOffsetSeconds: 20, durationSeconds: 30 },
    { vodOffsetSeconds: Number.MAX_SAFE_INTEGER + 1, durationSeconds: 30 },
  ]) {
    await assert.rejects(
      service.resolveSourceLink(request, 'project-id', { url, ...interval }),
      error => error.getStatus?.() === 400,
    );
  }
});

test('standard upload reservation rejects a source file that exceeds the workspace quota',async()=>{
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  service.project=async()=>({user:{id:'user-id'},project:{id:'project-id',workspace_id:'workspace-id'}});
  let uploadInserted=false,quotaValues;
  service.tx=async work=>work({query:async (sql,values=[])=>{
    if(sql.includes('SELECT * FROM uploads WHERE creator_id'))return{rows:[]};
    if(sql.includes('UPDATE workspace_storage SET reserved_bytes=reserved_bytes+$1')){quotaValues=values;return{rows:[]};}
    if(sql.includes('INSERT INTO uploads('))uploadInserted=true;
    return{rows:[]};
  }});
  const request=requestWithCsrf(service.config);request.headers['idempotency-key']=randomUUID();
  await assert.rejects(service.beginUpload(request,'project-id',{bytes:32,sha256:'a'.repeat(64),contentType:'video/mp4',mode:'put'}),error=>error.getStatus?.()===409);
  assert.deepEqual(quotaValues,[32,'workspace-id',Number(process.env.WORKSPACE_STORAGE_LIMIT_BYTES??1073741824)]);
  assert.equal(uploadInserted,false);
});

test('local MP4 upload rejects sizes above 100 MiB before quota work and keeps the 100 MiB boundary inclusive',async()=>{
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  service.project=async()=>({user:{id:'user-id'},project:{id:'project-id',workspace_id:'workspace-id'}});
  let transactions=0,quotaBytes;
  service.tx=async work=>{transactions++;return work({query:async(sql,values=[])=>{
    if(sql.startsWith('SELECT * FROM uploads WHERE creator_id'))return{rows:[]};
    if(sql.startsWith('UPDATE workspace_storage SET reserved_bytes=reserved_bytes+$1')){quotaBytes=values[0];return{rows:[]};}
    return{rows:[]};
  }});};
  service.s3={send:async()=>assert.fail('upload validation must finish before object storage is used')};
  const tooLarge=requestWithCsrf(service.config);tooLarge.headers['idempotency-key']=randomUUID();
  await assert.rejects(service.beginUpload(tooLarge,'project-id',{bytes:104_857_601,sha256:'a'.repeat(64),contentType:'video/mp4',mode:'put'}),error=>error.getStatus?.()===400);
  assert.equal(transactions,0,'oversized local files must not reserve workspace bytes');

  const atLimit=requestWithCsrf(service.config);atLimit.headers['idempotency-key']=randomUUID();
  await assert.rejects(service.beginUpload(atLimit,'project-id',{bytes:104_857_600,sha256:'a'.repeat(64),contentType:'video/mp4',mode:'put'}),error=>error.getStatus?.()===409);
  assert.equal(transactions,1,'the inclusive byte limit passes request validation and reaches atomic quota admission');
  assert.equal(quotaBytes,104_857_600);
});

test('source resolution enables YouTube imports while keeping unsupported Kick and unlinked Twitch actionable',async()=>{
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  service.project=async()=>({user:{id:'user-id'},project:{id:'project-id'}});
  let metadataLookup;
  let metadataResult={state:'unavailable',reasonCode:'YOUTUBE_METADATA_NOT_CONFIGURED'};
  service.youtubeMetadataClient={lookup:async(...args)=>{metadataLookup=args;return metadataResult;}};
  const request=requestWithCsrf(service.config);
  const youtube=await service.resolveSourceLink(request,'project-id',{url:'https://youtu.be/abcdefghijk'});
  assert.equal(youtube.state,'available');assert.equal(youtube.importable,true);assert.equal(youtube.nextAction,'import_youtube_video');
  assert.equal(youtube.videoId,'abcdefghijk');assert.equal(youtube.previewUrl,'https://www.youtube.com/embed/abcdefghijk');
  assert.deepEqual(youtube.youtubeMetadata,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_NOT_CONFIGURED'});
  assert.deepEqual(metadataLookup,['abcdefghijk','user-id']);
  metadataResult={state:'available',title:'Fixture video',channelTitle:'Fixture channel',durationSeconds:42,thumbnailUrl:null,uploadStatus:'processed',privacyStatus:'public',embeddable:true};
  const youtubeMetadataOnly=await service.resolveSourceLink(requestWithCsrf(service.config),'project-id',{url:'https://youtu.be/abcdefghijk'});
  assert.equal(youtubeMetadataOnly.youtubeMetadata.state,'available');
  assert.equal(youtubeMetadataOnly.state,'available');
  assert.equal(youtubeMetadataOnly.importable,true);
  const kick=await service.resolveSourceLink(request,'project-id',{url:'https://kick.com/channel/clips/clip-id'});
  assert.equal(kick.state,'unsupported');assert.equal(kick.importable,false);assert.equal(kick.reasonCode,'KICK_MEDIA_API_UNAVAILABLE');assert.equal(kick.nextAction,'upload_authorized_file');assert.match(kick.nextStep,/Carga el MP4.*autorización programática/u);
  service.resolveTwitchImport=async()=>({available:false,reasonCode:'TWITCH_ACCOUNT_NOT_LINKED'});
  const twitch=await service.resolveSourceLink(request,'project-id',{url:'https://clips.twitch.tv/FixtureClip_123'});
  assert.equal(twitch.state,'unavailable');assert.equal(twitch.importable,false);assert.equal(twitch.reasonCode,'TWITCH_ACCOUNT_NOT_LINKED');assert.equal(twitch.nextAction,'link_twitch_account');
  service.resolveTwitchImport=async()=>({available:false,reasonCode:'TWITCH_OAUTH_NOT_CONFIGURED'});
  const unconfigured=await service.resolveSourceLink(request,'project-id',{url:'https://clips.twitch.tv/FixtureClip_123'});
  assert.equal(unconfigured.state,'unavailable');assert.equal(unconfigured.importable,false);assert.equal(unconfigured.reasonCode,'TWITCH_OAUTH_NOT_CONFIGURED');assert.equal(unconfigured.nextAction,'configure_twitch_oauth');
  service.resolveTwitchImport=async()=>({available:true,title:'Fixture highlight',durationSeconds:20});
  const available=await service.resolveSourceLink(request,'project-id',{url:'https://clips.twitch.tv/FixtureClip_123'});
  assert.equal(available.state,'available');assert.equal(available.importable,true);
  assert.match(available.message,/cuenta de Twitch vinculada.*acceso a la descarga/iu);
  assert.match(available.nextStep,/solo si terminan la descarga y la inspección/iu);
});

test('Project rejects malformed source URLs as 400 before metadata or provider access',async()=>{
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  service.project=async()=>({user:{id:'user-id'},project:{id:'project-id'}});
  let lookups=0;service.youtubeMetadataClient={lookup:async()=>{lookups++;throw new Error('metadata must not be requested');}};
  const request=requestWithCsrf(service.config);
  for(const url of ['not a URL','http://youtu.be/abcdefghijk','https://youtube.com.evil.example/watch?v=abcdefghijk','https://127.0.0.1/abcdefghijk','https://youtu.be/abcdefghijk?next=http://127.0.0.1']){
    await assert.rejects(service.resolveSourceLink(request,'project-id',{url}),error=>error.getStatus?.()===400);
  }
  await assert.rejects(service.resolveSourceLink(request,'project-id',{url:12}),error=>error.getStatus?.()===400);
  assert.equal(lookups,0);
});

test('Twitch VOD quota check blocks remote clip creation and download before they start',async()=>{
  const service=Object.create(ProjectService.prototype);
  service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  service.project=async()=>({user:{id:'user-id'},project:{id:'project-id',workspace_id:'workspace-id'}});
  service.tx=async work=>work({query:async sql=>{
    if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
    if(sql.startsWith('SELECT id,request_hash,state,upload_id,lease_until,'))return{rows:[]};
    if(sql.startsWith('SELECT id,state,upload_id,lease_until,'))return{rows:[]};
    if(sql.startsWith('INSERT INTO source_imports'))return{rows:[]};
    throw new Error(`Unexpected quota-claim query: ${sql}`);
  }});
  let identityCalls=0,downloadCalls=0;
  service.createTwitchVodClip=async()=>{identityCalls++;throw new Error('Twitch must not create a VOD clip when quota is exhausted');};
  service.resolveTwitchImport=async()=>{identityCalls++;throw new Error('Identity must not be called when quota is exhausted');};
  service.sourceAssetDownloader=async()=>{downloadCalls++;throw new Error('bytes must not be downloaded when quota is exhausted');};
  service.pool={query:async sql=>{
    if(sql.startsWith('SELECT used_bytes,reserved_bytes FROM workspace_storage'))return{rows:[{used_bytes:'1024',reserved_bytes:'0'}]};
    if(sql.startsWith("UPDATE source_imports SET state='failed'"))return{rows:[]};
    throw new Error(`Unexpected quota pool query: ${sql}`);
  }};
  const previousLimit=process.env.WORKSPACE_STORAGE_LIMIT_BYTES;
  process.env.WORKSPACE_STORAGE_LIMIT_BYTES='1024';
  const request=requestWithCsrf(service.config);request.headers['idempotency-key']=randomUUID();
  try {
    await assert.rejects(service.importSourceLink(request,'project-id',{url:'https://www.twitch.tv/videos/2916449488',vodOffsetSeconds:125,durationSeconds:30},'fixture-correlation'),error=>error.getStatus?.()===409&&error.getResponse?.().code==='PROJECT_STORAGE_QUOTA_EXCEEDED');
  } finally {
    if(previousLimit===undefined)delete process.env.WORKSPACE_STORAGE_LIMIT_BYTES;else process.env.WORKSPACE_STORAGE_LIMIT_BYTES=previousLimit;
  }
  assert.equal(identityCalls,0);assert.equal(downloadCalls,0);
});

test('a confirmed upload is recovered idempotently after a partial source-import state write',async()=>{
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  service.project=async()=>({user:{id:'user-id'},project:{id:'project-id',workspace_id:'workspace-id'}});
  const key=randomUUID(),sourceImportId='source-import-id',requestHash=createHash('sha256').update(JSON.stringify({projectId:'project-id',provider:'twitch',clipId:'FixtureClip_123'})).digest('hex');
  const confirmedUpload={id:'upload-id',project_id:'project-id',workspace_id:'workspace-id',state:'confirmed',cleaned_at:null,expires_at:new Date(Date.now()+60_000)};
  service.tx=async work=>work({query:async sql=>{
    if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
    if(sql.startsWith('SELECT id,request_hash,state,upload_id,lease_until,'))return{rows:[{id:sourceImportId,request_hash:requestHash,state:'failed',upload_id:confirmedUpload.id,lease_until:new Date(Date.now()-1000)}]};
    if(sql.startsWith('SELECT * FROM uploads WHERE id=$1 AND project_id=$2 AND workspace_id=$3 FOR UPDATE'))return{rows:[confirmedUpload]};
    if(sql.startsWith('INSERT INTO inspection_requests'))return{rows:[]};
    if(sql.startsWith("UPDATE source_imports SET state='succeeded'"))return{rows:[{id:sourceImportId}]};
    throw new Error(`Unexpected recovery query: ${sql}`);
  }});
  service.pool={query:async()=>assert.fail('confirmed upload recovery must not start another import')};
  service.resolveTwitchImport=async()=>assert.fail('confirmed upload recovery must not call Twitch');
  service.sourceAssetDownloader=async()=>assert.fail('confirmed upload recovery must not download bytes');
  const request=requestWithCsrf(service.config);request.headers['idempotency-key']=key;
  const result=await service.importSourceLink(request,'project-id',{url:'https://clips.twitch.tv/FixtureClip_123'},'fixture-correlation');
  assert.deepEqual(result,{id:sourceImportId,state:'succeeded',uploadId:'upload-id',duplicate:true});
});

test('an interrupted pending upload resumes with the same reserved upload instead of reserving a duplicate',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'twitch-import-resume-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const bytes=Buffer.alloc(32);bytes.write('ftyp',4,'ascii');const path=join(directory,'resume.mp4');await writeFile(path,bytes);
  const hash=createHash('sha256').update(bytes).digest('hex'),key=randomUUID(),sourceImportId='source-import-id';
  const requestHash=createHash('sha256').update(JSON.stringify({projectId:'project-id',provider:'twitch',clipId:'FixtureClip_123'})).digest('hex');
  const upload={id:'upload-id',creator_id:'user-id',project_id:'project-id',workspace_id:'workspace-id',object_key:'workspaces/workspace-id/media/upload-id/source.media',expected_bytes:bytes.length,sha256:hash,content_type:'video/mp4',mode:'put',upload_id:null,state:'pending',etag:null,expires_at:new Date(Date.now()+60_000),signed_until:new Date(Date.now()+60_000),cleaned_at:null,request_hash:'a'.repeat(64)};
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  service.project=async()=>({user:{id:'user-id'},project:{id:'project-id',workspace_id:'workspace-id'}});
  service.tx=async work=>work({query:async sql=>{
    if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
    if(sql.startsWith('SELECT id,request_hash,state,upload_id,lease_until,'))return{rows:[{id:sourceImportId,request_hash:requestHash,state:'failed',upload_id:upload.id,lease_until:new Date(Date.now()-1000)}]};
    if(sql.startsWith('SELECT * FROM uploads WHERE id=$1 AND project_id=$2 AND workspace_id=$3 FOR UPDATE'))return{rows:[upload]};
    if(sql.startsWith("UPDATE source_imports SET state='importing'"))return{rows:[]};
    throw new Error(`Unexpected resume query: ${sql}`);
  }});
  service.resolveTwitchImport=async()=>({available:true,broadcasterId:'42',title:'Fixture highlight',durationSeconds:20,downloadUrl:'https://production.assets.clips.twitchcdn.net/signed/fixture.mp4'});
  let downloadOptions,puts=0,confirmed;
  service.sourceAssetDownloader=async(_url,options)=>{downloadOptions=options;return{path,bytes:bytes.length,sha256:hash,contentType:'video/mp4',cleanup:async()=>{}};};
  service.importS3={send:async command=>{puts++;assert.equal(command.input.Key,upload.object_key);const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);return{};}};
  service.bucket='private-media';service.beginUpload=async()=>assert.fail('resume must not reserve a second upload');service.abort=async()=>assert.fail('successful resume must not abort the original upload');
  service.confirm=async(_req,id,_correlationId,importId)=>{assert.equal(id,upload.id);assert.equal(importId,sourceImportId);confirmed=true;return{id,state:'confirmed'};};
  service.pool={query:async()=>assert.fail('resume already owns its reserved storage bytes')};
  const request=requestWithCsrf(service.config);request.headers['idempotency-key']=key;
  const result=await service.importSourceLink(request,'project-id',{url:'https://clips.twitch.tv/FixtureClip_123'},'fixture-correlation');
  assert.equal(result.state,'succeeded');assert.equal(result.uploadId,upload.id);assert.equal(puts,1);assert.equal(confirmed,true);
  assert.equal(downloadOptions.maxBytes,bytes.length);assert.equal(downloadOptions.limitExceededCode,'TWITCH_SOURCE_CHANGED');
});

test('Twitch clip import fixture stores verified bytes privately, confirms inspection, and deduplicates retries',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'twitch-import-fixture-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const bytes=Buffer.alloc(32);bytes.write('ftyp',4,'ascii');const path=join(directory,'fixture.mp4');await writeFile(path,bytes);
  const hash=createHash('sha256').update(bytes).digest('hex'),idempotencyKey=randomUUID(),clipUrl='https://clips.twitch.tv/FixtureClip_123';
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key',INTERNAL_TOKEN:'fixture-internal-token'};
  service.project=async(_req,projectId)=>({user:{id:'user-id'},project:{id:projectId,workspace_id:'workspace-id'}});
  const uploadRow={id:'upload-id',creator_id:'user-id',project_id:'project-id',workspace_id:'workspace-id',object_key:'workspaces/workspace-id/media/uploads/upload-id/source.media',expected_bytes:bytes.length,sha256:hash,content_type:'video/mp4',mode:'put',upload_id:null,state:'pending',etag:null,expires_at:new Date(Date.now()+60_000),signed_until:new Date(Date.now()+60_000),request_hash:'a'.repeat(64)};
  const inspectionRequests=[];
  let sourceImport,s3Puts=0,downloads=0,cleanup=0;
  service.tx=async work=>work({query:async(sql,values=[])=>{
    if(sql.includes('SELECT id,request_hash,state,upload_id,lease_until,'))return{rows:sourceImport&&sourceImport.creator_id===values[0]&&sourceImport.idempotency_key===values[1]?[{...sourceImport}]:[]};
    if(sql.includes('SELECT id,state,upload_id,lease_until,'))return{rows:sourceImport?[{id:sourceImport.id,state:sourceImport.state,upload_id:sourceImport.upload_id,lease_until:sourceImport.lease_until,provider_resource_id:sourceImport.provider_resource_id??null,external_effect_started_at:sourceImport.external_effect_started_at??null}]:[]};
    if(sql.includes('INSERT INTO source_imports')){sourceImport={id:values[0],creator_id:values[1],workspace_id:values[2],project_id:values[3],provider:values[4],source_id:values[5],idempotency_key:values[6],request_hash:values[7],state:'importing',upload_id:null,lease_until:new Date(Date.now()+300000)};return{rows:[]};}
    if(sql.startsWith('SELECT * FROM uploads WHERE id=$1 FOR UPDATE'))return{rows:[uploadRow]};
    if(sql.startsWith("UPDATE uploads SET state='confirmed'")){uploadRow.state='confirmed';uploadRow.etag='fixture-etag';return{rows:[{id:uploadRow.id}]};}
    if(sql.startsWith('UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$1,used_bytes=used_bytes+$2'))return{rows:[]};
    if(sql.startsWith('INSERT INTO inspection_requests')){inspectionRequests.push({uploadId:values[0],correlationId:values[1],deliveredAt:null});return{rows:[]};}
    if(sql.startsWith("UPDATE source_imports SET state='succeeded'")){sourceImport.state='succeeded';return{rows:[{id:sourceImport.id}]};}
    return{rows:[]};
  }});
  service.resolveTwitchImport=async(_req,_projectId,clipId)=>{assert.equal(clipId,'FixtureClip_123');return{available:true,broadcasterId:'42',title:'Fixture highlight',durationSeconds:20,downloadUrl:'https://production.assets.clips.twitchcdn.net/signed/fixture.mp4'};};
  service.sourceAssetDownloader=async url=>{downloads++;assert.equal(new URL(url).hostname,'production.assets.clips.twitchcdn.net');return{path,bytes:bytes.length,sha256:hash,contentType:'video/mp4',cleanup:async()=>{cleanup++;}};};
  service.beginUpload=async(_req,projectId,input,sourceImportId)=>{assert.equal(projectId,'project-id');assert.equal(sourceImportId,sourceImport.id);assert.deepEqual(input,{bytes:bytes.length,sha256:hash,contentType:'video/mp4',mode:'put'});sourceImport.upload_id='upload-id';return{id:'upload-id'};};
  service.pool={query:async(sql,values=[])=>{
    if(sql.startsWith('SELECT * FROM uploads'))return{rows:[uploadRow]};
    if(sql.startsWith('SELECT delivered_at FROM inspection_requests'))return{rows:inspectionRequests[0]?[{delivered_at:inspectionRequests[0].deliveredAt}]:[]};
    if(sql.startsWith('UPDATE source_imports SET state=\'succeeded\'')){sourceImport.state='succeeded';sourceImport.upload_id=values[0];return{rows:[]};}
    return{rows:[]};
  }};
  service.importS3={send:async command=>{s3Puts++;assert.equal(command.input.Bucket,service.bucket);assert.equal(command.input.ContentType,'video/mp4');assert.equal(command.input.ContentLength,bytes.length);assert.equal(command.input.ChecksumSHA256,Buffer.from(hash,'hex').toString('base64'));const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);return{};}};
  service.bucket='private-media';service.s3={send:async()=>({ContentLength:bytes.length,ETag:'fixture-etag',ChecksumSHA256:Buffer.from(hash,'hex').toString('base64')})};service.upload=async(_req,uploadId,minimum='reader')=>{assert.equal(uploadId,'upload-id');assert.ok(minimum==='reader'||minimum==='editor');return uploadRow;};service.abort=async()=>assert.fail('successful import must not abort');
  const request=requestWithCsrf(service.config);request.headers['idempotency-key']=idempotencyKey;
  const first=await service.importSourceLink(request,'project-id',{url:clipUrl},'fixture-correlation');
  assert.equal(first.state,'succeeded');assert.equal(first.uploadId,'upload-id');assert.equal(first.inspection.status,'queued');assert.equal(first.title,'Fixture highlight');assert.equal(first.durationSeconds,20);
  assert.equal(sourceImport.provider,'twitch');assert.equal(sourceImport.source_id,'FixtureClip_123');assert.equal(sourceImport.state,'succeeded');assert.equal(uploadRow.state,'confirmed');assert.deepEqual(inspectionRequests,[{uploadId:'upload-id',correlationId:'fixture-correlation',deliveredAt:null}]);assert.equal(s3Puts,1);assert.equal(downloads,1);assert.equal(cleanup,1);

  const queued=await service.status(request,'upload-id');assert.equal(queued.inspection.status,'queued');
  let inspectionReady=false;
  const pipelinePool={
    async query(sql){
      if(sql.startsWith('SELECT * FROM pipelines WHERE creator_id'))return{rows:[]};
      if(sql.startsWith("SELECT id,status,settled_at,result,error_code,spec->>'kind'"))return{rows:[]};
      if(sql.startsWith('SELECT id,finished_at,cached_status FROM analysis_requests'))return{rows:[]};
      if(sql.startsWith('SELECT version,status,at FROM pipeline_events'))return{rows:[{version:1,status:'queued',at:new Date()}]};
      throw new Error(`Unexpected pipeline pool query: ${sql}`);
    },
    async connect(){
      const client={
        async query(sql,values=[]){
          if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
          if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
          if(sql.startsWith('SELECT * FROM pipelines WHERE creator_id'))return{rows:[]};
          if(sql.startsWith('SELECT workspace_id FROM workspace_storage'))return{rows:[{workspace_id:'workspace-id'}]};
          if(sql.startsWith('SELECT count(*) FROM pipelines'))return{rows:[{count:'0'}]};
          if(sql.startsWith('UPDATE workspace_storage SET reserved_bytes='))return{rows:[{workspace_id:'workspace-id'}]};
          if(sql.startsWith('INSERT INTO pipelines('))return{rows:[{id:values[0],upload_id:values[1],project_id:values[2],workspace_id:values[3],creator_id:values[4],request_hash:values[6],spec:values[7],correlation_id:values[8],remaining_reservation_bytes:values[9],cancel_requested:false,status:'queued',version:1,error_code:null,created_at:new Date(),deadline_at:new Date(Date.now()+30*60_000),finished_at:null,usage_state:'pending',usage_spec:values[10],usage_error:null}]};
          if(sql.startsWith('INSERT INTO pipeline_events'))return{rows:[]};
          throw new Error(`Unexpected pipeline transaction query: ${sql}`);
        },release(){}
      };
      return client;
    }
  };
  const pipelineConfig={...service.config,IDENTITY_URL:'http://identity.fixture',INTERNAL_TOKEN:'fixture-internal-token'};
  const pipelineManager=new PipelineManager(pipelinePool,pipelineConfig,'http://analysis.fixture',{sourceForEditor:async(_req,uploadId)=>{assert.equal(uploadId,first.uploadId);if(!inspectionReady)throw new ConflictException();return{upload:uploadRow,metadata:{durationSeconds:20,width:1280,height:720,audioCodec:'aac'}};}},{});
  request.headers.cookie+=`; ${cookieName('access')}=fixture-access-token`;
  const pipelineSpec={version:1,provider:'whisper_cpp',language:'es',selection:{mode:'none'},startSeconds:0,endSeconds:10,aspect:'vertical'};
  const originalFetch=globalThis.fetch;
  let preflightSpec;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.origin==='http://media.fixture'&&url.pathname==='/v1/internal/inspection-status')return globalThis.Response.json({status:'succeeded',result:{durationSeconds:20,width:1280,height:720,audioCodec:'aac'}});
    if(url.origin==='http://identity.fixture'&&url.pathname==='/v1/internal/authenticate')return globalThis.Response.json({id:'user-id',email:'user@example.test'});
    if(url.origin==='http://analysis.fixture'&&url.pathname==='/v1/internal/analysis-preflight'){preflightSpec=JSON.parse(init.body).spec;return globalThis.Response.json({ready:true,code:null,httpStatus:200});}
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
  await assert.rejects(pipelineManager.begin(request,first.uploadId,pipelineSpec,'fixture-correlation'),error=>error.getStatus?.()===409,'the standard pipeline must wait for successful inspection');
  inspectionRequests[0].deliveredAt=new Date();inspectionReady=true;
    service.mediaUrl='http://media.fixture';
    const inspected=await service.status(request,'upload-id');assert.equal(inspected.inspection.status,'succeeded');
    const pipeline=await pipelineManager.begin(request,first.uploadId,pipelineSpec,'fixture-correlation');
    assert.equal(pipeline.status,'queued');assert.equal(pipeline.spec.version,1);assert.deepEqual(preflightSpec.selection,{mode:'none'});
  } finally {globalThis.fetch=originalFetch;}

  const retry=await service.importSourceLink(request,'project-id',{url:clipUrl},'fixture-correlation');
  assert.equal(retry.duplicate,true);assert.equal(retry.uploadId,'upload-id');assert.equal(s3Puts,1);assert.equal(downloads,1);
  const differentKey=requestWithCsrf(service.config);differentKey.headers['idempotency-key']=randomUUID();
  const sameClip=await service.importSourceLink(differentKey,'project-id',{url:clipUrl},'fixture-correlation');
  assert.equal(sameClip.duplicate,true);assert.equal(sameClip.uploadId,'upload-id');assert.equal(s3Puts,1);assert.equal(downloads,1);
  await assert.rejects(service.importSourceLink(request,'project-id',{url:'https://clips.twitch.tv/DifferentClip'},'fixture-correlation'),error=>error.getStatus?.()===409);
  assert.equal(s3Puts,1);assert.equal(downloads,1);
});

function twitchVodImportFixture(createResult) {
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  const userId='user-id',projectId='project-id',workspaceId='workspace-id',idempotencyKey=randomUUID(),vodUrl='https://www.twitch.tv/videos/2916449488';
  const input={url:vodUrl,vodOffsetSeconds:125,durationSeconds:30,title:'Fixture VOD excerpt'};
  const request=requestWithCsrf(service.config);request.headers['idempotency-key']=idempotencyKey;
  const requestHash=createHash('sha256').update(JSON.stringify({projectId,provider:'twitch',vodId:'2916449488',vodOffsetSeconds:125,durationSeconds:30,title:input.title})).digest('hex');
  const sourceImport={id:'source-vod-import-id',creator_id:userId,workspace_id:workspaceId,project_id:projectId,provider:'twitch',source_id:'vod:2916449488:125:30',idempotency_key:idempotencyKey,request_hash:requestHash,state:'importing',upload_id:null,provider_resource_id:null,external_effect_started_at:null,lease_until:new Date(Date.now()+300000)};
  let inserted=false;
  service.project=async()=>({user:{id:userId},project:{id:projectId,workspace_id:workspaceId}});
  service.tx=async work=>work({query:async(sql,values=[])=>{
    if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
    if(sql.includes('SELECT id,request_hash,state,upload_id,lease_until,'))return{rows:inserted&&sourceImport.creator_id===values[0]&&sourceImport.idempotency_key===values[1]?[{...sourceImport}]:[]};
    if(sql.includes('SELECT id,state,upload_id,lease_until,'))return{rows:inserted?[{...sourceImport}]:[]};
    if(sql.startsWith('INSERT INTO source_imports')){sourceImport.id=values[0];inserted=true;return{rows:[]};}
    if(sql.startsWith("UPDATE source_imports SET state='importing'")){sourceImport.state='importing';sourceImport.error_code=null;sourceImport.lease_until=new Date(Date.now()+300000);return{rows:[]};}
    if(sql.startsWith("UPDATE source_imports SET state='failed',error_code='TWITCH_VOD_CLIP_OUTCOME_UNKNOWN'")){sourceImport.state='failed';sourceImport.error_code='TWITCH_VOD_CLIP_OUTCOME_UNKNOWN';sourceImport.lease_until=new Date();return{rows:[]};}
    throw new Error(`Unexpected VOD transaction query: ${sql}`);
  }});
  let createCalls=0,resolveCalls=[];
  service.createTwitchVodClip=async(_request,_projectId,values)=>{createCalls++;assert.deepEqual(values,{vodId:'2916449488',vodOffsetSeconds:125,durationSeconds:30,title:input.title});return typeof createResult==='function'?createResult():createResult;};
  service.resolveTwitchImport=async(_request,_projectId,clipId)=>{resolveCalls.push(clipId);return{available:false,reasonCode:'TWITCH_CLIP_NOT_FOUND'};};
  service.sourceAssetDownloader=async()=>assert.fail('the fixture stops before the Twitch clip becomes downloadable');
  service.pool={query:async(sql,values=[])=>{
    if(sql.startsWith('SELECT used_bytes,reserved_bytes FROM workspace_storage'))return{rows:[{used_bytes:'0',reserved_bytes:'0'}]};
    if(sql.startsWith("UPDATE source_imports SET external_effect_started_at=")){sourceImport.external_effect_started_at??=new Date();return{rows:[{id:sourceImport.id}]};}
    if(sql.startsWith('UPDATE source_imports SET provider_resource_id=')){sourceImport.provider_resource_id=values[0];sourceImport.error_code=null;return{rows:[{id:sourceImport.id}]};}
    if(sql.startsWith("UPDATE source_imports SET state='failed'")){sourceImport.state='failed';sourceImport.error_code=values[0];sourceImport.lease_until=new Date();return{rows:[{id:sourceImport.id}]};}
    throw new Error(`Unexpected VOD pool query: ${sql}`);
  }};
  return{service,request,input,createCalls:()=>createCalls,resolveCalls:()=>resolveCalls,sourceImport};
}

test('YouTube video import fixture stores verified bytes privately, confirms inspection, and deduplicates retries',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'twitch-import-fixture-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const bytes=Buffer.alloc(32);bytes.write('ftyp',4,'ascii');const path=join(directory,'fixture.mp4');await writeFile(path,bytes);
  const hash=createHash('sha256').update(bytes).digest('hex'),idempotencyKey=randomUUID(),clipUrl='https://www.youtube.com/watch?v=abcdefghijk';
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key',INTERNAL_TOKEN:'fixture-internal-token'};
  service.project=async(_req,projectId)=>({user:{id:'user-id'},project:{id:projectId,workspace_id:'workspace-id'}});
  const uploadRow={id:'upload-id',creator_id:'user-id',project_id:'project-id',workspace_id:'workspace-id',object_key:'workspaces/workspace-id/media/uploads/upload-id/source.media',expected_bytes:bytes.length,sha256:hash,content_type:'video/mp4',mode:'put',upload_id:null,state:'pending',etag:null,expires_at:new Date(Date.now()+60_000),signed_until:new Date(Date.now()+60_000),request_hash:'a'.repeat(64)};
  const inspectionRequests=[];
  let sourceImport,s3Puts=0,downloads=0,cleanup=0;
  service.tx=async work=>work({query:async(sql,values=[])=>{
    if(sql.includes('SELECT id,request_hash,state,upload_id,lease_until,'))return{rows:sourceImport&&sourceImport.creator_id===values[0]&&sourceImport.idempotency_key===values[1]?[{...sourceImport}]:[]};
    if(sql.includes('SELECT id,state,upload_id,lease_until,'))return{rows:sourceImport?[{id:sourceImport.id,state:sourceImport.state,upload_id:sourceImport.upload_id,lease_until:sourceImport.lease_until,provider_resource_id:sourceImport.provider_resource_id??null,external_effect_started_at:sourceImport.external_effect_started_at??null}]:[]};
    if(sql.includes('INSERT INTO source_imports')){sourceImport={id:values[0],creator_id:values[1],workspace_id:values[2],project_id:values[3],provider:values[4],source_id:values[5],idempotency_key:values[6],request_hash:values[7],state:'importing',upload_id:null,lease_until:new Date(Date.now()+300000)};return{rows:[]};}
    if(sql.startsWith('SELECT * FROM uploads WHERE id=$1 FOR UPDATE'))return{rows:[uploadRow]};
    if(sql.startsWith("UPDATE uploads SET state='confirmed'")){uploadRow.state='confirmed';uploadRow.etag='fixture-etag';return{rows:[{id:uploadRow.id}]};}
    if(sql.startsWith('UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$1,used_bytes=used_bytes+$2'))return{rows:[]};
    if(sql.startsWith('INSERT INTO inspection_requests')){inspectionRequests.push({uploadId:values[0],correlationId:values[1],deliveredAt:null});return{rows:[]};}
    if(sql.startsWith("UPDATE source_imports SET state='succeeded'")){sourceImport.state='succeeded';return{rows:[{id:sourceImport.id}]};}
    return{rows:[]};
  }});
  service.resolveTwitchImport=async(_req,_projectId,clipId)=>{assert.equal(clipId,'FixtureClip_123');return{available:true,broadcasterId:'42',title:'Fixture highlight',durationSeconds:20,downloadUrl:'https://production.assets.clips.twitchcdn.net/signed/fixture.mp4'};};
  service.youtubeSourceDownloader=async (id,options)=>{downloads++;assert.equal(id,'abcdefghijk');assert.ok(options.maxBytes>0);return{path,bytes:bytes.length,sha256:hash,contentType:'video/mp4',cleanup:async()=>{cleanup++;}};};
  service.beginUpload=async(_req,projectId,input,sourceImportId)=>{assert.equal(projectId,'project-id');assert.equal(sourceImportId,sourceImport.id);assert.deepEqual(input,{bytes:bytes.length,sha256:hash,contentType:'video/mp4',mode:'put'});sourceImport.upload_id='upload-id';return{id:'upload-id'};};
  service.pool={query:async(sql,values=[])=>{
    if(sql.startsWith('SELECT * FROM uploads'))return{rows:[uploadRow]};
    if(sql.startsWith('SELECT delivered_at FROM inspection_requests'))return{rows:inspectionRequests[0]?[{delivered_at:inspectionRequests[0].deliveredAt}]:[]};
    if(sql.startsWith('UPDATE source_imports SET state=\'succeeded\'')){sourceImport.state='succeeded';sourceImport.upload_id=values[0];return{rows:[]};}
    return{rows:[]};
  }};
  service.importS3={send:async command=>{s3Puts++;assert.equal(command.input.Bucket,service.bucket);assert.equal(command.input.ContentType,'video/mp4');assert.equal(command.input.ContentLength,bytes.length);assert.equal(command.input.ChecksumSHA256,Buffer.from(hash,'hex').toString('base64'));const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);return{};}};
  service.bucket='private-media';service.s3={send:async()=>({ContentLength:bytes.length,ETag:'fixture-etag',ChecksumSHA256:Buffer.from(hash,'hex').toString('base64')})};service.upload=async(_req,uploadId,minimum='reader')=>{assert.equal(uploadId,'upload-id');assert.ok(minimum==='reader'||minimum==='editor');return uploadRow;};service.abort=async()=>assert.fail('successful import must not abort');
  const request=requestWithCsrf(service.config);request.headers['idempotency-key']=idempotencyKey;
  const first=await service.importSourceLink(request,'project-id',{url:clipUrl},'fixture-correlation');
  assert.equal(first.state,'succeeded');assert.equal(first.uploadId,'upload-id');assert.equal(first.inspection.status,'queued');assert.equal(first.title,'YouTube abcdefghijk');
  assert.equal(sourceImport.provider,'youtube');assert.equal(sourceImport.source_id,'abcdefghijk');assert.equal(sourceImport.state,'succeeded');assert.equal(uploadRow.state,'confirmed');assert.deepEqual(inspectionRequests,[{uploadId:'upload-id',correlationId:'fixture-correlation',deliveredAt:null}]);assert.equal(s3Puts,1);assert.equal(downloads,1);assert.equal(cleanup,1);

  const queued=await service.status(request,'upload-id');assert.equal(queued.inspection.status,'queued');
  let inspectionReady=false;
  const pipelinePool={
    async query(sql){
      if(sql.startsWith('SELECT * FROM pipelines WHERE creator_id'))return{rows:[]};
      if(sql.startsWith("SELECT id,status,settled_at,result,error_code,spec->>'kind'"))return{rows:[]};
      if(sql.startsWith('SELECT id,finished_at,cached_status FROM analysis_requests'))return{rows:[]};
      if(sql.startsWith('SELECT version,status,at FROM pipeline_events'))return{rows:[{version:1,status:'queued',at:new Date()}]};
      throw new Error(`Unexpected pipeline pool query: ${sql}`);
    },
    async connect(){
      const client={
        async query(sql,values=[]){
          if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
          if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
          if(sql.startsWith('SELECT * FROM pipelines WHERE creator_id'))return{rows:[]};
          if(sql.startsWith('SELECT workspace_id FROM workspace_storage'))return{rows:[{workspace_id:'workspace-id'}]};
          if(sql.startsWith('SELECT count(*) FROM pipelines'))return{rows:[{count:'0'}]};
          if(sql.startsWith('UPDATE workspace_storage SET reserved_bytes='))return{rows:[{workspace_id:'workspace-id'}]};
          if(sql.startsWith('INSERT INTO pipelines('))return{rows:[{id:values[0],upload_id:values[1],project_id:values[2],workspace_id:values[3],creator_id:values[4],request_hash:values[6],spec:values[7],correlation_id:values[8],remaining_reservation_bytes:values[9],cancel_requested:false,status:'queued',version:1,error_code:null,created_at:new Date(),deadline_at:new Date(Date.now()+30*60_000),finished_at:null,usage_state:'pending',usage_spec:values[10],usage_error:null}]};
          if(sql.startsWith('INSERT INTO pipeline_events'))return{rows:[]};
          throw new Error(`Unexpected pipeline transaction query: ${sql}`);
        },release(){}
      };
      return client;
    }
  };
  const pipelineConfig={...service.config,IDENTITY_URL:'http://identity.fixture',INTERNAL_TOKEN:'fixture-internal-token'};
  const pipelineManager=new PipelineManager(pipelinePool,pipelineConfig,'http://analysis.fixture',{sourceForEditor:async(_req,uploadId)=>{assert.equal(uploadId,first.uploadId);if(!inspectionReady)throw new ConflictException();return{upload:uploadRow,metadata:{durationSeconds:20,width:1280,height:720,audioCodec:'aac'}};}},{});
  request.headers.cookie+=`; ${cookieName('access')}=fixture-access-token`;
  const pipelineSpec={version:1,provider:'whisper_cpp',language:'es',selection:{mode:'none'},startSeconds:0,endSeconds:10,aspect:'vertical'};
  const originalFetch=globalThis.fetch;
  let preflightSpec;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.origin==='http://media.fixture'&&url.pathname==='/v1/internal/inspection-status')return globalThis.Response.json({status:'succeeded',result:{durationSeconds:20,width:1280,height:720,audioCodec:'aac'}});
    if(url.origin==='http://identity.fixture'&&url.pathname==='/v1/internal/authenticate')return globalThis.Response.json({id:'user-id',email:'user@example.test'});
    if(url.origin==='http://analysis.fixture'&&url.pathname==='/v1/internal/analysis-preflight'){preflightSpec=JSON.parse(init.body).spec;return globalThis.Response.json({ready:true,code:null,httpStatus:200});}
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
  await assert.rejects(pipelineManager.begin(request,first.uploadId,pipelineSpec,'fixture-correlation'),error=>error.getStatus?.()===409,'the standard pipeline must wait for successful inspection');
  inspectionRequests[0].deliveredAt=new Date();inspectionReady=true;
    service.mediaUrl='http://media.fixture';
    const inspected=await service.status(request,'upload-id');assert.equal(inspected.inspection.status,'succeeded');
    const pipeline=await pipelineManager.begin(request,first.uploadId,pipelineSpec,'fixture-correlation');
    assert.equal(pipeline.status,'queued');assert.equal(pipeline.spec.version,1);assert.deepEqual(preflightSpec.selection,{mode:'none'});
  } finally {globalThis.fetch=originalFetch;}

  const retry=await service.importSourceLink(request,'project-id',{url:clipUrl},'fixture-correlation');
  assert.equal(retry.duplicate,true);assert.equal(retry.uploadId,'upload-id');assert.equal(s3Puts,1);assert.equal(downloads,1);
  const differentKey=requestWithCsrf(service.config);differentKey.headers['idempotency-key']=randomUUID();
  const sameClip=await service.importSourceLink(differentKey,'project-id',{url:clipUrl},'fixture-correlation');
  assert.equal(sameClip.duplicate,true);assert.equal(sameClip.uploadId,'upload-id');assert.equal(s3Puts,1);assert.equal(downloads,1);
  await assert.rejects(service.importSourceLink(request,'project-id',{url:'https://youtu.be/lmnopqrstuv'},'fixture-correlation'),error=>error.getStatus?.()===409);
  assert.equal(s3Puts,1);assert.equal(downloads,1);
});


test('Twitch VOD interval creates one official clip, stores its verified MP4 privately and queues inspection',async t=>{
  const fixture=twitchVodImportFixture({state:'created',clipId:'CreatedClip_42',broadcasterId:'424242',title:'Fixture VOD excerpt',durationSeconds:30});
  const directory=await mkdtemp(join(tmpdir(),'twitch-vod-import-fixture-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const bytes=Buffer.alloc(32);bytes.write('ftyp',4,'ascii');const path=join(directory,'fixture.mp4');await writeFile(path,bytes);
  const hash=createHash('sha256').update(bytes).digest('hex');
  const upload={id:'vod-upload-id',creator_id:'user-id',project_id:'project-id',workspace_id:'workspace-id',object_key:'workspaces/workspace-id/media/uploads/vod-upload-id/source.media',expected_bytes:bytes.length,sha256:hash,content_type:'video/mp4',state:'pending'};
  let downloads=0,puts=0,cleanups=0,confirmed=false;
  fixture.service.resolveTwitchImport=async(_request,_projectId,clipId)=>{fixture.resolveCalls().push(clipId);assert.equal(clipId,'CreatedClip_42');return{available:true,broadcasterId:'424242',title:'Fixture VOD excerpt',durationSeconds:30,downloadUrl:'https://production.assets.clips.twitchcdn.net/signed/vod-fixture.mp4'};};
  fixture.service.sourceAssetDownloader=async(url,options)=>{downloads++;assert.equal(new URL(url).hostname,'production.assets.clips.twitchcdn.net');assert.equal(options.limitExceededCode,'TWITCH_DOWNLOAD_TOO_LARGE');return{path,bytes:bytes.length,sha256:hash,contentType:'video/mp4',cleanup:async()=>{cleanups++;}};};
  fixture.service.beginUpload=async(_request,projectId,input,sourceImportId)=>{assert.equal(projectId,'project-id');assert.equal(sourceImportId,fixture.sourceImport.id);assert.deepEqual(input,{bytes:bytes.length,sha256:hash,contentType:'video/mp4',mode:'put'});fixture.sourceImport.upload_id=upload.id;return{id:upload.id};};
  fixture.service.pool={query:async(sql,values=[])=>{
    if(sql.startsWith('SELECT used_bytes,reserved_bytes FROM workspace_storage'))return{rows:[{used_bytes:'0',reserved_bytes:'0'}]};
    if(sql.startsWith("UPDATE source_imports SET external_effect_started_at=")){fixture.sourceImport.external_effect_started_at??=new Date();return{rows:[{id:fixture.sourceImport.id}]};}
    if(sql.startsWith('UPDATE source_imports SET provider_resource_id=')){fixture.sourceImport.provider_resource_id=values[0];return{rows:[{id:fixture.sourceImport.id}]};}
    if(sql.startsWith('SELECT * FROM uploads WHERE id=$1 AND creator_id=$2 AND project_id=$3'))return{rows:[upload]};
    if(sql.startsWith("UPDATE source_imports SET state='failed'"))return{rows:[{id:fixture.sourceImport.id}]};
    throw new Error(`Unexpected successful VOD pool query: ${sql}`);
  }};
  fixture.service.bucket='private-media';
  fixture.service.importS3={send:async command=>{puts++;assert.equal(command.input.Bucket,'private-media');assert.equal(command.input.Key,upload.object_key);assert.equal(command.input.ContentType,'video/mp4');assert.equal(command.input.ContentLength,bytes.length);assert.equal(command.input.ChecksumSHA256,Buffer.from(hash,'hex').toString('base64'));const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);return{};}};
  fixture.service.confirm=async(_request,uploadId,correlationId,sourceImportId)=>{assert.equal(uploadId,upload.id);assert.equal(correlationId,'fixture-correlation');assert.equal(sourceImportId,fixture.sourceImport.id);confirmed=true;upload.state='confirmed';fixture.sourceImport.state='succeeded';};

  const result=await fixture.service.importSourceLink(fixture.request,'project-id',fixture.input,'fixture-correlation');
  assert.equal(result.state,'succeeded');assert.equal(result.uploadId,upload.id);assert.deepEqual(result.inspection,{status:'queued'});
  assert.equal(fixture.sourceImport.provider_resource_id,'CreatedClip_42');assert.equal(fixture.sourceImport.state,'succeeded');
  assert.equal(fixture.createCalls(),1);assert.deepEqual(fixture.resolveCalls(),['CreatedClip_42']);
  assert.equal(downloads,1);assert.equal(puts,1);assert.equal(confirmed,true);assert.equal(cleanups,1);
});

test('Twitch VOD import persists the generated clip ID before download and retries that ID without creating a duplicate',async()=>{
  const fixture=twitchVodImportFixture({state:'created',clipId:'CreatedClip_42',broadcasterId:'424242',title:'Fixture VOD excerpt',durationSeconds:30});
  await assert.rejects(fixture.service.importSourceLink(fixture.request,'project-id',fixture.input,'fixture-correlation'),error=>error.getStatus?.()===404&&error.getResponse?.().code==='TWITCH_CLIP_NOT_FOUND');
  assert.equal(fixture.createCalls(),1);assert.equal(fixture.sourceImport.provider_resource_id,'CreatedClip_42');assert.ok(fixture.sourceImport.external_effect_started_at);
  await assert.rejects(fixture.service.importSourceLink(fixture.request,'project-id',fixture.input,'fixture-correlation'),error=>error.getStatus?.()===404&&error.getResponse?.().code==='TWITCH_CLIP_NOT_FOUND');
  assert.equal(fixture.createCalls(),1,'the retry must download the persisted Twitch clip ID, never POST a second clip');assert.deepEqual(fixture.resolveCalls(),['CreatedClip_42','CreatedClip_42']);
});

test('uncertain Twitch VOD clip creation remains deduplicated and never repeats the external POST',async()=>{
  const fixture=twitchVodImportFixture({state:'outcome_unknown',reasonCode:'TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN'});
  await assert.rejects(fixture.service.importSourceLink(fixture.request,'project-id',fixture.input,'fixture-correlation'),error=>error.getStatus?.()===503&&error.getResponse?.().code==='TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN');
  assert.equal(fixture.createCalls(),1);assert.ok(fixture.sourceImport.external_effect_started_at);assert.equal(fixture.sourceImport.provider_resource_id,null);
  await assert.rejects(fixture.service.importSourceLink(fixture.request,'project-id',fixture.input,'fixture-correlation'),error=>error.getStatus?.()===409&&error.getResponse?.().code==='TWITCH_VOD_CLIP_OUTCOME_UNKNOWN');
  assert.equal(fixture.createCalls(),1,'unknown external outcomes are not retried because Twitch may have created the clip');
});

test('quota rejection after VOD clip creation retains its ID and retries download without another remote clip',async()=>{
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  const projectId='project-id',userId='user-id',workspaceId='workspace-id',url='https://www.twitch.tv/videos/2916449488',input={url,vodOffsetSeconds:125,durationSeconds:30,title:'Fixture VOD excerpt'},key=randomUUID();
  const request=requestWithCsrf(service.config);request.headers['idempotency-key']=key;
  let sourceImport=null,createCalls=0,quotaChecks=0,reservations=0,downloads=0,cleanups=0;const resolvedClipIds=[];
  service.project=async()=>({user:{id:userId},project:{id:projectId,workspace_id:workspaceId}});
  service.tx=async work=>work({query:async(sql,values=[])=>{
    if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
    if(sql.includes('SELECT id,request_hash,state,upload_id,lease_until,'))return{rows:sourceImport?.creator_id===values[0]&&sourceImport.idempotency_key===values[1]?[{...sourceImport}]:[]};
    if(sql.includes('SELECT id,state,upload_id,lease_until,'))return{rows:sourceImport?[{...sourceImport}]:[]};
    if(sql.startsWith('SELECT * FROM uploads WHERE creator_id=$1 AND idempotency_key=$2'))return{rows:[]};
    if(sql.startsWith('INSERT INTO workspace_storage(workspace_id)'))return{rows:[]};
    if(sql.startsWith('UPDATE workspace_storage SET reserved_bytes=reserved_bytes+$1')){reservations++;assert.equal(values[0],32);assert.equal(values[1],workspaceId);return{rows:[]};}
    if(sql.startsWith('INSERT INTO source_imports')){sourceImport={id:values[0],creator_id:values[1],workspace_id:values[2],project_id:values[3],provider:values[4],source_id:values[5],idempotency_key:values[6],request_hash:values[7],state:'importing',upload_id:null,provider_resource_id:null,external_effect_started_at:null,lease_until:new Date(Date.now()+300000)};return{rows:[]};}
    if(sql.startsWith("UPDATE source_imports SET state='importing'")){sourceImport.state='importing';sourceImport.error_code=null;sourceImport.lease_until=new Date(Date.now()+300000);return{rows:[]};}
    if(sql.startsWith("UPDATE source_imports SET creator_id=$1,idempotency_key=$2,request_hash=$3,state='importing'")){sourceImport.creator_id=values[0];sourceImport.idempotency_key=values[1];sourceImport.request_hash=values[2];sourceImport.state='importing';return{rows:[]};}
    throw new Error(`Unexpected quota retry transaction query: ${sql}`);
  }});
  service.pool={query:async(sql,values=[])=>{
    if(sql.startsWith('SELECT used_bytes,reserved_bytes FROM workspace_storage')){quotaChecks++;return{rows:[{used_bytes:'0',reserved_bytes:'0'}]};}
    if(sql.startsWith("UPDATE source_imports SET external_effect_started_at=")){sourceImport.external_effect_started_at??=new Date();return{rows:[{id:sourceImport.id}]};}
    if(sql.startsWith('UPDATE source_imports SET provider_resource_id=')){sourceImport.provider_resource_id=values[0];return{rows:[{id:sourceImport.id}]};}
    if(sql.startsWith("UPDATE source_imports SET state='failed'")){sourceImport.state='failed';sourceImport.error_code=values[0];sourceImport.lease_until=new Date();return{rows:[{id:sourceImport.id}]};}
    throw new Error(`Unexpected quota retry pool query: ${sql}`);
  }};
  service.createTwitchVodClip=async()=>{createCalls++;return{state:'created',clipId:'CreatedClip_42',broadcasterId:'424242',title:input.title,durationSeconds:30};};
  service.resolveTwitchImport=async(_req,_project,clipId)=>{resolvedClipIds.push(clipId);return{available:true,broadcasterId:'424242',title:input.title,durationSeconds:30,downloadUrl:'https://production.assets.clips.twitchcdn.net/signed/fixture.mp4'};};
  service.sourceAssetDownloader=async()=>{downloads++;return{path:'unused-fixture-path',bytes:32,sha256:'a'.repeat(64),contentType:'video/mp4',cleanup:async()=>{cleanups++;}};};

  const retryRequest=requestWithCsrf(service.config);retryRequest.headers['idempotency-key']=randomUUID();
  for(const attemptRequest of [request,retryRequest]){
    await assert.rejects(service.importSourceLink(attemptRequest,projectId,input,'fixture-correlation'),error=>error.getStatus?.()===409&&error.getResponse?.().code==='PROJECT_STORAGE_QUOTA_EXCEEDED');
    assert.equal(sourceImport.state,'failed');
    assert.equal(sourceImport.provider_resource_id,'CreatedClip_42','the remote clip ID stays linked to the failed import');
  }
  assert.equal(createCalls,1,'retry never repeats Twitch Create Clip From VOD');
  assert.deepEqual(resolvedClipIds,['CreatedClip_42','CreatedClip_42']);
  assert.equal(quotaChecks,2);assert.equal(reservations,2);assert.equal(downloads,2);assert.equal(cleanups,2);
});

test('source upload reservation links its import row inside the same transaction',async()=>{
  const service=Object.create(ProjectService.prototype);service.config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-signing-key'};
  service.project=async()=>({user:{id:'user-id'},project:{id:'project-id',workspace_id:'workspace-id'}});
  const calls=[];let transaction=false,createdUpload;
  service.tx=async work=>{transaction=true;try{return await work({query:async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.startsWith('SELECT * FROM uploads WHERE creator_id'))return{rows:[]};
    if(sql.startsWith('UPDATE workspace_storage'))return{rows:[{workspace_id:'workspace-id'}]};
    if(sql.startsWith('INSERT INTO uploads')){createdUpload={id:values[0],mode:'multipart',upload_id:'fixture-multipart',expected_bytes:32,expires_at:new Date(Date.now()+60000)};return{rows:[createdUpload]};}
    if(sql.startsWith('UPDATE source_imports SET upload_id=')){assert.equal(transaction,true);return{rows:[{id:values[1]}]};}
    return{rows:[]};
  }});}finally{transaction=false;}};
  const request=requestWithCsrf(service.config);request.headers['idempotency-key']=randomUUID();
  const result=await service.beginUpload(request,'project-id',{bytes:32,sha256:'a'.repeat(64),contentType:'video/mp4',mode:'multipart'},'source-import-id');
  assert.equal(result.id,createdUpload.id);assert.equal(result.mode,'multipart');
  const insertAt=calls.findIndex(call=>call.sql.startsWith('INSERT INTO uploads'));
  const linkAt=calls.findIndex(call=>call.sql.startsWith('UPDATE source_imports SET upload_id='));
  assert.ok(insertAt>=0&&linkAt>insertAt);assert.deepEqual(calls[linkAt].values,[createdUpload.id,'source-import-id']);
});
