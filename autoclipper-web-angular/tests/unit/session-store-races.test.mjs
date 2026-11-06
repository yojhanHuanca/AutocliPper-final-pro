import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { SessionStore, ApiSecurity, ApiTransport } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const renderer = { insertRootElement() {}, removeAllRootElements() {} };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const user = (id) => ({ id, email: `${id}@example.test`, name: id, verified: true, mfaEnabled: false });

test('a late session restore cannot replace the account returned by a newer login', async () => {
  const pendingMe = deferred();
  const currentUser = user('new-account');
  TestBed.configureTestingModule({ providers: [
    SessionStore,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiSecurity, useValue: { refresh: async () => {}, clear() {} } },
    { provide: ApiTransport, useValue: {
      get: () => pendingMe.promise,
      post: async (path) => { assert.equal(path, '/auth/login'); return { user: currentUser }; },
    } },
  ] });
  try {
    const session = TestBed.inject(SessionStore);
    const restoring = session.restore();
    await session.login({ email: currentUser.email, password: 'synthetic-only' });
    pendingMe.resolve(user('old-account'));
    assert.equal(await restoring, true);
    assert.equal(session.user().id, 'new-account');
  } finally { TestBed.resetTestingModule(); }
});

test('a late session restore cannot repopulate the account after logout succeeds', async () => {
  const pendingMe = deferred();
  const pendingLogout = deferred();
  let securityClears = 0;
  TestBed.configureTestingModule({ providers: [
    SessionStore,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiSecurity, useValue: { refresh: async () => {}, clear() { securityClears++; } } },
    { provide: ApiTransport, useValue: {
      get: () => pendingMe.promise,
      post: async (path) => { assert.equal(path, '/auth/logout'); return pendingLogout.promise; },
    } },
  ] });
  try {
    const session = TestBed.inject(SessionStore);
    const restoring = session.restore();
    session.user.set(user('old-account'));
    const loggingOut = session.logout();
    pendingLogout.resolve();
    await loggingOut;
    pendingMe.resolve(user('old-account'));
    assert.equal(await restoring, false);
    assert.equal(session.user(), null);
    assert.equal(securityClears, 1);
  } finally { TestBed.resetTestingModule(); }
});

test('a rejected logout retains the confirmed user and does not clear session security', async () => {
  let securityClears = 0;
  TestBed.configureTestingModule({ providers: [
    SessionStore,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiSecurity, useValue: { refresh: async () => {}, clear() { securityClears++; } } },
    { provide: ApiTransport, useValue: { post: async () => { throw new Error('logout unavailable'); } } },
  ] });
  try {
    const session = TestBed.inject(SessionStore);
    session.user.set(user('current-account'));
    await assert.rejects(session.logout(), /logout unavailable/);
    assert.equal(session.user().id, 'current-account');
    assert.equal(securityClears, 0);
    assert.equal(await session.restore(), true);
  } finally { TestBed.resetTestingModule(); }
});
