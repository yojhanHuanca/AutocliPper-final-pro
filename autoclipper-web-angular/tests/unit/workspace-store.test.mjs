import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ApiTransport, WorkspaceStore } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const renderer = { insertRootElement() {}, removeAllRootElements() {} };
const workspace = (id, kind = 'team') => ({ id, name: id, kind, role: 'owner', createdAt: '2026-01-01T00:00:00.000Z' });
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };

test('creating a team uses its contract kind and selects the created workspace', async () => {
  const writes = [];
  TestBed.configureTestingModule({ providers: [
    WorkspaceStore,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiTransport, useValue: {
      post: async (...args) => { writes.push(args); return { id: 'team-new' }; },
      get: async () => ({ items: [workspace('team-existing'), workspace('team-new')] }),
    } },
  ] });
  try {
    const store = TestBed.inject(WorkspaceStore);
    await store.createTeam('Estudio nuevo');
    assert.deepEqual(writes[0].slice(0, 2), ['/workspaces', { name: 'Estudio nuevo', kind: 'team' }]);
    assert.ok(writes[0][2], 'workspace creation is protected by an idempotency key');
    assert.equal(store.workspaceId(), 'team-new');
  } finally { TestBed.resetTestingModule(); }
});

test('accepting an invitation refreshes memberships and selects the newly joined workspace',async()=>{
  const calls=[];let list=0;
  TestBed.configureTestingModule({providers:[WorkspaceStore,{provide:TestComponentRenderer,useValue:renderer},{provide:ApiTransport,useValue:{
    post:async(...args)=>{calls.push(args);},
    get:async path=>{assert.equal(path,'/workspaces');return{items:++list===1?[workspace('personal','personal')]:[workspace('personal','personal'),workspace('team-invited')]};},
  }}]});
  try{
    const store=TestBed.inject(WorkspaceStore);
    await store.loadWorkspaces();
    const before=store.workspaces().map(item=>item.id);
    await store.acceptInvitation('opaque-token',before,'invited-user');
    assert.deepEqual(calls,[['/workspaces/invitations/accept',{token:'opaque-token'}]]);
    assert.deepEqual(store.workspaces().map(item=>item.id),['personal','team-invited']);
    assert.equal(store.workspaceId(),'team-invited');
  }finally{TestBed.resetTestingModule();}
});

test('acceptance does not switch context when more than one membership appeared during the invite',async()=>{
  let list=0;
  TestBed.configureTestingModule({providers:[WorkspaceStore,{provide:TestComponentRenderer,useValue:renderer},{provide:ApiTransport,useValue:{
    post:async()=>{},get:async()=>({items:++list===1?[workspace('personal','personal')]:[workspace('personal','personal'),workspace('team-a'),workspace('team-b')]})
  }}]});
  try{
    const store=TestBed.inject(WorkspaceStore);await store.loadWorkspaces();
    await store.acceptInvitation('opaque-token',['personal'],'invited-user');
    assert.equal(store.workspaceId(),'personal','Ambiguous concurrent memberships must not select an unrelated team.');
  }finally{TestBed.resetTestingModule();}
});

test('a late invitation acceptance does not replace a workspace chosen while membership refresh is pending',async()=>{
  let gets=0,resolveAcceptedWorkspaces;
  TestBed.configureTestingModule({providers:[WorkspaceStore,{provide:TestComponentRenderer,useValue:renderer},{provide:ApiTransport,useValue:{
    post:async()=>{},
    get:()=>{
      if(++gets===1)return Promise.resolve({items:[workspace('personal','personal'),workspace('other')]});
      return new Promise(resolve=>resolveAcceptedWorkspaces=resolve);
    }
  }}]});
  try{
    const store=TestBed.inject(WorkspaceStore);
    await store.loadWorkspaces();
    const previous=store.workspaces().map(item=>item.id);
    const acceptance=store.acceptInvitation('one-use-token',previous,'invited-user');
    await new Promise(resolve=>setImmediate(resolve));
    store.workspaceId.set('other');
    resolveAcceptedWorkspaces({items:[workspace('personal','personal'),workspace('other'),workspace('team-invited')]});
    await acceptance;
    assert.equal(store.workspaceId(),'other');
  }finally{TestBed.resetTestingModule();}
});

test('accepting the only new membership from an empty selection still selects that workspace',async()=>{
  TestBed.configureTestingModule({providers:[WorkspaceStore,{provide:TestComponentRenderer,useValue:renderer},{provide:ApiTransport,useValue:{
    post:async()=>{},get:async()=>({items:[workspace('team-invited')]})
  }}]});
  try{
    const store=TestBed.inject(WorkspaceStore);
    await store.acceptInvitation('one-use-token',[],'invited-user');
    assert.equal(store.workspaceId(),'team-invited');
  }finally{TestBed.resetTestingModule();}
});

