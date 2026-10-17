import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
