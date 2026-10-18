import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
import argon2 from 'argon2';
import {TOTP} from 'otpauth';
import {client,password} from '../helpers/accounts.mjs';
const execute=promisify(execFile),key=()=>({'idempotency-key':randomUUID()}),hash=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Accounts already verified and terminal job payloads are explicit SQL fixtures.
// Password login, TOTP enrollment, recovery-code consumption, reauth, operator
// CLI, HTTP authorization, owner projections and audit use real services/Pg/Redis.
// No SMTP, media execution, transcription or billing of inference is claimed.
test('read-only administration separates operator grants, MFA/session elevation and owner-scoped redacted access',{timeout:780000},async t=>{
  assert.equal(process.env.ADMIN_ACCEPTANCE,'true');
  const identity=new pg.Pool({connectionString:process.env.IDENTITY_DATABASE_URL}),ownerDb=new pg.Pool({connectionString:process.env.IDENTITY_OWNER_DATABASE_URL}),projectDb=new pg.Pool({connectionString:process.env.PROJECT_DATABASE_URL});
  const canary=`PRIVATE_CONTENT_${randomUUID()}`,reference=`admin-test-${randomUUID()}`;
  const paths=['users','workspaces','jobs','consumption'].map(name=>`/admin/${name}`),accounts=[];
  const requestWithCooldown=async(c,path,method,input)=>{
    for(let attempt=0;attempt<12;attempt++){const response=await c.request(path,method,typeof input==='function'?input():input);if(response.status!==429)return response;console.log('Respecting the existing identity rate-limit window for synthetic account preparation');await sleep(60000);}throw Error('Identity rate window did not expire');
  };
  async function account(mfa){
    const id=randomUUID(),email=`admin-explicit-${randomUUID()}@example.test`,c=client();
    await identity.query('INSERT INTO users(id,email,name,password_hash,verified_at) VALUES($1,$2,$3,$4,now())',[id,email,canary,await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1})]);
    assert.equal((await c.request('/auth/csrf')).status,200);assert.equal((await requestWithCooldown(c,'/auth/login','POST',{email,password})).status,200);
    const value={id,email,c,codes:[]};accounts.push(value);
    if(mfa){const setup=await requestWithCooldown(c,'/auth/2fa/setup','POST',{password});assert.equal(setup.status,200);const secret=new URL(setup.value.otpauthUri).searchParams.get('secret'),totp=new TOTP({secret,algorithm:'SHA1',digits:6,period:30});const enabled=await requestWithCooldown(c,'/auth/2fa/enable','POST',()=>({password,code:totp.generate()}));assert.equal(enabled.status,200);value.codes=enabled.value.recoveryCodes;assert.equal((await requestWithCooldown(c,'/auth/login','POST',{email,password,factor:value.codes.shift()})).status,200);}
    return value;
  }
  const operator=(action,actor,permissions,scope)=>execute(process.execPath,['scripts/admin-operator.mjs',action,'--user-id',actor.id,'--operator-reference',reference,...(action==='grant'?['--permissions',permissions.join(','),'--workspaces',scope===null?'global':scope.join(',')]:[])],{env:{...process.env,MIGRATION_DATABASE_URL:process.env.IDENTITY_OWNER_DATABASE_URL},timeout:20000});
  const elevate=async actor=>{const response=await requestWithCooldown(actor.c,'/admin/access','POST',{password,factor:actor.codes.shift()});assert.equal(response.status,200,JSON.stringify(response.value));assert.ok(Date.parse(response.value.elevatedUntil)>Date.now());return response;};
  let normal,global,scoped,limited,workspaceA,workspaceB,projectA,jobA,analysisA;
  try{
    normal=await account(false);global=await account(true);scoped=await account(true);limited=await account(true);
    const workspaces=[];for(let i=0;i<2;i++){const response=await normal.c.request('/workspaces','POST',{kind:'team',name:canary},key());assert.equal(response.status,201);workspaces.push(response.value.id);} [workspaceA,workspaceB]=workspaces;
    const jobsByWorkspace=new Map();
    for(const workspaceId of workspaces){
      const project=await normal.c.request('/projects','POST',{workspaceId,name:canary},key());assert.equal(project.status,201);const projectId=project.value.id,uploadId=randomUUID(),audioId=randomUUID(),analysisId=randomUUID(),pipelineId=randomUUID();if(workspaceId===workspaceA){projectA=projectId;jobA=audioId;analysisA=analysisId;}
      await projectDb.query("INSERT INTO uploads(id,workspace_id,project_id,creator_id,idempotency_key,request_hash,object_key,expected_bytes,sha256,content_type,mode,state,etag) VALUES($1,$2,$3,$4,$5,$6,$7,100,$6,'video/mp4','put','confirmed','explicit-fixture')",[uploadId,workspaceId,projectId,normal.id,randomUUID(),'a'.repeat(64),`workspaces/${workspaceId}/fixtures/${canary}.mp4`]);
      await projectDb.query("INSERT INTO processing_requests(id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,spec,reservation_bytes,correlation_id,status,finished_at,settled_at,delivered_at,error_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,134217728,$9,'cancelled',now(),now(),now(),'CANCELLED')",[audioId,uploadId,projectId,workspaceId,normal.id,randomUUID(),'a'.repeat(64),{version:1,kind:'audio',explicitPrivateFixture:canary},randomUUID()]);
      await projectDb.query("INSERT INTO analysis_requests(id,audio_processing_id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,source,spec,correlation_id,cached_status,delivered_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now())",[analysisId,audioId,uploadId,projectId,workspaceId,normal.id,randomUUID(),'a'.repeat(64),{privateSource:canary},{version:1,provider:'whisper_cpp',selection:{mode:'none'}},randomUUID(),{status:'succeeded',transcript:{segments:[{text:canary}]},result:{secret:canary},errorCode:null}]);
      const spec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'},startSeconds:0,endSeconds:1,aspect:'square'};
      await projectDb.query("INSERT INTO pipelines(id,upload_id,project_id,workspace_id,creator_id,idempotency_key,request_hash,spec,correlation_id,status,version,remaining_reservation_bytes,finished_at,usage_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'cancelled',2,0,now(),'legacy')",[pipelineId,uploadId,projectId,workspaceId,normal.id,randomUUID(),'a'.repeat(64),spec,randomUUID()]);jobsByWorkspace.set(workspaceId,[audioId,analysisId,pipelineId]);
      const usageId=randomUUID(),base=process.env.BILLING_URL??'http://billing:3007',headers={'content-type':'application/json','x-service-token':process.env.INTERNAL_TOKEN};
      const reserve=await fetch(`${base}/v1/internal/usage-reservations`,{method:'POST',headers,body:JSON.stringify({version:1,pipelineId:usageId,workspaceId,creatorId:normal.id,sourceSeconds:2,clipSeconds:1})});assert.equal(reserve.status,200);assert.equal((await reserve.json()).admitted,true);
      for(const stage of ['audio','analysis','render'])assert.equal((await fetch(`${base}/v1/internal/usage-settlements`,{method:'POST',headers,body:JSON.stringify({version:1,eventId:randomUUID(),pipelineId:usageId,workspaceId,stage,outcome:'skipped',actualDurationSeconds:0})})).status,200);
    }
    const permissions=['users.read','workspaces.read','jobs.read','consumption.read'];
    await t.test('only the operator owner connection can grant; verified MFA is required and public self-assignment is absent',async()=>{
      await assert.rejects(operator('grant',normal,permissions,null));assert.equal((await identity.query('SELECT count(*) FROM admin_grants WHERE user_id=$1',[normal.id])).rows[0].count,'0');
      await assert.rejects(execute(process.execPath,['scripts/admin-operator.mjs','grant','--user-id',global.id,'--permissions','users.read','--workspaces','global','--operator-reference',reference],{env:{...process.env,MIGRATION_DATABASE_URL:process.env.IDENTITY_DATABASE_URL},timeout:20000}));
      await assert.rejects(operator('grant',scoped,['users.read'],[workspaceA]));
      for(const actor of [normal,global])assert.equal((await actor.c.request('/admin/grants','POST',{permissions,workspaceIds:null})).status,404);
      await operator('grant',global,permissions,null);await operator('grant',scoped,['workspaces.read','jobs.read','consumption.read'],[workspaceA]);await operator('grant',limited,['workspaces.read'],[workspaceA]);
      await assert.rejects(identity.query("UPDATE admin_grants SET permissions=ARRAY['users.read'] WHERE user_id=$1",[scoped.id]),error=>error.code==='42501');
    });
    await t.test('a normal workspace owner and spoofed global headers cannot access administrative data',async()=>{
      assert.equal((await normal.c.request('/admin/access')).value.granted,false);
      for(const path of paths){const response=await normal.c.request(path,'GET',undefined,{'x-user-role':'admin','x-global-role':'admin','x-service-token':'browser-forged'});assert.equal(response.status,403,path);assert.equal(JSON.stringify(response.value).includes(canary),false);assert.equal((await client().request(path)).status,401);}
      for(const path of ['/internal/admin-authorize','/internal/admin-jobs','/internal/admin-workspaces','/internal/admin-consumption'])assert.equal((await normal.c.request(path,'POST',{})).status,404);
    });
    await t.test('grants require a fresh password and second factor bound to the active session for five minutes',async()=>{
      const discovery=await global.c.request('/admin/access');assert.equal(discovery.status,200);assert.equal(discovery.value.granted,true);assert.equal(discovery.value.elevatedUntil,null);
      for(const path of paths)assert.equal((await global.c.request(path)).status,403);
      assert.equal((await global.c.request('/admin/access','POST',{password:'incorrect-password',factor:global.codes[0]})).status,401);
      assert.equal((await global.c.request('/admin/access','POST',{password,factor:'f'.repeat(24)})).status,401);
      assert.equal((await global.c.request('/admin/access','POST',{password})).status,400);
      assert.equal((await global.c.request('/admin/access','POST',{password,factor:global.codes[0]},{'x-csrf-token':'wrong'})).status,403);
      const factor=global.codes[0],elevated=await elevate(global);assert.ok(Date.parse(elevated.value.elevatedUntil)<=Date.now()+300000);assert.equal((await global.c.request('/admin/access','POST',{password,factor})).status,401,'One-use factor replay must fail');
      const second=client();assert.equal((await second.request('/auth/csrf')).status,200);assert.equal((await requestWithCooldown(second,'/auth/login','POST',{email:global.email,password,factor:global.codes.shift()})).status,200);assert.equal((await second.request('/admin/users')).status,403,'Another session cannot inherit elevation');assert.equal((await second.request('/auth/logout','POST')).status,200);
    });
    await t.test('global projections expose bounded typed metadata only and use stable exclusive pagination',async()=>{
      const first=await global.c.request('/admin/users?limit=1');assert.equal(first.status,200);assert.equal(first.value.items.length,1);assert.ok(first.value.nextBeforeId);const next=await global.c.request(`/admin/users?limit=1&beforeId=${first.value.nextBeforeId}`);assert.equal(next.status,200);assert.notEqual(first.value.items[0].id,next.value.items[0].id);assert.deepEqual(Object.keys(first.value.items[0]).sort(),['createdAt','id','mfaEnabled','verified']);
      for(const workspaceId of workspaces){for(const kind of ['workspaces','jobs','consumption']){const response=await global.c.request(`/admin/${kind}?workspaceId=${workspaceId}&limit=50`);assert.equal(response.status,200,JSON.stringify(response.value));assert.ok(response.value.items.length);const data=JSON.stringify(response.value);for(const privateValue of [canary,normal.email,global.email,password,...global.c.jar.values()])assert.equal(data.includes(privateValue),false);assert.equal(response.value.items.some(item=>item.source||item.spec||item.transcript||item.result||item.name||item.email||item.url),false);if(kind==='jobs')assert.deepEqual(response.value.items.map(item=>item.id).sort(),jobsByWorkspace.get(workspaceId).sort());if(kind==='consumption'){assert.equal(response.value.items[0].unit,'material_seconds_per_stage');assert.equal(response.value.items[0].consumedSeconds,0);assert.equal(response.value.items[0].reservedSeconds,0);}}}
      for(const query of ['limit=51','beforeId=invalid','scope=global','workspaceIds='+workspaceA])assert.equal((await global.c.request('/admin/jobs?'+query)).status,400);
      for(const route of ['/admin/users','/admin/workspaces','/admin/jobs','/admin/consumption'])assert.equal((await global.c.request(route,'POST',{})).status,404);
    });
    await t.test('workspace scope is enforced by each owner and metadata grants never grant private content or membership',async()=>{
      await elevate(scoped);assert.equal((await scoped.c.request('/admin/users')).status,403);
      for(const kind of ['workspaces','jobs','consumption']){const response=await scoped.c.request(`/admin/${kind}?limit=50`);assert.equal(response.status,200);assert.ok(response.value.items.length);assert.ok(response.value.items.every(item=>(item.workspaceId??item.id)===workspaceA));assert.equal((await scoped.c.request(`/admin/${kind}?workspaceId=${workspaceB}`)).status,403);}
      for(const actor of [scoped,global])for(const path of [`/projects/${projectA}`,`/processing/${jobA}/download?kind=audio`,`/analyses/${analysisA}`,`/workspaces/${workspaceA}/members`])assert.equal((await actor.c.request(path)).status,403,path);
      const response=await scoped.c.request('/admin/jobs?workspaceId='+workspaceA);const audit=await identity.query("SELECT correlation_id FROM admin_access_audit WHERE actor_user_id=$1 AND permission='jobs.read' AND outcome='allowed' AND correlation_id=$2",[scoped.id,response.headers.get('x-correlation-id')]);assert.equal(audit.rowCount,1);
    });
    await t.test('expiry, grant revision changes and operator revocation take effect without caching or revoking ordinary membership',async()=>{
      await ownerDb.query('UPDATE admin_elevations SET expires_at=now()-interval \'1 second\' WHERE session_id IN (SELECT session_id FROM access_tokens WHERE token_hash=$1)',[hash(scoped.c.jar.get('autoclipper_access'))]);assert.equal((await scoped.c.request('/admin/jobs')).status,403);await elevate(scoped);
      await operator('grant',scoped,['workspaces.read'],[workspaceA]);assert.equal((await scoped.c.request('/admin/workspaces')).status,403,'Old elevation cannot survive a grant revision');await elevate(scoped);assert.equal((await scoped.c.request('/admin/workspaces')).status,200);assert.equal((await scoped.c.request('/admin/jobs')).status,403);
      await operator('revoke',scoped);for(const path of paths)assert.equal((await scoped.c.request(path)).status,403);assert.equal((await scoped.c.request('/auth/me')).status,200);
    });
    await t.test('read rate limits survive internal owner hops; disabling MFA immediately invalidates administrative access',async()=>{
      await elevate(limited);const responses=await Promise.all(Array.from({length:31},()=>limited.c.request(`/admin/workspaces?workspaceId=${workspaceA}`)));assert.equal(responses.filter(response=>response.status===200).length,30);assert.equal(responses.filter(response=>response.status===429).length,1);
      const old=client();for(const [name,value]of limited.c.jar)old.jar.set(name,value);assert.equal((await limited.c.request('/auth/2fa/disable','POST',{password,factor:limited.codes.shift()})).status,200);assert.equal((await old.request('/admin/workspaces')).status,401);assert.equal((await global.c.request('/auth/logout','POST')).status,200);assert.equal((await global.c.request('/admin/users')).status,401);
    });
    await t.test('anonymous forged sessions cannot grow authorization lookups and audit beyond the public rate window',async()=>{
      console.log('Waiting for the natural administrative boundary window; no counters are removed');await sleep(30000);await sleep(30000);await sleep(1000);
      const c=client(),forged='Z'.repeat(43),responses=await Promise.all(Array.from({length:121},()=>c.request('/admin/users','GET',undefined,{cookie:`autoclipper_access=${forged}`})));
      assert.equal(responses.filter(response=>response.status===401).length,120);assert.equal(responses.filter(response=>response.status===429).length,1);assert.equal((await c.request('/admin/workspaces')).status,429);
      const correlations=responses.filter(response=>response.status===401).map(response=>response.headers.get('x-correlation-id'));const rows=(await identity.query('SELECT * FROM admin_access_audit WHERE correlation_id=ANY($1::uuid[])',[correlations])).rows;assert.equal(rows.length,120);assert.ok(rows.every(row=>row.actor_user_id===null&&row.outcome==='denied'));assert.equal(JSON.stringify(rows).includes(forged),false);
    });
    await t.test('audit retains allowed denied reauthentication and operator events without credentials or private payloads and is immutable',async()=>{
      const rows=(await identity.query('SELECT * FROM admin_access_audit WHERE actor_user_id=ANY($1::uuid[]) OR subject_user_id=ANY($1::uuid[])',[accounts.map(actor=>actor.id)])).rows;for(const outcome of ['allowed','denied','reauthenticated','reauth_denied','grant','revoke'])assert.ok(rows.some(row=>row.outcome===outcome),outcome);
      assert.ok(rows.filter(row=>['allowed','reauthenticated','grant','revoke'].includes(row.outcome)).every(row=>row.grant_revision>0));assert.ok(rows.filter(row=>row.outcome==='grant').every(row=>row.actor_user_id===null&&row.subject_user_id&&row.grant_permissions.length));const originalScope=rows.find(row=>row.outcome==='grant'&&row.subject_user_id===scoped.id&&row.grant_revision===1);assert.deepEqual(originalScope.grant_workspace_ids,[workspaceA]);assert.ok(originalScope.grant_permissions.includes('jobs.read'),'Audit preserves the earlier scope even after permission changes/revocation');
      const data=JSON.stringify(rows);for(const value of [canary,password,...accounts.flatMap(actor=>[actor.email,...actor.c.jar.values()]).filter(value=>value.length>20)])assert.equal(data.includes(value),false);
      await assert.rejects(identity.query('DELETE FROM admin_access_audit WHERE actor_user_id=$1',[global.id]),error=>error.code==='42501');await assert.rejects(ownerDb.query('UPDATE admin_access_audit SET outcome=outcome WHERE actor_user_id=$1',[global.id]),error=>error.code==='23514');await assert.rejects(identity.query('TRUNCATE admin_access_audit'),error=>error.code==='42501');
    });
  }finally{
    try{
      for(const actor of accounts){if(actor!==normal)try{await operator('revoke',actor);}catch{/* The database check below must still prove no active fixture grant. */}}
      const remaining=(await identity.query('SELECT count(*) FROM admin_grants WHERE user_id=ANY($1::uuid[]) AND revoked_at IS NULL',[accounts.map(actor=>actor.id)])).rows[0];assert.equal(remaining.count,'0','All synthetic operator grants must be revoked before acceptance ends');
    }finally{await Promise.all([identity.end(),ownerDb.end(),projectDb.end()]);}
  }
});
