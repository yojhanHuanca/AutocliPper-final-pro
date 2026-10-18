import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { DESIGN_MODE, SessionStore, WorkspaceStore, WorkspaceTeamComponent, WorkspaceTeamApi } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const renderer = { insertRootElement() {}, removeAllRootElements() {} };
const teamSpaces = [
  { id: 'alpha', name: 'Alpha', kind: 'team', role: 'owner' },
  { id: 'beta', name: 'Beta', kind: 'team', role: 'owner' },
];
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };

function setup(api) {
  const store = { workspaces: signal(teamSpaces), workspaceId: signal('alpha'), loadCalls: 0, async loadWorkspaces() { this.loadCalls++; } };
  TestBed.configureTestingModule({ providers: [
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: DESIGN_MODE, useValue: false },
    { provide: WorkspaceStore, useValue: store },
    { provide: WorkspaceTeamApi, useValue: api },
    { provide: SessionStore, useValue: { user: signal({ id: 'actor' }) } },
  ] });
  return { store, component: TestBed.runInInjectionContext(() => new WorkspaceTeamComponent()) };
}

test('a late invitation response cannot update the newly selected workspace', async () => {
  const pending = deferred();
  const calls = [];
  const api = { members: async () => ({ items: [] }), invite: (...args) => { calls.push(args); return pending.promise; } };
  const { store, component } = setup(api);
  try {
    component.inviteEmail = 'guest@example.com';
    const request = component.invite();
    assert.equal(calls[0][0], 'alpha');
    store.workspaceId.set('beta');
    pending.resolve();
    await request;
    assert.equal(component.message(), '');
    assert.equal(component.inviteEmail, 'guest@example.com', 'the stale response must not clear the new workspace draft');
  } finally { TestBed.resetTestingModule(); }
});

test('a role change response does not refresh another selected workspace', async () => {
  const pending = deferred();
  const calls = [];
  const api = { members: async () => ({ items: [] }), setRole: (...args) => { calls.push(args); return pending.promise; } };
  const { store, component } = setup(api);
  try {
    const member = { userId: 'editor-1', role: 'editor', createdAt: '2026-01-01T00:00:00.000Z' };
    component.roleDrafts.set({ [member.userId]: 'reader' });
    const request = component.saveRole(member);
    assert.deepEqual(calls[0], ['alpha', 'editor-1', 'reader']);
    store.workspaceId.set('beta');
    pending.resolve();
    await request;
    assert.equal(store.loadCalls, 0);
    assert.equal(component.message(), '');
  } finally { TestBed.resetTestingModule(); }
});

test('design, denied and loading team states cannot invite, change roles, remove or transfer',async()=>{
  const calls=[];
  const api={members:async()=>({items:[]}),invite:async()=>calls.push('invite'),setRole:async()=>calls.push('role'),remove:async()=>calls.push('remove'),transfer:async()=>calls.push('transfer')};
  for(const blocked of ['design','forbidden','loading']) {
    const {component}=setup(api);
    try {
      const member={userId:'guest',role:'editor'};
      component.members.set([member]); component.roleDrafts.set({guest:'reader'});
      component.pendingRemoval.set('guest'); component.transferTarget.set('guest'); component.transferConfirmation.set(true);
      if(blocked==='design') component.design=true; else component[blocked].set(true);
      await component.invite(); await component.saveRole(member); await component.confirmRemove(member); await component.transferOwnership();
    } finally {TestBed.resetTestingModule();}
  }
  assert.deepEqual(calls,[]);
});

test('workspace administrator cannot promote another member to administrator through a draft',async()=>{
  const calls=[];
  const {component,store}=setup({members:async()=>({items:[]}),setRole:async(...args)=>calls.push(args)});
  try {
    store.workspaces.set([{id:'alpha',name:'Alpha',kind:'team',role:'admin'}]);
    component.roleDrafts.set({guest:'admin'});
    await component.saveRole({userId:'guest',role:'editor'});
    assert.deepEqual(calls,[]);
  } finally {TestBed.resetTestingModule();}
});

test('a denied member refresh clears people, role drafts and destructive confirmations',async()=>{
  const {component}=setup({members:async()=>{throw new HttpErrorResponse({status:403});}});
  try {
    component.members.set([{userId:'former-member',role:'editor'}]);
    component.roleDrafts.set({'former-member':'reader'});
    component.pendingRemoval.set('former-member'); component.transferTarget.set('former-member'); component.transferConfirmation.set(true);
    await component.refresh();
    assert.deepEqual(component.members(),[]);
    assert.deepEqual(component.roleDrafts(),{});
    assert.equal(component.pendingRemoval(),''); assert.equal(component.transferTarget(),'');
    assert.equal(component.transferConfirmation(),false);
    assert.equal(component.canManage(),false);
    assert.equal(component.canTransfer(),false);
    assert.equal(component.membersLoaded(),false);
  } finally {TestBed.resetTestingModule();}
});


test('member count is only confirmed after a successful response and is unknown during refresh failure',async()=>{
  const pending=deferred();
  const api={members:()=>pending.promise};
  const {component}=setup(api);
  try {
    const request=component.refresh();
    assert.equal(component.membersLoaded(),false);
    pending.resolve({items:[{userId:'actor',role:'owner',createdAt:'2026-10-18T00:00:00.000Z'}]});
    await request;
    assert.equal(component.membersLoaded(),true); assert.equal(component.members().length,1);
    api.members=async()=>{throw new Error('temporarily unavailable');};
    await component.refresh();
    assert.equal(component.membersLoaded(),false);
    assert.equal(component.members().length,1,'previous rows remain qualified by the error, without a current count');
  } finally {TestBed.resetTestingModule();}
});
