import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { ConsumptionComponent, loadConsumptionSections } from '../../.local/tests/client.mjs';

test('consumption sections settle independently so one API failure preserves the successful result', async () => {
  const overview={consumedSeconds:12,consumedMinutes:0.2,reservedSeconds:2,availableSeconds:98};
  const api={overview:async id=>{assert.equal(id,'workspace-1');return overview;},ledger:async()=>{throw new Error('Ledger unavailable');}};
  const [summary,ledger]=await loadConsumptionSections(api,'workspace-1');
  assert.deepEqual(summary,{status:'fulfilled',value:overview});
  assert.equal(ledger.status,'rejected');
  assert.match(ledger.reason.message,/Ledger unavailable/);
});

function subject(api) {
  const state=Object.create(ConsumptionComponent.prototype);
  Object.assign(state,{api,generation:0,loadedWorkspaceId:'alpha',workspace:{workspaceId:signal('alpha')}});
  for(const [key,value] of Object.entries({consumption:{consumedSeconds:12},ledger:[{id:'old'}],nextId:'cursor',overviewError:'',ledgerError:'',busy:false,loadingMore:false,accessDenied:false})) state[key]=signal(value);
  return state;
}

test('consumption denial from either endpoint clears all cached totals, rows and pagination',async()=>{
  for(const status of [401,403,404]) {
    const state=subject({overview:async()=>({consumedSeconds:99}),ledger:async()=>{throw {status};}});
    await state.load();
    assert.equal(state.consumption(),null);
    assert.deepEqual(state.ledger(),[]);
    assert.equal(state.nextId(),null);
    assert.equal(state.accessDenied(),true);
  }
});

test('a workspace change invalidates late consumption without querying an empty selection',async()=>{
  let resolve;
  let calls=0;
  const state=subject({overview:()=>{calls++;return new Promise(done=>resolve=done);},ledger:async()=>({items:[{id:'late'}],nextBeforeId:'late-cursor'})});
  const request=state.load();
  state.workspace.workspaceId.set('');
  await state.load('');
  resolve({consumedSeconds:88}); await request;
  assert.equal(calls,1);
  assert.equal(state.consumption(),null);
  assert.deepEqual(state.ledger(),[]);
});

test('transient failures retain explicitly stale data but pagination denial removes it',async()=>{
  const state=subject({overview:async()=>{throw new Error('temporary');},ledger:async()=>{throw new Error('ledger temporary');}});
  await state.load();
  assert.equal(state.consumption().consumedSeconds,12);
  assert.equal(state.ledger().length,1);
  assert.match(state.overviewError(),/temporary/);
  state.api.ledger=async()=>{throw {status:403};};
  await state.loadMore();
  assert.equal(state.accessDenied(),true);
  assert.deepEqual(state.ledger(),[]);
  assert.equal(state.loadingMore(),false);
});

test('pagination never applies an old workspace cursor to a newly selected workspace',async()=>{
  let calls=0;
  const state=subject({ledger:async()=>{calls++;return {items:[],nextBeforeId:null};}});
  state.workspace.workspaceId.set('beta');
  await state.loadMore();
  assert.equal(calls,0);
});
