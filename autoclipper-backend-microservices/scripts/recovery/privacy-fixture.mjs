import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';
import { NestFactory } from '@nestjs/core';
import { configureHttp } from '@autoclipper/observability';
import { loadServiceConfig, seal } from '@autoclipper/http-security';
import { AppModule } from '../../apps/autoclipper-identity-service/dist/app.module.js';
import {verifyWorkspacePrivacy} from './workspace-privacy-fixture.mjs';

// Synthetic users/MFA/link state are SQL fixtures, not SMTP or Google acceptance.
// The requests, authentication, CSRF, factor verification and database are real.
export async function verifyPrivacyProfileExports(config){
  const databaseUrl=role=>`postgresql://autoclipper_identity_${role}:${config.password}@target-pg:5432/autoclipper_identity`;
  const encryptionKey=randomBytes(32).toString('hex');
  Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:databaseUrl('runtime'),REDIS_URL:'redis://target-redis:6379/1',AUTH_ENCRYPTION_KEY:encryptionKey,CSRF_SIGNING_KEY:randomBytes(32).toString('hex'),INTERNAL_TOKEN:config.internalToken,CORS_ORIGIN:'http://localhost:4200',COOKIE_AUTH:'true',ENABLE_DOCS:'false',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1025',WORKSPACE_URL:'http://127.0.0.1:3203'});
  const db=new pg.Pool({connectionString:databaseUrl('runtime')}),owner=new pg.Pool({connectionString:databaseUrl('owner')});
  let app;
  const password=`Fixture-${randomBytes(18).toString('hex')}`,canary=`PRIVACY_${randomUUID()}`;
  const userId=randomUUID(),otherId=randomUUID(),email=`profile-${randomUUID()}@example.test`,otherEmail=`other-${randomUUID()}@example.test`;
  const factors=Array.from({length:30},()=>randomBytes(12).toString('hex'));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  let httpChecks=0;
  let checkpoint='SEED';
  try{
    const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
    for(const [id,address]of [[userId,email],[otherId,otherEmail]])await db.query('INSERT INTO users(id,email,name,password_hash,verified_at) VALUES($1,$2,$3,$4,now())',[id,address,canary,passwordHash]);
    await db.query('INSERT INTO user_mfa(user_id,secret_cipher,enabled) VALUES($1,$2,true)',[userId,seal('JBSWY3DPEHPK3PXP',encryptionKey,`mfa:${userId}`)]);
    for(const factor of factors)await db.query('INSERT INTO recovery_codes(user_id,code_hash) VALUES($1,$2)',[userId,hash(factor)]);
    await db.query("INSERT INTO external_identities(provider,subject,user_id,provider_email) VALUES('google',$1,$2,$3)",[`fixture-subject-${userId}`,userId,email]);
    checkpoint='STARTUP';
    assert.equal(Number((await db.query('SELECT count(*) AS count FROM mail_outbox')).rows[0].count),0,'fixture must not send SMTP');
    app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});configureHttp(app,loadServiceConfig(),'privacy-fixture');await app.listen(0,'127.0.0.1');
    const base=(await app.getUrl())+'/v1';
    function client(){
      const jar=new Map();let csrf;
      return {jar,async request(path,method='GET',input,headers={}){
        const response=await fetch(base+path,{method,headers:{origin:'http://localhost:4200',cookie:[...jar].map(([key,value])=>`${key}=${value}`).join(';'),...(csrf?{'x-csrf-token':csrf}:{}),...(input===undefined?{}:{'content-type':'application/json'}),...headers},...(input===undefined?{}:{body:JSON.stringify(input)}),signal:AbortSignal.timeout(10000)});
        for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),index=pair.indexOf('=');jar.set(pair.slice(0,index),pair.slice(index+1));}
        const value=await response.json();if(value.csrfToken)csrf=value.csrfToken;
        httpChecks++;return {status:response.status,value,headers:response.headers};
      }};
    }
    const a=client(),b=client(),anonymous=client();
    checkpoint='LOGIN';
    for(const c of[a,b])assert.equal((await c.request('/auth/csrf')).status,200);
    assert.equal((await a.request('/auth/login','POST',{email,password,factor:factors.shift()})).status,200);
    assert.equal((await b.request('/auth/login','POST',{email:otherEmail,password})).status,200);
    checkpoint='REQUEST';
    const request=await a.request('/auth/privacy-requests','POST',{kind:'export',password,factor:factors.shift()});assert.equal(request.status,202);
    const path=`/auth/privacy-requests/${request.value.id}/identity-export`,key=randomUUID();
    checkpoint='AUTHORIZATION';
    assert.equal((await anonymous.request(path,'POST',{password},{'idempotency-key':key})).status,403);
    assert.equal((await a.request(path,'POST',{password}, {'idempotency-key':key,'x-csrf-token':'invalid'})).status,403);
    assert.equal((await a.request(path,'POST',{password:'incorrect'}, {'idempotency-key':key})).status,401);
    assert.equal((await a.request(path,'POST',{password},{'idempotency-key':key})).status,401);
    assert.equal((await b.request(path,'POST',{password},{'idempotency-key':randomUUID(),'x-user-id':userId})).status,404);
    assert.equal((await a.request(path,'POST',{password,factor:factors.shift()})).status,400);
    const firstFactor=factors.shift();
    checkpoint='PREPARE';
    const first=await a.request(path,'POST',{password,factor:firstFactor},{'idempotency-key':key});assert.equal(first.status,200);
    assert.match(first.headers.get('cache-control'),/no-store/);
    assert.equal(first.value.fulfillment,'partial');assert.equal(first.value.globalFulfillment,'pending');assert.equal(first.value.state,'prepared');assert.equal(first.value.scope,'identity-profile-v1');
    assert.equal(first.value.sha256,hash(JSON.stringify(first.value.data)));assert.equal(first.value.data.user.id,userId);assert.equal(first.value.data.user.mfaEnabled,true);assert.equal(first.value.data.externalIdentities[0].subject,`fixture-subject-${userId}`);
    const serialized=JSON.stringify(first.value);
    for(const secret of[password,passwordHash,otherEmail,...factors,...a.jar.values()].filter(value=>value.length>10))assert.equal(serialized.includes(secret),false);
    assert.equal((await a.request(path,'POST',{password,factor:firstFactor},{'idempotency-key':key})).status,401);
    checkpoint='REPLAY';
    const replay=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':key});assert.equal(replay.status,200);assert.deepEqual(replay.value,first.value);
    const parallelKey=randomUUID();
    checkpoint='CONCURRENCY';
    const concurrent=await Promise.all([0,1].map(()=>a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':parallelKey})));
    assert.ok(concurrent.every(value=>value.status===200));assert.deepEqual(concurrent[0].value,concurrent[1].value);
    assert.equal((await a.request(path,'POST',{password,factor:factors.shift(),userId:otherId},{'idempotency-key':randomUUID()})).status,400);
    checkpoint='SNAPSHOT_CHANGE';
    assert.equal((await a.request('/auth/profile','PATCH',{version:1,name:`UPDATED_${canary}`})).status,200);
    const changed=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':key});assert.equal(changed.status,409);assert.equal(changed.value.code,'PRIVACY_SNAPSHOT_CHANGED');
    const next=await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':randomUUID()});assert.equal(next.status,200);assert.notEqual(next.value.sha256,first.value.sha256);
    checkpoint='DELETION_REQUEST';
    const deletion=await a.request('/auth/privacy-requests','POST',{kind:'deletion',password,factor:factors.shift()});assert.equal(deletion.status,202);
    assert.equal((await a.request(`/auth/privacy-requests/${deletion.value.id}/identity-export`,'POST',{password,factor:factors.shift()},{'idempotency-key':randomUUID()})).status,409);
    const requests=await a.request('/auth/privacy-requests');assert.ok(requests.value.items.every(item=>item.state==='requested'&&item.completedAt===null));
    checkpoint='RECEIPTS_AUDIT';
    const receipts=(await db.query('SELECT * FROM privacy_export_receipts WHERE request_id=$1',[request.value.id])).rows;
    assert.equal(receipts.length,3);assert.equal(receipts.find(receipt=>receipt.idempotency_key===key).content_sha256,first.value.sha256);
    const audits=(await db.query('SELECT * FROM privacy_export_audit WHERE receipt_id=ANY($1::uuid[])',[receipts.map(receipt=>receipt.id)])).rows;
    for(const action of['prepared','replayed','snapshot_changed'])assert.ok(audits.some(audit=>audit.action===action));
    assert.ok(audits.every(audit=>audit.actor_user_id===userId));assert.ok(audits.some(audit=>audit.correlation_id===first.headers.get('x-correlation-id')));
    for(const value of[email,canary,password,passwordHash,...factors])assert.equal(JSON.stringify({receipts,audits}).includes(value),false);
    checkpoint='IMMUTABILITY';
    await assert.rejects(db.query('DELETE FROM privacy_export_audit'),error=>error.code==='42501');
    await assert.rejects(db.query('UPDATE privacy_export_receipts SET content_sha256=content_sha256'),error=>error.code==='42501');
    await assert.rejects(db.query('TRUNCATE privacy_export_receipts CASCADE'),error=>error.code==='42501');
    await assert.rejects(owner.query('UPDATE privacy_export_audit SET action=action'),error=>error.code==='23514');
    await assert.rejects(owner.query('DELETE FROM privacy_export_receipts'),error=>error.code==='23514');
    checkpoint='TERMINAL_LOGOUT';
    await owner.query("UPDATE privacy_requests SET state='completed',completed_at=now() WHERE id=$1",[request.value.id]);
    assert.equal((await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':randomUUID()})).status,409);
    await owner.query("UPDATE privacy_requests SET state='requested',completed_at=NULL WHERE id=$1",[request.value.id]);
    assert.equal((await a.request('/auth/logout','POST')).status,200);
    assert.equal((await a.request(path,'POST',{password,factor:factors.shift()},{'idempotency-key':key})).status,401);
    const profileChecks=httpChecks;
    const workspaceContribution=await verifyWorkspacePrivacy(config,base,client,encryptionKey);
    return {status:'passed',httpChecks:profileChecks,receipts:receipts.length,globalFulfillment:'pending',storedPersonalPayloads:0,workspaceContribution};
  }catch(error){if(!error.privacyCheckpoint)error.privacyCheckpoint=checkpoint;throw error;}
  finally{if(app)await app.close();await db.end();await owner.end();}
}
