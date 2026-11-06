import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { AdminConsoleComponent } from '../../.local/tests/client.mjs';

test('the initial access lookup runs while its loading indicator starts active', async () => {
  const component = Object.create(AdminConsoleComponent.prototype);
  let calls = 0;
  component.api = { access: async () => {
    calls++;
    return { granted: false, mfaEnabled: false, permissions: [], workspaceIds: [], elevatedUntil: null };
  } };
  component.access = signal(null);
  component.accessVersion = 0;
  component.loadingAccess = signal(true);
  component.activeView = signal('summary');
  component.summaryRows = signal({});
  component.message = signal('');
  component.error = signal('');
  component.notFound = signal(false);
  component.elevatedUntil = signal('');
  component.now = signal(Date.now());
  component.section = signal(null);
  component.clearData = () => {};

  await component.refreshAccess();

  assert.equal(calls, 1);
  assert.equal(component.access().granted, false);
  assert.equal(component.loadingAccess(), false);
});
