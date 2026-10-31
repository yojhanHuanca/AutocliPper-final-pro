import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ApiTransport, WorkspaceTeamApi, WorkspaceTeamComponent, parseWorkspaceInvitations, workspaceInvitationStatus } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const renderer = { insertRootElement() {}, removeAllRootElements() {} };
const invitationId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };

test('parses the workspace service invitation payload and classifies each lifecycle state', () => {
  const rows = parseWorkspaceInvitations({ items: [
    { id: invitationId, email: 'pending@example.test', role: 'editor', expires_at: '2099-01-01T00:00:00.000Z', accepted_at: null, revoked_at: null },
    { id: '6ba7b811-9dad-41d1-80b4-00c04fd430c8', email: 'accepted@example.test', role: 'reader', expires_at: '2099-01-01T00:00:00.000Z', accepted_at: '2026-10-01T00:00:00.000Z', revoked_at: null },
    { id: '6ba7b812-9dad-41d1-80b4-00c04fd430c8', email: 'expired@example.test', role: 'admin', expires_at: '2020-01-01T00:00:00.000Z', accepted_at: null, revoked_at: null },
    { id: '6ba7b813-9dad-41d1-80b4-00c04fd430c8', email: 'revoked@example.test', role: 'editor', expires_at: '2099-01-01T00:00:00.000Z', accepted_at: null, revoked_at: '2026-10-01T00:00:00.000Z' },
  ] });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => workspaceInvitationStatus(row, Date.parse('2026-10-28T00:00:00.000Z'))), ['pending', 'accepted', 'expired', 'revoked']);
  assert.equal(rows[0].expiresAt, '2099-01-01T00:00:00.000Z');
});

test('rejects malformed or unsupported invitation data instead of displaying it', () => {
  assert.throws(() => parseWorkspaceInvitations({}), /formato inesperado/);
  assert.throws(() => parseWorkspaceInvitations({ items: [{ id: invitationId, email: 'x@example.test', role: 'owner', expires_at: '2099-01-01', accepted_at: null, revoked_at: null }] }), /formato inesperado/);
  assert.throws(() => parseWorkspaceInvitations({ items: Array.from({ length: 101 }, () => ({})) }), /formato inesperado/);
});

test('uses the implemented invitation list and revoke routes with encoded identifiers', async () => {
  const calls = [];
  TestBed.configureTestingModule({ providers: [
    WorkspaceTeamApi,
    { provide: ApiTransport, useValue: {
      get: async path => { calls.push(['GET', path]); return { items: [] }; },
      delete: async path => { calls.push(['DELETE', path]); return { revoked: true }; },
    } },
    { provide: TestComponentRenderer, useValue: renderer },
  ] });
  try {
    const api = TestBed.inject(WorkspaceTeamApi);
    await api.invitations('team / one');
    await api.revokeInvitation('team / one', invitationId);
    assert.deepEqual(calls, [
      ['GET', '/workspaces/team%20%2F%20one/invitations'],
      ['DELETE', `/workspaces/team%20%2F%20one/invitations/${invitationId}`],
    ]);
  } finally { TestBed.resetTestingModule(); }
});

function invitationContext(api, workspaceId = 'alpha') {
  const workspaces = [
    { id: 'alpha', name: 'Alpha', kind: 'team', role: 'owner' },
    { id: 'beta', name: 'Beta', kind: 'team', role: 'owner' },
  ];
  const component = Object.create(WorkspaceTeamComponent.prototype);
  Object.assign(component, {
    workspaceStore: { workspaceId: signal(workspaceId) },
    activeWorkspace: () => workspaces.find(workspace => workspace.id === component.workspaceStore.workspaceId()),
    actorRole: () => 'owner',
    canManage: () => true,
    design: false,
    destroyed: false,
    mutationBusy: signal(false),
    error: signal(''),
    message: signal(''),
    invitationDrafts: new Map(),
    api,
    loadInvitations: async () => {},
  });
  return component;
}

test('invitation idempotency draft is preserved per workspace when switching context', async () => {
  const pending = deferred();
  const keys = [];
  const component = invitationContext({
    members: async () => ({ items: [] }),
    invitations: async () => ({ items: [] }),
    invite: (_workspaceId, _body, key) => { keys.push(key); return keys.length === 1 ? pending.promise : Promise.resolve({ id: invitationId }); },
  });
  try {
    component.inviteEmail = 'first@example.test';
    const firstRequest = component.invite();
    const originalKey = component.inviteKey;
    assert.ok(originalKey);
    component.workspaceStore.workspaceId.set('beta');
    assert.equal(component.inviteEmail, '', 'Drafts do not leak into another workspace.');
    assert.equal(component.inviteKey, '', 'Idempotency keys are scoped to their workspace.');
    component.inviteEmail = 'second@example.test';
    pending.resolve({ id: invitationId });
    await firstRequest;
    component.workspaceStore.workspaceId.set('alpha');
    assert.equal(component.inviteEmail, 'first@example.test');
    assert.equal(component.inviteKey, originalKey, 'A context switch must not lose the retry key for a request with an unknown outcome.');
    await component.invite();
    assert.deepEqual(keys, [originalKey, originalKey], 'Retry submits the same invitation idempotency key.');
    assert.equal(component.inviteEmail, '');
  } finally { TestBed.resetTestingModule(); }
});

test('a server permission denial requires workspace access refresh before management continues', () => {
  const component = invitationContext({});
  Object.assign(component, {
    workspacePermissionsUnconfirmed: signal(false),
    workspaceListRefreshFailed: signal(false),
  });
  component.markWorkspacePermissionsUnconfirmed(new HttpErrorResponse({ status: 403 }));
  assert.equal(component.workspacePermissionsUnconfirmed(), true);
  assert.match(component.error(), /actualiza los espacios/i);
});