test('an accepted one-use invitation retries only the workspace refresh after a transient list failure',async()=>{
  let acceptCalls=0,listCalls=0;
  TestBed.configureTestingModule({providers:[WorkspaceStore,{provide:TestComponentRenderer,useValue:renderer},{provide:ApiTransport,useValue:{
    post:async(...args)=>{acceptCalls++;assert.deepEqual(args.slice(0,2),['/workspaces/invitations/accept',{token:'one-use-token'}]);},
    get:async()=>{if(++listCalls===2)throw new Error('temporary list outage');return{items:listCalls===1?[workspace('personal','personal')]:[workspace('personal','personal'),workspace('team-invited')]};},
  }}]});
  try{
    const store=TestBed.inject(WorkspaceStore);await store.loadWorkspaces();
    const previous=store.workspaces().map(item=>item.id);
    await assert.rejects(store.acceptInvitation('one-use-token',previous,'invited-user'),/se aceptó.*no pudimos actualizar.*no volveremos a enviar/i);
    assert.equal(acceptCalls,1);
    await store.acceptInvitation('one-use-token',previous,'invited-user');
    assert.equal(acceptCalls,1,'The one-use acceptance token is never submitted twice after confirmed acceptance.');
    assert.equal(listCalls,3);
    assert.equal(store.workspaceId(),'team-invited');
  }finally{TestBed.resetTestingModule();}
});

test('a pending accepted invitation cannot refresh workspace access under a different account',async()=>{
  let acceptCalls=0;
  let failList=true;
  TestBed.configureTestingModule({providers:[WorkspaceStore,{provide:TestComponentRenderer,useValue:renderer},{provide:ApiTransport,useValue:{
    post:async()=>{acceptCalls++;},
    get:async()=>{if(failList){failList=false;throw new Error('temporary list outage');}return{items:[workspace('personal','personal')]};},
  }}]});
  try{
    const store=TestBed.inject(WorkspaceStore);
    await assert.rejects(store.acceptInvitation('one-use-token',['personal'],'invited-user'),/se aceptó/);
    await assert.rejects(store.acceptInvitation('one-use-token',['personal'],'different-user'),/misma cuenta/);
    assert.equal(acceptCalls,1);
  }finally{TestBed.resetTestingModule();}
});

test('a superseded workspace response does not finalize invitation acceptance before a current refresh',async()=>{
  let postCalls=0,getCalls=0,resolveAcceptanceList;
  TestBed.configureTestingModule({providers:[WorkspaceStore,{provide:TestComponentRenderer,useValue:renderer},{provide:ApiTransport,useValue:{
    post:async()=>{postCalls++;},
    get:()=>{
      getCalls++;
      if(getCalls===1)return Promise.resolve({items:[workspace('personal','personal')]});
      if(getCalls===2)return new Promise(resolve=>resolveAcceptanceList=resolve);
      if(getCalls===3)return Promise.resolve({items:[workspace('personal','personal')]});
      return Promise.resolve({items:[workspace('personal','personal'),workspace('team-invited')]});
    },
  }}]});
  try{
    const store=TestBed.inject(WorkspaceStore);await store.loadWorkspaces();
    const accepting=store.acceptInvitation('one-use-token',['personal'],'invited-user');
    await new Promise(resolve=>setImmediate(resolve));
    await store.loadWorkspaces();
    resolveAcceptanceList({items:[workspace('personal','personal'),workspace('team-invited')]});
    await assert.rejects(accepting,/no pudimos actualizar/);
    await store.acceptInvitation('one-use-token',['personal'],'invited-user');
    assert.equal(postCalls,1);
    assert.equal(store.workspaceId(),'team-invited');
  }finally{TestBed.resetTestingModule();}
});

test('a failed post-create list refresh can be retried without creating a duplicate workspace', async () => {
  let posts = 0, gets = 0;
  const idempotencyKeys = [];
  TestBed.configureTestingModule({ providers: [
    WorkspaceStore,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiTransport, useValue: {
      post: async (_path, _body, key) => { posts++; idempotencyKeys.push(key); return { id: 'personal-created' }; },
      get: async () => {
        if (++gets === 1) throw new Error('list unavailable');
        return { items: [workspace('personal-created', 'personal')] };
      },
    } },
  ] });
  try {
    const store = TestBed.inject(WorkspaceStore);
    await assert.rejects(store.createPersonal('Mi estudio'), /no pudimos actualizar la lista/);
    await store.createPersonal('Mi estudio');
    assert.equal(posts, 1);
    assert.equal(idempotencyKeys[0].length > 0, true);
    assert.equal(store.workspaceId(), 'personal-created');
  } finally { TestBed.resetTestingModule(); }
});

