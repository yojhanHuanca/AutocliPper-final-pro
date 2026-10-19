import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computed, signal } from '@angular/core';
import { AdminConsoleComponent } from '../../.local/tests/client.mjs';

function subject(access) {
  const component = Object.create(AdminConsoleComponent.prototype);
  component.access = signal(access);
  component.now = signal(Date.now());
  component.isElevated = computed(() => !!component.access()?.elevatedUntil && Date.parse(component.access().elevatedUntil) > component.now());
  component.section = signal('users');
  component.activeView = signal('summary');
  component.sections = [
    { id: 'users', permission: 'users.read', label: 'Usuarios', icon: 'users' },
    { id: 'workspaces', permission: 'workspaces.read', label: 'Espacios', icon: 'folder' },
    { id: 'jobs', permission: 'jobs.read', label: 'Procesamiento', icon: 'film' },
    { id: 'consumption', permission: 'consumption.read', label: 'Consumo', icon: 'chart' },
  ];
  component.availableSections = computed(() => component.sections.filter(item => component.access()?.permissions.includes(item.permission)));
  component.workspaceFilter = signal('');
  component.localSearch = signal('');
  component.jobKindFilter = signal('');
  component.jobStatusFilter = signal('');
  component.loadingPage = signal(false);
  component.pageFailed = signal(false);
  component.message = signal('');
  component.error = signal('');
  component.pageVersion = 0;
  component.accessVersion = 0;
  component.users = signal([]);
  component.workspaces = signal([]);
  component.jobs = signal([]);
  component.consumption = signal([]);
  component.nextBeforeId = signal(null);
  component.loadingAccess = signal(false);
  component.notFound = signal(false);
  component.elevatedUntil = signal('');
  component.apiCalls = 0;
  component.api = { users: async () => { component.apiCalls++; return { items: [], nextBeforeId: null }; } };
  return component;
}

const access = (overrides = {}) => ({ granted: true, mfaEnabled: true, permissions: ['users.read'], workspaceIds: null, elevatedUntil: new Date(Date.now() + 60_000).toISOString(), ...overrides });

test('the console requests no administrative rows without a grant, MFA and fresh elevation', async () => {
  for (const state of [
    access({ granted: false }),
    access({ mfaEnabled: false }),
    access({ elevatedUntil: null }),
    access({ elevatedUntil: new Date(Date.now() - 1000).toISOString() }),
    access({ permissions: [] }),
  ]) {
    const component = subject(state);
    await component.loadSection();
    assert.equal(component.apiCalls, 0);
  }
});

test('changing workspace scope and reducing permissions clears old rows/cursor before reloading the active allowed section', async () => {
  const previous = access({ permissions: ['workspaces.read', 'jobs.read'], workspaceIds: ['workspace-A'] });
  const next = access({ permissions: ['workspaces.read'], workspaceIds: ['workspace-B'] });
  const component = subject(previous);
  component.sections = [
    { id: 'users', permission: 'users.read', label: 'Usuarios', icon: 'users' },
    { id: 'workspaces', permission: 'workspaces.read', label: 'Espacios', icon: 'folder' },
    { id: 'jobs', permission: 'jobs.read', label: 'Procesamiento', icon: 'film' },
    { id: 'consumption', permission: 'consumption.read', label: 'Consumo', icon: 'chart' },
  ];
  component.availableSections = computed(() => component.sections.filter(item => component.access()?.permissions.includes(item.permission)));
  component.section.set('workspaces');
  component.workspaceFilter.set('workspace-A');
  component.workspaces.set([{ id: 'workspace-A' }]);
  component.jobs.set([{ id: 'old-authorized-job' }]);
  component.nextBeforeId.set('old-scope-cursor');
  const filteredRequests = [];
  component.api.access = async () => next;
  component.api.workspaces = async (beforeId, workspaceId) => {
    filteredRequests.push({ beforeId, workspaceId });
    return { items: [{ id: 'workspace-B' }], nextBeforeId: null };
  };

  await component.refreshAccess();

  assert.equal(component.workspaceFilter(), '', 'a filter from the revoked scope is discarded');
  assert.deepEqual(filteredRequests, [{ beforeId: undefined, workspaceId: undefined }]);
  assert.deepEqual(component.workspaces(), [{ id: 'workspace-B' }]);
  assert.deepEqual(component.jobs(), [], 'the revoked jobs permission cannot leave old rows in memory');
  assert.equal(component.nextBeforeId(), null, 'the cursor from the previous scope is discarded');
});

