import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {configureHttp} from '@autoclipper/observability';
import {loadGatewayConfig,seal} from '@autoclipper/http-security';
import {InspectionController} from '../../apps/autoclipper-media-processing-service/dist/interfaces/inspection.controller.js';
import {InspectionRuntime} from '../../apps/autoclipper-media-processing-service/dist/application/inspection-runtime.js';
import {AnalysisController} from '../../apps/autoclipper-content-analysis-service/dist/interfaces/analysis.controller.js';
import {AnalysisRuntime} from '../../apps/autoclipper-content-analysis-service/dist/application/analysis-runtime.js';

export async function verifyTaskPrivacy(config,identityBase,clientFactory,encryptionKey){
  const url=(owner,role)=>`postgresql://autoclipper_${owner}_${role}:${config.password}@target-pg:5432/autoclipper_${owner}`;
  const identity=new pg.Pool({connectionString:url('identity','runtime')}),media=new pg.Pool({connectionString:url('media','runtime')}),analysis=new pg.Pool({connectionString:url('analysis','runtime')});
  const userId=randomUUID(),peerId=randomUUID(),ownInspection=randomUUID(),peerInspection=randomUUID(),legacyInspection=randomUUID(),ownProcessing=randomUUID(),peerProcessing=randomUUID(),ownJob=randomUUID(),peerJob=randomUUID(),workspaceId=randomUUID(),peerWorkspace=randomUUID();
  const password=`TaskPrivacy-${randomBytes(16).toString('hex')}`,email=`media-${randomUUID()}@example.test`,peerEmail=`peer-${randomUUID()}@example.test`,secret=`PRIVATE_ANALYSIS_${randomUUID()}`;
  const factors=Array.from({length:20},()=>randomBytes(12).toString('hex'));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  let mediaApp,analysisApp,checkpoint='SEED';
  const mediaConfig={INTERNAL_TOKEN:config.internalToken};
  const startMedia=async()=>{class MediaModule{}Module({controllers:[InspectionController],providers:[{provide:InspectionRuntime,useValue:{pool:media,config:mediaConfig}}]})(MediaModule);mediaApp=await NestFactory.create(MediaModule,{logger:false,abortOnError:false});configureHttp(mediaApp,loadGatewayConfig(),'media-privacy-fixture');await mediaApp.listen(0,'127.0.0.1');process.env.MEDIA_URL=(await mediaApp.getUrl())+'/v1';};
  const startAnalysis=async()=>{class AnalysisModule{}Module({controllers:[AnalysisController],providers:[{provide:AnalysisRuntime,useValue:{pool:analysis,config:{INTERNAL_TOKEN:config.internalToken,IDENTITY_URL:identityBase}}}]})(AnalysisModule);analysisApp=await NestFactory.create(AnalysisModule,{logger:false,abortOnError:false});configureHttp(analysisApp,loadGatewayConfig(),'analysis-privacy-fixture');await analysisApp.listen(0,'127.0.0.1');process.env.ANALYSIS_URL=(await analysisApp.getUrl())+'/v1';};
  const stopAnalysis=async()=>{if(analysisApp){const current=analysisApp;analysisApp=undefined;await current.close();}};
  try{
    process.env.IDENTITY_URL=identityBase;
    const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
    await identity.query('INSERT INTO users(id,email,name,password_hash,verified_at) VALUES($1,$2,$3,$4,now()),($5,$6,$7,$4,now())',[userId,email,'Task owner',passwordHash,peerId,peerEmail,'Peer']);
    await identity.query('INSERT INTO user_mfa(user_id,secret_cipher,enabled) VALUES($1,$2,true)',[userId,seal('JBSWY3DPEHPK3PXP',encryptionKey,`mfa:${userId}`)]);
    for(const factor of factors)await identity.query('INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)',[userId,hash(factor)]);
    for(const[id,creator,ws]of[[ownInspection,userId,workspaceId],[peerInspection,peerId,workspaceId],[legacyInspection,null,peerWorkspace]])await media.query("INSERT INTO inspection_tasks(id,workspace_id,creator_id,object_key,expected_bytes,expected_etag,status,correlation_id,finished_at) VALUES($1,$2,$3,'fixture-only',1,'fixture','failed',$4,now())",[id,ws,creator,randomUUID()]);
    for(const[id,inspection,creator]of[[ownProcessing,ownInspection,userId],[peerProcessing,peerInspection,peerId]])await media.query("INSERT INTO processing_tasks(id,workspace_id,inspection_id,creator_id,spec,request_hash,status,correlation_id,finished_at) VALUES($1,$2,$3,$4,'{}',$5,'failed',$6,now())",[id,workspaceId,inspection,creator,'a'.repeat(64),randomUUID()]);
    for(const[id,creator,ws]of[[ownJob,userId,workspaceId],[peerJob,peerId,workspaceId]])await analysis.query("INSERT INTO analysis_jobs(id,workspace_id,creator_id,source,spec,request_hash,status,correlation_id,transcription_revision,finished_at) VALUES($1,$2,$3,$4,'{}',$5,'failed',$6,'fixture',now())",[id,ws,creator,{secret},'b'.repeat(64),randomUUID()]);
    await analysis.query("INSERT INTO transcripts(id,job_id,language,provider,model,revision,input_sha256,data) VALUES($1,$2,'es','whisper_cpp','fixture','fixture',$3,$4)",[randomUUID(),ownJob,'c'.repeat(64),{text:secret,segments:[]}]);
    await startMedia();await startAnalysis();
    const a=clientFactory(),b=clientFactory(),anonymous=clientFactory();
    for(const client of[a,b])assert.equal((await client.request('/auth/csrf')).status,200);
    assert.equal((await a.request('/auth/login','POST',{email,password,factor:factors.shift()})).status,200);
    assert.equal((await b.request('/auth/login','POST',{email:peerEmail,password})).status,200);
    const created=await a.request('/auth/privacy-requests','POST',{kind:'export',password,factor:factors.shift()});assert.equal(created.status,202);
    const requestId=created.value.id,analysisPath=`/auth/privacy-requests/${requestId}/analysis-export`,mediaPath=`/auth/privacy-requests/${requestId}/media-export`,manifestPath=`/auth/privacy-requests/${requestId}/manifest`,analysisKey=randomUUID();
    checkpoint='CAPABILITY_CLEANUP';const accessHash=hash(a.jar.get('autoclipper_access')),sessionId=(await identity.query('SELECT session_id FROM access_tokens WHERE token_hash=$1',[accessHash])).rows[0].session_id;
    const capabilityTables=[['privacy_export_capabilities','workspace-memberships-v1'],['privacy_project_export_capabilities','project-attribution-v1'],['privacy_billing_export_capabilities','consumption-attribution-v1'],['privacy_task_export_capabilities','analysis-attribution-v1']];
    for(const[table,scope]of capabilityTables)await identity.query(`INSERT INTO ${table}(token_hash,request_id,session_id,access_token_hash,scope,idempotency_key,correlation_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()-interval '60 seconds',now()-interval '30 seconds')`,[hash(randomBytes(32).toString('hex')),requestId,sessionId,accessHash,scope,randomUUID(),randomUUID()]);
    assert.equal(Number((await identity.query('SELECT reap_expired_privacy_capabilities($1) AS removed',[1])).rows[0].removed),4);
    for(const[table]of capabilityTables)assert.equal((await identity.query(`SELECT count(*) FROM ${table} WHERE request_id=$1`,[requestId])).rows[0].count,'0');
    checkpoint='PERMISSIONS';assert.equal((await anonymous.request(analysisPath,'POST',{password},{'idempotency-key':analysisKey})).status,403);assert.equal((await b.request(analysisPath,'POST',{password},{'idempotency-key':analysisKey})).status,404);assert.equal((await b.request(mediaPath,'POST',{password},{'idempotency-key':randomUUID()})).status,404);
    for(const ownerUrl of[process.env.MEDIA_URL,process.env.ANALYSIS_URL])assert.equal((await fetch(ownerUrl+'/internal/'+(ownerUrl===process.env.MEDIA_URL?'privacy-media-export':'privacy-analysis-export'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:'a'.repeat(43),idempotencyKey:randomUUID(),correlationId:randomUUID()})})).status,401);
    checkpoint='ANALYSIS_PREPARE';const first=await a.request(analysisPath,'POST',{password,factor:factors.shift()},{'idempotency-key':analysisKey});assert.equal(first.status,200);assert.deepEqual(first.value.data.jobs.map(row=>row.id),[ownJob]);assert.equal(first.value.data.jobs[0].transcriptPresent,true);assert.equal(first.value.sha256,hash(JSON.stringify(first.value.data)));assert.equal(JSON.stringify(first.value).includes(secret),false);assert.equal(JSON.stringify(first.value).includes(peerJob),false);
    checkpoint='ANALYSIS_REPLAY';const replay=await a.request(analysisPath,'POST',{password,factor:factors.shift()},{'idempotency-key':analysisKey});assert.equal(replay.status,200);assert.deepEqual(replay.value,first.value);
    checkpoint='ANALYSIS_OUTAGE';await stopAnalysis();const outageKey=randomUUID();assert.equal((await a.request(analysisPath,'POST',{password,factor:factors.shift()},{'idempotency-key':outageKey})).status,503);let manifest=await a.request(manifestPath);assert.equal(manifest.value.scopes.find(row=>row.scope==='analysis-attribution-v1').status,'prepared');assert.equal(manifest.value.scopes.find(row=>row.scope==='analysis-attribution-v1').lastErrorCode,'OWNER_UNAVAILABLE');await startAnalysis();assert.equal((await a.request(analysisPath,'POST',{password,factor:factors.shift()},{'idempotency-key':outageKey})).status,200);
    checkpoint='ANALYSIS_SNAPSHOT';await analysis.query("UPDATE analysis_jobs SET error_code='CHANGED' WHERE id=$1",[ownJob]);const changed=await a.request(analysisPath,'POST',{password,factor:factors.shift()},{'idempotency-key':analysisKey});assert.equal(changed.status,409);assert.equal(changed.value.code,'PRIVACY_SNAPSHOT_CHANGED');manifest=await a.request(manifestPath);assert.equal(manifest.value.scopes.find(row=>row.scope==='analysis-attribution-v1').status,'snapshot_changed');assert.equal((await a.request(analysisPath,'POST',{password,factor:factors.shift()},{'idempotency-key':randomUUID()})).status,200);
    checkpoint='MEDIA_MISSING_ATTRIBUTION';const missing=await a.request(mediaPath,'POST',{password,factor:factors.shift()},{'idempotency-key':randomUUID()});assert.equal(missing.status,409);assert.equal(missing.value.code,'PRIVACY_ATTRIBUTION_MISSING');manifest=await a.request(manifestPath);assert.equal(manifest.value.scopes.find(row=>row.scope==='media-task-attribution-v1').status,'attribution_missing');assert.equal(manifest.value.globalFulfillment,'pending');assert.equal((await media.query('SELECT count(*) FROM privacy_export_receipts WHERE request_id=$1',[requestId])).rows[0].count,'0');
    await media.query('DELETE FROM inspection_tasks WHERE id=$1',[legacyInspection]);
    const otherMissing=(await media.query('SELECT EXISTS(SELECT 1 FROM inspection_tasks WHERE creator_id IS NULL) OR EXISTS(SELECT 1 FROM processing_tasks WHERE creator_id IS NULL) AS missing')).rows[0].missing;
    if(!otherMissing){checkpoint='MEDIA_REPLAY';const mediaKey=randomUUID(),prepared=await a.request(mediaPath,'POST',{password,factor:factors.shift()},{'idempotency-key':mediaKey});assert.equal(prepared.status,200);assert.deepEqual(prepared.value.data.inspections.map(row=>row.id),[ownInspection]);assert.deepEqual(prepared.value.data.processing.map(row=>row.id),[ownProcessing]);assert.equal(JSON.stringify(prepared.value).includes(peerInspection),false);assert.equal(JSON.stringify(prepared.value).includes(peerProcessing),false);const mediaReplay=await a.request(mediaPath,'POST',{password,factor:factors.shift()},{'idempotency-key':mediaKey});assert.equal(mediaReplay.status,200);assert.deepEqual(mediaReplay.value,prepared.value);}
    manifest=await a.request(manifestPath);assert.equal(manifest.value.globalFulfillment,'pending');
    return{status:'passed',analysisReplay:true,analysisOwnerRecovery:true,analysisSnapshotChange:true,mediaMissingAttributionRejected:true,mediaReplay:!otherMissing,globalFulfillment:'pending'};
  }catch(error){error.privacyCheckpoint=`TASK_${checkpoint}`;throw error;}
  finally{await stopAnalysis();if(mediaApp)await mediaApp.close();await Promise.all([identity.end(),media.end(),analysis.end()]);}
}