test('late workspace loads cannot overwrite the newest workspace list', async () => {
  const calls = [deferred(), deferred()];
  let index = 0;
  TestBed.configureTestingModule({ providers: [
    WorkspaceStore,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiTransport, useValue: { get: () => calls[index++].promise } },
  ] });
  try {
    const store = TestBed.inject(WorkspaceStore);
    const oldLoad = store.loadWorkspaces();
    const newLoad = store.loadWorkspaces();
    calls[1].resolve({ items: [workspace('current')] });
    await newLoad;
    calls[0].resolve({ items: [workspace('stale')] });
    await oldLoad;
    assert.deepEqual(store.workspaces().map(item => item.id), ['current']);
  } finally { TestBed.resetTestingModule(); }
});

test('a completed team creation does not replace a workspace selected while it was pending', async () => {
  const pendingCreate = deferred();
  TestBed.configureTestingModule({ providers: [
    WorkspaceStore,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiTransport, useValue: {
      post: () => pendingCreate.promise,
      get: async () => ({ items: [workspace('team-existing'), workspace('team-new'), workspace('team-other')] }),
    } },
  ] });
  try {
    const store = TestBed.inject(WorkspaceStore);
    store.workspaceId.set('team-existing');
    const creation = store.createTeam('New team');
    store.workspaceId.set('team-other');
    pendingCreate.resolve({ id: 'team-new' });
    await creation;
    assert.equal(store.workspaceId(), 'team-other');
  } finally { TestBed.resetTestingModule(); }
});

test('creation from an empty selection does not replace a workspace chosen while the request was pending',async()=>{
  const pendingCreate=deferred();
  TestBed.configureTestingModule({providers:[WorkspaceStore,{provide:TestComponentRenderer,useValue:renderer},{provide:ApiTransport,useValue:{
    post:()=>pendingCreate.promise,
    get:async()=>({items:[workspace('team-existing'),workspace('team-new')]})
  }}]});
  try{
    const store=TestBed.inject(WorkspaceStore);
    const creation=store.createTeam('New team');
    store.workspaceId.set('team-existing');
    pendingCreate.resolve({id:'team-new'});
    await creation;
    assert.equal(store.workspaceId(),'team-existing');
  }finally{TestBed.resetTestingModule();}
});

test('retrying a created workspace refresh preserves a workspace selected after the original attempt',async()=>{
  let posts=0,gets=0;
  TestBed.configureTestingModule({providers:[WorkspaceStore,{provide:TestComponentRenderer,useValue:renderer},{provide:ApiTransport,useValue:{
    post:async()=>{posts++;return{id:'team-new'};},
    get:async()=>{if(++gets===1)throw new Error('temporary list outage');return{items:[workspace('team-existing'),workspace('team-new')]};}
  }}]});
  try{
    const store=TestBed.inject(WorkspaceStore);
    await assert.rejects(store.createTeam('New team'),/no pudimos actualizar la lista/);
    store.workspaceId.set('team-existing');
    await store.createTeam('New team');
    assert.equal(posts,1,'Retrying only refreshes the list after the server accepted creation.');
    assert.equal(store.workspaceId(),'team-existing');
  }finally{TestBed.resetTestingModule();}
});

test('a creation response arriving after logout cannot restore pending workspace state', async () => {
  const pendingCreate = deferred();
  let gets = 0;
  TestBed.configureTestingModule({ providers: [
    WorkspaceStore,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiTransport, useValue: {
      post: () => pendingCreate.promise,
      get: async () => { gets++; return { items: [workspace('old-account-team')] }; },
    } },
  ] });
  try {
    const store = TestBed.inject(WorkspaceStore);
    const creation = store.createTeam('Private team');
    store.clear();
    pendingCreate.resolve({ id: 'old-account-team' });
    await assert.rejects(creation, /sesión cambió/i);
    assert.deepEqual(store.workspaces(), []);
    assert.equal(store.workspaceId(), '');
    assert.equal(store.loaded(), false);
    assert.equal(gets, 0, 'A stale create response must not trigger a refresh in the new session.');
    await store.createTeam('Private team');
    assert.equal(gets, 1, 'The new session can start a clean creation flow.');
  } finally { TestBed.resetTestingModule(); }
});

test('an invitation response arriving after logout cannot restore the old account pending refresh', async () => {
  const pendingAccept = deferred();
  let posts = 0, gets = 0;
  TestBed.configureTestingModule({ providers: [
    WorkspaceStore,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiTransport, useValue: {
      post: () => { posts++; return pendingAccept.promise; },
      get: async () => { gets++; return { items: [workspace('new-account-team')] }; },
    } },
  ] });
  try {
    const store = TestBed.inject(WorkspaceStore);
    const acceptance = store.acceptInvitation('one-use-token', [], 'old-account');
    store.clear();
    pendingAccept.resolve();
    await assert.rejects(acceptance, /sesión cambió/i);
    assert.deepEqual(store.workspaces(), []);
    assert.equal(store.loaded(), false);
    await store.acceptInvitation('new-token', [], 'new-account');
    assert.equal(posts, 2, 'The new account may accept its own invitation after old session state was cleared.');
    assert.equal(gets, 1);
    assert.equal(store.workspaceId(), 'new-account-team');
  } finally { TestBed.resetTestingModule(); }
});
