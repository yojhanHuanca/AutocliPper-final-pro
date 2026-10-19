import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { AuthComponent, buildLoginPayload, safeAuthReturnUrl } from '../../.local/tests/client.mjs';

test('invitation login accepts optional TOTP or recovery factors like regular login', () => {
  assert.deepEqual(buildLoginPayload('  person@example.com ', 'secret', ' 123456 '), {
    email: 'person@example.com', password: 'secret', factor: '123456',
  });
  assert.deepEqual(buildLoginPayload(' person@example.com ', 'secret', '  '), {
    email: 'person@example.com', password: 'secret',
  });
});

test('session redirects can return to the authenticated admin console without allowing external paths', () => {
  assert.equal(safeAuthReturnUrl('/admin'), '/admin');
  assert.equal(safeAuthReturnUrl('/admin?section=jobs'), '/admin?section=jobs');
  assert.equal(safeAuthReturnUrl('/app/team'), '/app/team');
  assert.equal(safeAuthReturnUrl('//example.com'), '/app');
  assert.equal(safeAuthReturnUrl('/login'), '/app');
});

test('invitation sign-in sends the factor and keeps the invitation token for explicit acceptance', async () => {
  const component = Object.create(AuthComponent.prototype);
  let submitted;
  component.route = { snapshot: { data: { mode: 'invitation' }, queryParamMap: { get: () => null } } };
  component.busy = signal(false);
  component.error = signal('');
  component.message = signal('');
  component.authCompleted = signal(false);
  component.session = { user: () => null, login: async payload => { submitted = payload; } };
  component.email = ' person@example.com ';
  component.password = 'short existing password';
  component.factor = ' 123456 ';
  component.token = 'opaque-invitation-token';
  await component.submit();
  assert.deepEqual(submitted, { email: 'person@example.com', password: 'short existing password', factor: '123456' });
  assert.equal(component.password, '');
  assert.equal(component.factor, '');
  assert.equal(component.token, 'opaque-invitation-token');
  assert.match(component.message(), /pulsa «Aceptar invitación»/);
});

test('changing accounts preserves the in-memory invitation token and acceptance uses it once', async () => {
  const component = Object.create(AuthComponent.prototype);
  let logouts = 0;
  const accepted = [];
  const navigated = [];
  component.route = { snapshot: { data: { mode: 'invitation' }, queryParamMap: { get: () => null } } };
  component.busy = signal(false);
  component.error = signal('');
  component.message = signal('');
  component.authCompleted = signal(false);
  component.session = { user: () => ({ email: 'person@example.com' }), logout: async () => { logouts++; } };
  component.workspaces = { acceptInvitation: async token => { accepted.push(token); } };
  component.router = { navigateByUrl: async url => { navigated.push(url); } };
  component.email = 'wrong@example.com';
  component.token = 'opaque-invitation-token';
  await component.changeInvitationAccount();
  assert.equal(logouts, 1);
  assert.equal(component.email, '');
  assert.equal(component.token, 'opaque-invitation-token');
  component.session.user = () => ({ email: 'person@example.com' });
  await component.submit();
  assert.deepEqual(accepted, ['opaque-invitation-token']);
  assert.deepEqual(navigated, ['/app']);
  assert.equal(component.token, '');
});
