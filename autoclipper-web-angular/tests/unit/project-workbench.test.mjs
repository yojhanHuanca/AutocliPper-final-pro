import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { ProjectComponent } from '../../.local/tests/client.mjs';

function subject() {
  const state=Object.create(ProjectComponent.prototype);
  const navigation=[];
  Object.assign(state,{design:false,disposed:false,project:signal({id:'project'}),busy:signal(false),createdDraft:signal(null),edits:signal([]),workbench:signal('source'),inspected:()=>false,router:{navigateByUrl:async path=>navigation.push(path)}});
  return {state,navigation};
}

test('continue opens an existing authorized draft without creating or processing anything',async()=>{
  const {state,navigation}=subject();
  state.edits.set([{id:'saved-draft'}]);
  await state.continueProject();
  assert.deepEqual(navigation,['/app/edits/saved-draft']);
  assert.equal(state.continueLabel(),'Abrir un borrador');
  let reopened=0;
  state.createdDraft.set({id:'created'});
  state.openCreatedDraft=async()=>reopened++;
  await state.continueProject();
  assert.equal(reopened,1);
  assert.equal(navigation.length,1);
});

test('continue directs an unprepared source or inspected source to its appropriate workbench',async()=>{
  const {state,navigation}=subject();
  state.workbench.set('drafts');
  await state.continueProject();
  assert.equal(state.workbench(),'source');
  state.inspected=()=>true;
  await state.continueProject();
  assert.equal(state.workbench(),'processing');
  assert.deepEqual(navigation,[]);
});

test('design, missing access, busy or disposed projects cannot resume a draft',async()=>{
  for(const blocked of ['design','access','busy','disposed']) {
    const {state,navigation}=subject();
    state.edits.set([{id:'saved-draft'}]);
    if(blocked==='access') state.project.set(null);
    else if(blocked==='busy') state.busy.set(true);
    else state[blocked]=true;
    await state.continueProject();
    assert.deepEqual(navigation,[]);
  }
});