test('a revoked active section is replaced by an allowed section and its old rows are removed', async () => {
  const previous = access({ permissions: ['workspaces.read', 'jobs.read'], workspaceIds: ['workspace-A'] });
  const next = access({ permissions: ['workspaces.read'], workspaceIds: ['workspace-A'] });
  const component = subject(previous);
  component.sections = [
    { id: 'users', permission: 'users.read', label: 'Usuarios', icon: 'users' },
    { id: 'workspaces', permission: 'workspaces.read', label: 'Espacios', icon: 'folder' },
    { id: 'jobs', permission: 'jobs.read', label: 'Procesamiento', icon: 'film' },
    { id: 'consumption', permission: 'consumption.read', label: 'Consumo', icon: 'chart' },
  ];
  component.availableSections = computed(() => component.sections.filter(item => component.access()?.permissions.includes(item.permission)));
  component.section.set('jobs');
  component.jobs.set([{ id: 'revoked-job' }]);
  component.nextBeforeId.set('job-cursor');
  const calls = [];
  component.api.access = async () => next;
  component.api.workspaces = async () => { calls.push('workspaces'); return { items: [{ id: 'workspace-A' }], nextBeforeId: null }; };
  component.api.jobs = async () => { calls.push('jobs'); return { items: [], nextBeforeId: null }; };

  await component.refreshAccess();

  assert.equal(component.section(), 'workspaces');
  assert.deepEqual(calls, ['workspaces']);
  assert.deepEqual(component.jobs(), []);
  assert.equal(component.nextBeforeId(), null);
});

test('a missing published access endpoint leaves the console in a closed waiting state', async () => {
  const component = subject(null);
  component.section.set(null);
  component.api.access = async () => { throw { status: 404 }; };
  await component.refreshAccess();
  assert.equal(component.notFound(), true);
  assert.equal(component.access(), null);
  assert.equal(component.apiCalls, 0);
});

test('an authorized, elevated read calls only its permitted data endpoint', async () => {
  const component = subject(access());
  await component.loadSection();
  assert.equal(component.apiCalls, 1);
  assert.equal(component.loadingPage(), false);
});

test('overview links open only permissioned sections and return to summary without querying audit', async () => {
  const component = subject(access());
  await component.selectSection('jobs');
  assert.equal(component.activeView(), 'summary', 'a section without an explicit read grant stays closed');
  assert.equal(component.apiCalls, 0);
  await component.selectSection('users');
  assert.equal(component.activeView(), 'users');
  assert.equal(component.apiCalls, 1);
  component.showSummary();
  assert.equal(component.activeView(), 'summary');
  assert.equal(component.apiCalls, 1, 'returning to overview performs no extra reads');
});

test('local search and job filters apply only to authorized rows already loaded', () => {
  const component = subject(access({ permissions: ['jobs.read'] }));
  component.section.set('jobs');
  component.jobs.set([
    { id: 'job-1', workspaceId: 'w-1', kind: 'pipeline', status: 'failed', errorCode: 'RENDER_FAILED', createdAt: '2026-10-18T00:00:00Z', finishedAt: null },
    { id: 'job-2', workspaceId: 'w-2', kind: 'render', status: 'succeeded', errorCode: null, createdAt: '2026-10-18T00:00:00Z', finishedAt: '2026-10-18T00:01:00Z' },
  ]);
  component.localSearch.set('render_failed');
  assert.deepEqual(component.visibleJobs().map(job => job.id), ['job-1']);
  component.localSearch.set('');
  component.jobKindFilter.set('pipeline');
  component.jobStatusFilter.set('succeeded');
  assert.deepEqual(component.visibleJobs(), []);
  assert.equal(component.loadedRowCount(), 2);
  assert.equal(component.visibleRowCount(), 0);
  assert.equal(component.noRowsMessage(), 'Ninguna fila consultada coincide con estos filtros.');
});

