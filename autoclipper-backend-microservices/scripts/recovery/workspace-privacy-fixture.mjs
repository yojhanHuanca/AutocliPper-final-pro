import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import argon2 from 'argon2';
import {NestFactory} from '@nestjs/core';
import {configureHttp} from '@autoclipper/observability';
import {loadServiceConfig,seal} from '@autoclipper/http-security';
import {AppModule} from '../../apps/autoclipper-workspace-service/dist/app.module.js';
import {issueWorkspaceCapability} from '../../apps/autoclipper-identity-service/dist/application/privacy-capabilities.js';

// All subject, membership and capability fixtures live in the private target DBs.
// This tests real HTTP owner delegation, not a mocked Identity or Workspace.
export async function verifyWorkspacePrivacy(config,identityBase,clientFactory,encryptionKey){
  const url=(service,role='runtime')=>`postgresql://autoclipper_${service}_${role}:${config.password}@target-pg:5432/autoclipper_${service}`;
  const identity=new pg.Pool({connectionString:url('identity')}),identityOwner=new pg.Pool({connectionString:url('identity','owner')}),workspace=new pg.Pool({connectionString:url('workspace')}),workspaceOwner=new pg.Pool({connectionString:url('workspace','owner')});
  let app,httpChecks=0,checkpoint='STARTUP';
  const userId=randomUUID(),otherId=randomUUID(),own=randomUUID(),shared=randomUUID(),former=randomUUID();
  const key=()=>randomUUID(),hash=value=>createHash('sha256').update(value).digest('hex');
  const password=`Workspace-${randomBytes(18).toString('hex')}`,email=`workspace-${key()}@example.test`,otherEmail=`peer-${key()}@example.test`,privateName=`PRIVATE_TEAM_${key()}`;
  const factors=Array.from({length:30},()=>randomBytes(12).toString('hex'));
  const wsBase='http://127.0.0.1:3203/v1';
  const client=()=>{const value=clientFactory();return{jar:value.jar,async request(...args){httpChecks++;return value.request(...args);}};};
  async function internal(base,path,input,authenticated=true){
    httpChecks++;
    const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(authenticated?{'x-service-token':config.internalToken}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});
    return{status:response.status,value:await response.json()};
  }
  async function startOwner(){
    Object.assign(process.env,{DATABASE_URL:url('workspace'),IDENTITY_URL:identityBase.slice(0,-3),WORKSPACE_URL:'http://127.0.0.1:3203'});
    app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});configureHttp(app,loadServiceConfig(),'workspace-privacy-fixture');await app.listen(3203,'127.0.0.1');
  }
  try{
    await startOwner();
    checkpoint='SUBJECT_FIXTURES';
    const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
    for(const[id,address]of[[userId,email],[otherId,otherEmail]])await identity.query('INSERT INTO users(id,email,name,password_hash,verified_at) VALUES($1,$2,$3,$4,now())',[id,address,privateName,passwordHash]);
    await identity.query('INSERT INTO user_mfa(user_id,secret_cipher,enabled) VALUES($1,$2,true)',[userId,seal('JBSWY3DPEHPK3PXP',encryptionKey,`mfa:${userId}`)]);
    for(const factor of factors)await identity.query('INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)',[userId,hash(factor)]);
    const transaction=await workspace.connect();
    try{
      await transaction.query('BEGIN');
      for(const[id,creator,owner]of[[own,userId,userId],[shared,otherId,otherId],[former,userId,otherId]]){
        await transaction.query("INSERT INTO workspaces(id,creator_id,name,kind,idempotency_key,request_hash) VALUES($1,$2,$3,'team',$4,$5)",[id,creator,privateName,key(),'a'.repeat(64)]);
        await transaction.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",[id,owner]);
      }
      await transaction.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'reader')",[shared,userId]);
      await transaction.query('COMMIT');
    }catch(error){await transaction.query('ROLLBACK');throw error;}finally{transaction.release();}
    const a=client(),b=client(),anonymous=client();
    for(const c of[a,b])assert.equal((await c.request('/auth/csrf')).status,200);
    assert.equal((await a.request('/auth/login','POST',{email,password,factor:factors.shift()})).status,200);
    assert.equal((await b.request('/auth/login','POST',{email:otherEmail,password})).status,200);
    const request=await a.request('/auth/privacy-requests','POST',{kind:'export',password,factor:factors.shift()});assert.equal(request.status,202);
    const requestId=request.value.id,path=`/auth/privacy-requests/${requestId}/workspace-export`,firstKey=key();
    const profile=await a.request(`/auth/privacy-requests/${requestId}/identity-export`,'POST',{password,factor:factors.shift()},{'idempotency-key':firstKey});assert.equal(profile.status,200);assert.equal(profile.value.scope,'identity-profile-v1');
    checkpoint='PUBLIC_AUTHORIZATION';
    assert.equal((await anonymous.request(path,'POST',{password},{'idempotency-key':key()})).status,403);
    assert.equal((await a.request(path,'POST',{password},{'idempotency-key':key(),'x-csrf-token':'invalid'})).status,403);
    assert.equal((await a.request(path,'POST',{password:'incorrect'},{'idempotency-key':key()})).status,401);
    assert.equal((await a.request(path,'POST',{password,factor:factors.shift(),userId:otherId},{'idempotency-key':key()})).status,400);
    assert.equal((await b.request(path,'POST',{password},{'idempotency-key':key()})).status,404);
    checkpoint='FIRST_EXPORT';
    const first=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':firstKey});assert.equal(first.status,200);assert.equal(first.value.scope,'workspace-memberships-v1');assert.equal(first.value.globalFulfillment,'pending');assert.equal(first.value.data.subjectId,userId);
    assert.equal(first.value.requestId,profile.value.requestId);assert.notEqual(first.value.receiptId,profile.value.receiptId,'same request/key has independent receipts per owner');
    assert.equal(first.value.sha256,hash(JSON.stringify(first.value.data)));assert.ok(Number.isFinite(Date.parse(first.value.capturedAt)));assert.match(first.headers.get('cache-control'),/no-store/);
    const membership=new Map(first.value.data.memberships.map(value=>[value.workspaceId,value]));assert.equal(membership.size,2);assert.equal(membership.get(own).isOwner,true);assert.equal(membership.get(shared).isOwner,false);assert.equal(membership.has(former),false,'historical creator is not current ownership/membership');
    for(const secret of[privateName,email,otherEmail,password,passwordHash,otherId,...factors,...a.jar.values()])assert.equal(JSON.stringify(first.value).includes(secret),false);
    checkpoint='REPLAY_CONCURRENCY';
    const replay=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':firstKey});assert.equal(replay.status,200);assert.deepEqual(replay.value,first.value);
    const parallelKey=key(),parallel=await Promise.all([0,1].map(()=>a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':parallelKey})));assert.ok(parallel.every(value=>value.status===200));assert.deepEqual(parallel[0].value,parallel[1].value);
    checkpoint='MEMBERSHIP_CHANGE';
    await workspace.query("UPDATE memberships SET role='editor' WHERE workspace_id=$1 AND user_id=$2",[shared,userId]);
    const changed=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':firstKey});assert.equal(changed.status,409);assert.equal(changed.value.code,'PRIVACY_SNAPSHOT_CHANGED');
    const changedKey=key(),next=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':changedKey});assert.equal(next.status,200);assert.notEqual(next.value.sha256,first.value.sha256);
    await workspace.query('DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2',[shared,userId]);
    assert.equal((await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':changedKey})).status,409);
    const current=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':key()});assert.equal(current.status,200);assert.deepEqual(current.value.data.memberships.map(value=>value.workspaceId),[own]);
    checkpoint='CAPABILITY_BINDING';
    async function capability(actorId,privacyId,c){
      const client=await identity.connect(),idempotencyKey=key(),correlationId=key();
      try{await client.query('BEGIN');const token=await issueWorkspaceCapability(client,actorId,privacyId,c.jar.get('autoclipper_access'),idempotencyKey,correlationId);await client.query('COMMIT');return{capability:token,idempotencyKey,correlationId,scope:'workspace-memberships-v1'};}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }
    const cap=await capability(userId,requestId,a);
    assert.equal((await internal(identityBase,'/internal/privacy-export-authorize',cap,false)).status,401);
    assert.equal((await internal(identityBase,'/internal/privacy-export-authorize',cap)).status,200);
    assert.equal((await internal(identityBase,'/internal/privacy-export-authorize',{...cap,idempotencyKey:key()})).status,401);
    assert.equal((await internal(identityBase,'/internal/privacy-export-authorize',{...cap,correlationId:key()})).status,401);
    assert.equal((await internal(identityBase,'/internal/privacy-export-authorize',{...cap,scope:'identity-profile-v1'})).status,400);
    const ownerInput={capability:cap.capability,idempotencyKey:cap.idempotencyKey,correlationId:cap.correlationId};
    assert.equal((await internal(wsBase,'/internal/privacy-workspace-export',ownerInput,false)).status,401);
    assert.equal((await internal(wsBase,'/internal/privacy-workspace-export',{...ownerInput,userId:otherId})).status,400);
    await identityOwner.query("UPDATE privacy_export_capabilities SET created_at=now()-interval '60 seconds',expires_at=now()-interval '30 seconds' WHERE token_hash=$1",[hash(cap.capability)]);
    assert.equal((await internal(identityBase,'/internal/privacy-export-authorize',cap)).status,401);
    assert.equal((await internal(wsBase,'/internal/privacy-workspace-export',ownerInput)).status,401);
    checkpoint='SESSION_REVOCATION';
    const otherRequest=await b.request('/auth/privacy-requests','POST',{kind:'export',password});assert.equal(otherRequest.status,202);
    const otherPath=`/auth/privacy-requests/${otherRequest.value.id}/workspace-export`,other=await b.request(otherPath,'POST',{password},{'idempotency-key':key()});assert.equal(other.status,200);assert.deepEqual(other.value.data.memberships.map(value=>value.workspaceId).sort(),[shared,former].sort());assert.ok(other.value.data.memberships.every(value=>value.isOwner));
    const otherCap=await capability(otherId,otherRequest.value.id,b);assert.equal((await b.request('/auth/logout','POST')).status,200);assert.equal((await internal(identityBase,'/internal/privacy-export-authorize',otherCap)).status,401);assert.equal((await b.request(otherPath,'POST',{password},{'idempotency-key':key()})).status,401);
    checkpoint='OWNER_RESTART';
    const before=Number((await workspace.query('SELECT count(*) AS count FROM privacy_export_receipts')).rows[0].count),retryKey=key();await app.close();app=undefined;
    assert.equal((await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':retryKey})).status,503);assert.equal(Number((await workspace.query('SELECT count(*) AS count FROM privacy_export_receipts')).rows[0].count),before);
    await startOwner();const recovered=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':retryKey});assert.equal(recovered.status,200);
    checkpoint='AUDIT_AND_LIMIT';
    const receipts=(await workspace.query('SELECT * FROM privacy_export_receipts')).rows,audits=(await workspace.query('SELECT * FROM privacy_export_audit')).rows;assert.equal(receipts.length,6);assert.equal(receipts.find(value=>value.request_id===requestId&&value.idempotency_key===firstKey).content_sha256,first.value.sha256);
    for(const action of['prepared','replayed','snapshot_changed'])assert.ok(audits.some(value=>value.action===action));assert.ok(audits.some(value=>value.correlation_id===first.headers.get('x-correlation-id')));
    for(const secret of[privateName,email,otherEmail,password,passwordHash,cap.capability,...factors])assert.equal(JSON.stringify({receipts,audits}).includes(secret),false);
    await assert.rejects(workspace.query('UPDATE privacy_export_receipts SET scope=scope'),error=>error.code==='42501');await assert.rejects(workspace.query('TRUNCATE privacy_export_audit'),error=>error.code==='42501');await assert.rejects(workspaceOwner.query('DELETE FROM privacy_export_audit'),error=>error.code==='23514');await assert.rejects(identity.query('DELETE FROM privacy_export_capabilities'),error=>error.code==='42501');
    await workspace.query("WITH inserted AS (INSERT INTO workspaces(id,creator_id,name,kind,idempotency_key,request_hash) SELECT gen_random_uuid(),$1,$2,'team',gen_random_uuid(),$3 FROM generate_series(1,501) RETURNING id) INSERT INTO memberships(workspace_id,user_id,role) SELECT id,$1,'owner' FROM inserted",[userId,privateName,'a'.repeat(64)]);
    const oversized=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':key()});assert.equal(oversized.status,413);assert.equal(oversized.value.code,'PRIVACY_EXPORT_SCOPE_TOO_LARGE');assert.equal(oversized.value.data,undefined);assert.equal(Number((await workspace.query('SELECT count(*) AS count FROM privacy_export_receipts')).rows[0].count),receipts.length);
    assert.ok((await a.request('/auth/privacy-requests')).value.items.every(value=>value.state==='requested'&&value.completedAt===null));
    return{status:'passed',httpChecks,receipts:receipts.length,scope:'workspace-memberships-v1',globalFulfillment:'pending',storedPersonalPayloads:0,ownerRestartRecovered:true,oversizedScopeDenied:true};
  }catch(error){error.privacyCheckpoint=`WORKSPACE_${checkpoint}`;throw error;}
  finally{if(app)await app.close();await Promise.all([identity.end(),identityOwner.end(),workspace.end(),workspaceOwner.end()]);}
}
