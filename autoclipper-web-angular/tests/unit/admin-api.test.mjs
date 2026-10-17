import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { AdminApi, ApiTransport } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const renderer = { insertRootElement() {}, removeAllRootElements() {} };

test('administrative reads use the documented routes, bounded pages and allowlist filter', async () => {
  const gets = [];
  const posts = [];
  TestBed.configureTestingModule({ providers: [
    AdminApi,
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: ApiTransport, useValue: {
      get: async path => { gets.push(path); return {}; },
      post: async (...args) => { posts.push(args); return {}; },
    } },
  ] });
  try {
    const api = TestBed.inject(AdminApi);
    await api.access();
    await api.elevate({ password: 'existing-password', factor: '123456' });
    await api.users('user-cursor');
    await api.workspaces(undefined, 'workspace-id');
    await api.jobs('job-cursor');
    await api.consumption('consumption-cursor', 'workspace-id');
    assert.equal(gets[0], '/admin/access');
    assert.deepEqual(posts, [['/admin/access', { password: 'existing-password', factor: '123456' }]]);
    assert.equal(gets[1], '/admin/users?limit=25&beforeId=user-cursor');
    assert.equal(gets[2], '/admin/workspaces?limit=25&workspaceId=workspace-id');
    assert.equal(gets[3], '/admin/jobs?limit=25&beforeId=job-cursor');
    assert.equal(gets[4], '/admin/consumption?limit=25&beforeId=consumption-cursor&workspaceId=workspace-id');
  } finally { TestBed.resetTestingModule(); }
});
