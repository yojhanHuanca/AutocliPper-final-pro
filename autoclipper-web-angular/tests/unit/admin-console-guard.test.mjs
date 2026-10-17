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
  component.workspaceFilter = signal('');
  component.loadingPage = signal(false);
  component.error = signal('');
  component.pageVersion = 0;
  component.users = signal([]);
  component.workspaces = signal([]);
  component.jobs = signal([]);
  component.consumption = signal([]);
  component.nextBeforeId = signal(null);
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

test('an authorized, elevated read calls only its permitted data endpoint', async () => {
  const component = subject(access());
  await component.loadSection();
  assert.equal(component.apiCalls, 1);
  assert.equal(component.loadingPage(), false);
});
