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
