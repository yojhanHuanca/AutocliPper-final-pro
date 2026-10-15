import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {BillingService} from '../../apps/autoclipper-billing-service/dist/application/billing.service.js';
import {verifiedAccountFixture} from '../helpers/verified-account-fixture.mjs';
// Real Billing PostgreSQL, Workspace authorization and public HTTP; stage
// outcomes in this suite are explicit events, NOT real processing/inference.
test('development consumption ledger authorizes reads, reserves concurrently, deduplicates reordered events and pins immutable plans',{timeout:90000},async t=>{
  assert.ok(process.env.BILLING_DATABASE_URL);process.env.DATABASE_URL=process.env.BILLING_DATABASE_URL;process.env.IDENTITY_URL='http://identity:3002';process.env.WORKSPACE_URL='http://workspace:3003';process.env.DEV_PROCESSING_SECONDS_PER_MONTH='40';process.env.DEV_ACTIVE_PIPELINES='4';
  const service=new BillingService();await service.onModuleInit();const alice=await verifiedAccountFixture(),bob=await verifiedAccountFixture();const workspace=await alice.c.request('/workspaces','POST',{kind:'team',name:'Explicit development ledger events'},{'idempotency-key':randomUUID()});assert.equal(workspace.status,201);const workspaceId=workspace.value.id,root=`/consumption/workspaces/${workspaceId}`;
  const request=(user)=>({headers:{cookie:[...user.c.jar].map(([key,value])=>`${key}=${value}`).join(';')}}),spec=id=>({version:1,pipelineId:id,workspaceId,creatorId:alice.id,sourceSeconds:2,clipSeconds:1}),jobs=Array.from({length:4},()=>randomUUID());let deniedId,version;
  const report=(id,stage,outcome='succeeded')=>({version:1,eventId:randomUUID(),pipelineId:id,workspaceId,stage,outcome,actualDurationSeconds:outcome==='succeeded'?(stage==='render'?1:2):0});
  try{
    await t.test('reads neither assign plans nor expose another workspace, and public callers cannot mutate allocations',async()=>{
      const initial=await alice.c.request(root);assert.equal(initial.status,200);assert.equal(initial.value.plan,null);assert.equal(initial.value.availableSeconds,0);assert.equal((await bob.c.request(root)).status,403);assert.equal((await bob.c.request(root+'/ledger')).status,403);for(const suffix of ['/plan','/credits','/reservations'])assert.equal((await alice.c.request(root+suffix,'POST',{credits:100,plan:'unlimited'})).status,404);
      assert.equal((await fetch(`${process.env.BILLING_URL}/v1/internal/usage-reservations`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(spec(randomUUID()))})).status,401);
      assert.equal((await service.reserve({...spec(randomUUID()),creatorId:bob.id})).code,'USAGE_AUTHORIZATION_REVOKED');
    });
    await t.test('four concurrent reservations are atomic and retrying a rejected intention cannot later grant capacity',async()=>{
      const accepted=await Promise.all(jobs.map(id=>service.reserve(spec(id))));assert.ok(accepted.every(value=>value.admitted));deniedId=randomUUID();assert.equal((await service.reserve(spec(deniedId))).code,'PROCESSING_CONCURRENCY_EXCEEDED');
      await Promise.all(Array.from({length:6},()=>service.reserve(spec(jobs[0]))));await assert.rejects(service.reserve({...spec(jobs[0]),sourceSeconds:2.1}),error=>error.getStatus()===409);
      const value=(await alice.c.request(root)).value;assert.equal(value.plan.kind,'development');assert.equal(value.plan.processingSecondsPerMonth,40);version=value.plan.version;assert.equal(value.reservedSeconds,32);assert.equal(value.availableSeconds,8);assert.equal(value.consumedSeconds,0);assert.equal(value.plan.price,undefined);
    });
    await t.test('out-of-order reports, concurrent duplicate events and new duplicate IDs reconcile each stage exactly once',async()=>{
      for(const id of jobs){for(const stage of ['render','audio','analysis']){const event=report(id,stage);await Promise.all(Array.from({length:4},()=>service.settle(event)));await service.settle({...event,eventId:randomUUID()});await assert.rejects(service.settle({...event,actualDurationSeconds:event.actualDurationSeconds+0.01}),error=>error.getStatus()===409);}}
      const value=(await alice.c.request(root)).value;assert.equal(value.reservedSeconds,0);assert.equal(value.consumedSeconds,20);assert.equal(value.consumedMinutes,20/60);assert.equal(value.availableSeconds,20);assert.equal((await service.reserve(spec(deniedId))).code,'PROCESSING_CONCURRENCY_EXCEEDED');
      const blocked=await service.reserve({...spec(randomUUID()),sourceSeconds:10,clipSeconds:4});assert.equal(blocked.code,'PROCESSING_ALLOWANCE_EXCEEDED');assert.equal((await alice.c.request(root)).value.reservedSeconds,0);
      const ledger=await alice.c.request(root+'/ledger');assert.equal(ledger.status,200);assert.equal(ledger.value.items.length,36);for(const [kind,total]of [['reserve',32],['consume',20],['release',12]])assert.equal(ledger.value.items.filter(row=>row.kind===kind).reduce((sum,row)=>sum+row.seconds,0),total);
      assert.equal((await alice.c.request(root+'/ledger?beforeId=9999999999999999999')).status,400);assert.equal((await alice.c.request(root+'/ledger?beforeId=1')).value.items.length,0);
      await assert.rejects(service.pool.query('UPDATE usage_ledger SET seconds=seconds WHERE pipeline_id=$1',[jobs[0]]),error=>error.code==='23514');await assert.rejects(service.pool.query('UPDATE plan_versions SET label=label WHERE version=$1',[version]),error=>error.code==='23514');
    });
    await t.test('deployment configuration creates a new version without changing assigned workspaces; cancelled and skipped stages release all unused seconds',async()=>{
      process.env.DEV_PROCESSING_SECONDS_PER_MONTH='41';const changed=new BillingService();await changed.onModuleInit();try{
        const id=randomUUID();assert.equal((await changed.reserve(spec(id))).admitted,true);for(const stage of ['render','analysis','audio'])await changed.settle(report(id,stage,'skipped'));assert.equal((await alice.c.request(root)).value.plan.version,version);assert.equal((await alice.c.request(root)).value.plan.processingSecondsPerMonth,40);
        const newer=await alice.c.request('/workspaces','POST',{kind:'personal',name:'New development version fixture'},{'idempotency-key':randomUUID()});assert.equal(newer.status,201);const nextId=randomUUID(),input={...spec(nextId),workspaceId:newer.value.id};assert.equal((await changed.reserve(input)).admitted,true);for(const stage of ['audio','analysis','render'])await changed.settle({...report(nextId,stage,'cancelled'),workspaceId:newer.value.id});
        const current=await changed.consumption(request(alice),newer.value.id);assert.notEqual(current.plan.version,version);assert.equal(current.plan.processingSecondsPerMonth,41);assert.equal(current.reservedSeconds,0);assert.equal(current.consumedSeconds,0);
        const old=await changed.consumption(request(alice),workspaceId);assert.equal(old.consumedSeconds,20);assert.equal(old.reservedSeconds,0);
      }finally{await changed.onModuleDestroy();}
    });
  }finally{await service.onModuleDestroy();}
});
