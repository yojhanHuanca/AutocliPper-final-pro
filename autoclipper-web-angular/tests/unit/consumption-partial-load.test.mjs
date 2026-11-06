import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { ConsumptionComponent, loadConsumptionSections } from '../../.local/tests/client.mjs';

const template = readFileSync(new URL('../../src/app/features/consumption/pages/consumption.component.html', import.meta.url), 'utf8');

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
  Object.assign(state,{api,generation:0,loadedWorkspaceId:'alpha',seenLedgerCursors:new Set(),workspace:{workspaceId:signal('alpha')}});
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
    assert.equal(state.overviewError(),'','Access denial is presented as a module-level state, never mislabeled as an overview failure.');
  }
});

test('consumption access denial has a distinct message from overview loading failures',()=>{
  assert.match(template,/@if \(accessDenied\(\)\) \{[\s\S]*?No se pudo confirmar el acceso a todos los datos de consumo[\s\S]*?\} @else if \(overviewError\(\)\)/);
  assert.match(template,/El resumen de consumo no se pudo cargar: \{\{ overviewError\(\) \}\}/);
  assert.match(template,/Reintentar resumen/);
  assert.match(template,/Reintentar movimientos/);
  assert.match(template,/!ledgerError\(\)\.includes\('cursor repetido'\)/,'A repeated server cursor is explained without offering an identical retry loop.');
});

test('allocation distinguishes consumed, reserved and available seconds with an accessible meter and per-pipeline rows',()=>{
  assert.match(template,/role="progressbar"[\s\S]*aria-valuetext/);
  assert.match(template,/Consumido[\s\S]*Reservado[\s\S]*Disponible/);
  assert.match(template,/Cada fila es un movimiento confirmado por etapa\./);
  assert.match(template,/ID de pipeline: ' \+ entry\.pipelineId/);
  assert.match(template,/class="badge movement-badge"/);
  for(const kind of ['reserve','consume','release']) assert.ok(template.includes(`entry.kind === '${kind}'`));
  assert.doesNotMatch(template,/\$\s?\d/i,'Consumption is material usage and never invents monetary amounts.');
});

test('consumption filters and allocation detail remain usable on mobile and by keyboard',()=>{
  const css=readFileSync(new URL('../../src/app/features/consumption/pages/consumption.component.css',import.meta.url),'utf8');
  assert.match(css,/@media \(max-width: 560px\)[\s\S]*?\.quota-meter-legend \{ display:grid;/);
  assert.match(css,/\.ledger-stage-chip:focus-visible/);
  assert.match(css,/ac-consumption :is\(button,summary\):focus-visible/);
  assert.match(css,/\.table-scroll:focus-visible/);
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

test('overview responses from a different workspace never replace the selected workspace totals',async()=>{
  const state=subject({
    overview:async id=>({workspaceId:id==='alpha'?'beta':'alpha',consumedSeconds:900}),
    ledger:async()=>({items:[],nextBeforeId:null}),
  });
  await state.load('alpha');
  assert.equal(state.consumption().consumedSeconds,12,'The last confirmed same-workspace value remains available as stale data.');
  assert.equal(state.overviewError(),'El resumen no corresponde al espacio seleccionado.');

  state.workspace.workspaceId.set('beta');
  await state.load('beta');
  assert.equal(state.consumption(),null,'Values from the previous workspace are cleared before accepting a new scope.');
  assert.equal(state.overviewError(),'El resumen no corresponde al espacio seleccionado.');
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
  assert.equal(state.overviewError(),'');
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

test('pagination removes repeated movement rows and stops when the service repeats the same cursor',async()=>{
  const state=subject({ledger:async()=>({items:[{id:'old'},{id:'new'}],nextBeforeId:'cursor'})});
  await state.loadMore();
  assert.deepEqual(state.ledger().map(item=>item.id),['old','new']);
  assert.equal(state.nextId(),null);
  assert.match(state.ledgerError(),/cursor repetido/);
  assert.equal(state.loadingMore(),false);
});

test('pagination stops on a cursor cycle and allows a forward cursor only once',async()=>{
  const responses=[
    {items:[{id:'second'}],nextBeforeId:'cursor-two'},
    {items:[{id:'third'}],nextBeforeId:'cursor-one'},
  ];
  const state=subject({ledger:async()=>responses.shift()});
  state.nextId.set('cursor-one');
  await state.loadMore();
  assert.equal(state.nextId(),'cursor-two');
  await state.loadMore();
  assert.equal(state.nextId(),null);
  assert.deepEqual(state.ledger().map(item=>item.id),['old','second','third']);
  assert.match(state.ledgerError(),/cursor repetido/);
});