test('job status colors distinguish active, complete, failed, cancelled and unknown server states', () => {
  const component = subject(access({ permissions: ['jobs.read'] }));
  assert.equal(component.jobStatusTone('queued'), 'queued');
  assert.equal(component.jobStatusTone('transcribing'), 'active');
  assert.equal(component.jobStatusTone('succeeded'), 'success');
  assert.equal(component.jobStatusTone('failed'), 'error');
  assert.equal(component.jobStatusTone('cancelled'), 'stopped');
  assert.equal(component.jobStatusTone('unrecognized'), 'unknown');
});

test('a late page cannot repopulate rows after a capability refresh starts', async () => {
  const component = subject(access());
  let resolvePage;
  let resolveAccess;
  component.api.users = () => new Promise(resolve => { resolvePage = resolve; });
  component.api.access = () => new Promise(resolve => { resolveAccess = resolve; });
  const page = component.loadSection();
  const refresh = component.refreshAccess();
  resolvePage({ items: [{ id: 'obsolete-user' }], nextBeforeId: 'obsolete-cursor' });
  await page;
  assert.deepEqual(component.users(), []);
  resolveAccess(access({ granted: false, permissions: [], elevatedUntil: null }));
  await refresh;
  assert.deepEqual(component.users(), []);
  assert.equal(component.nextBeforeId(), null);
});

test('expiry is checked against actual time before requests and after responses', async () => {
  const component = subject(access());
  component.now.set(Date.now() - 120_000);
  component.access.set(access({ elevatedUntil: new Date(Date.now() - 1).toISOString() }));
  await component.loadSection();
  assert.equal(component.apiCalls, 0);
  component.access.set(access());
  let resolvePage;
  component.api.users = () => new Promise(resolve => { resolvePage = resolve; });
  const page = component.loadSection();
  component.access.set(access({ elevatedUntil: new Date(Date.now() - 1).toISOString() }));
  resolvePage({ items: [{ id: 'expired-user' }], nextBeforeId: null });
  await page;
  assert.deepEqual(component.users(), []);
});

test('401/403 close access without automatic row retries, while 429/503 remain explicit query failures', async () => {
  for (const status of [401, 403, 429, 503]) {
    const component = subject(access());
    component.users.set([{ id: 'previous-user' }]);
    component.api.users = async () => { component.apiCalls++; throw { status }; };
    component.api.access = async () => { throw new Error('must not refresh automatically'); };
    await component.loadSection();
    assert.deepEqual(component.users(), []);
    assert.equal(component.apiCalls, 1);
    assert.equal(component.pageFailed(), true);
    assert.equal(component.loadingPage(), false);
    assert.equal(component.access() === null, status === 401 || status === 403);
  }
});

test('same-scope refresh reloads the selected section, and reauthentication cannot restore superseded access', async () => {
  const component = subject(access());
  component.api.access = async () => access();
  await component.refreshAccess();
  assert.equal(component.apiCalls, 1);
  component.mutationBusy = signal(false);
  component.password = 'synthetic-password';
  component.factor = '123456';
  let resolveElevation;
  component.api.elevate = () => new Promise(resolve => { resolveElevation = resolve; });
  const elevation = component.elevate();
  component.api.access = async () => access({ granted: false, permissions: [], elevatedUntil: null });
  await component.refreshAccess();
  resolveElevation({ elevatedUntil: new Date(Date.now() + 300_000).toISOString() });
  await elevation;
  assert.equal(component.access().granted, false);
  assert.equal(component.access().elevatedUntil, null);
  assert.equal(component.password, '');
  assert.equal(component.factor, '');
  assert.equal(component.apiCalls, 1);
});

test('a read denied during capability refresh leaves an actionable closed state', async () => {
  const component = subject(access());
  component.api.access = async () => access();
  component.api.users = async () => { throw { status: 403 }; };
  await component.refreshAccess();
  assert.equal(component.access(), null);
  assert.equal(component.loadingAccess(), false);
  assert.equal(component.loadingPage(), false);
  assert.match(component.error(), /rechazó el acceso/);
});
