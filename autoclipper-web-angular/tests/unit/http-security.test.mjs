// Explicit transport unit tests use Angular's official HttpTestingController.
// They do not represent live backend, storage, or AI acceptance.
import '@angular/compiler';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { HttpClient, provideHttpClient, withInterceptors, HttpErrorResponse } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, ApiTransport, ApiSecurity, apiInterceptor, errorMessage } from '../../.local/tests/client.mjs';

const base = 'http://localhost:3000/v1';
const tick = () => new Promise(resolve => setImmediate(resolve));
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
let http, controller;
beforeEach(() => {
  TestBed.configureTestingModule({ providers: [{ provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } }, { provide: API_BASE_URL, useValue: base }, ApiSecurity, provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting()] });
  http = TestBed.inject(HttpClient); controller = TestBed.inject(HttpTestingController);
});
afterEach(() => { controller.verify(); TestBed.resetTestingModule(); });

test('two concurrent mutations share CSRF acquisition and send credentials only to the API', async () => {
  const a = firstValueFrom(http.post(base + '/projects', { name: 'A' }));
  const b = firstValueFrom(http.post(base + '/projects', { name: 'B' }));
  const csrf = controller.expectOne(base + '/auth/csrf');
  assert.equal(csrf.request.withCredentials, true); csrf.flush({ csrfToken: 'test-only-csrf' });
  await tick(); const requests = controller.match(base + '/projects'); assert.equal(requests.length, 2);
  for (const req of requests) { assert.equal(req.request.withCredentials, true); assert.equal(req.request.headers.get('X-CSRF-Token'), 'test-only-csrf'); req.flush({ ok: true }); }
  await Promise.all([a, b]);
});

test('signed storage URLs and lookalike API prefixes do not receive cookies or CSRF', async () => {
  for (const url of ['https://storage.example.test/object?signature=test-only', 'http://localhost:3000/v1.evil/object', 'https://example.test/v1/projects']) {
    const promise = firstValueFrom(http.put(url, 'test bytes'));
    const req = controller.expectOne(url); assert.equal(req.request.withCredentials, false); assert.equal(req.request.headers.has('X-CSRF-Token'), false); req.flush({ ok: true }); await promise;
  }
});

test('public review bearer grants omit account cookies and never trigger session refresh', async () => {
  const api=TestBed.inject(ApiTransport);
  const promise=api.getPublic('/review-links/one-time-token');
  const request=controller.expectOne(base+'/review-links/one-time-token');
  assert.equal(request.request.withCredentials,false);
  request.flush({}, {status:401,statusText:'Unauthorized'});
  assert.equal((await promise.catch(error=>error)).status,401);
  controller.expectNone(base+'/auth/refresh');
});

test('body-versioned comment deletion keeps CSRF protection on the DELETE request', async () => {
  const api=TestBed.inject(ApiTransport);
  const promise=api.deleteWithBody('/edits/edit-1/comments/comment-1',{version:2});
  controller.expectOne(base+'/auth/csrf').flush({csrfToken:'test-only-csrf'});
  await tick();
  const request=controller.expectOne(base+'/edits/edit-1/comments/comment-1');
  assert.equal(request.request.method,'DELETE');
  assert.deepEqual(request.request.body,{version:2});
  assert.equal(request.request.headers.get('X-CSRF-Token'),'test-only-csrf');
  request.flush({id:'comment-1',version:3});
  await promise;
});

test('concurrent 401 responses share one refresh and preserve the original idempotency key', async () => {
  // Pre-acquire CSRF so its expiry is independent of this test's refresh.
  const security = TestBed.inject(ApiSecurity); const csrfPromise = security.csrf(); controller.expectOne(base + '/auth/csrf').flush({ csrfToken: 'test-only-csrf' }); await csrfPromise;
  const a = firstValueFrom(http.post(base + '/projects', { name: 'Unchanged body' }, { headers: { 'Idempotency-Key': 'test-idempotency-key' } }));
  const b = firstValueFrom(http.get(base + '/workspaces'));
  await tick(); controller.expectOne(base + '/projects').flush({}, { status: 401, statusText: 'Unauthorized' }); controller.expectOne(base + '/workspaces').flush({}, { status: 401, statusText: 'Unauthorized' });
  await tick(); const refresh = controller.expectOne(base + '/auth/refresh'); assert.equal(refresh.request.withCredentials, true); refresh.flush({ ok: true });
  await tick(); const retry = controller.expectOne(base + '/projects'); assert.equal(retry.request.headers.get('Idempotency-Key'), 'test-idempotency-key'); assert.deepEqual(retry.request.body, { name: 'Unchanged body' }); retry.flush({ id: 'test-project' }); controller.expectOne(base + '/workspaces').flush({ items: [] });
  await Promise.all([a, b]);
});

test('login 401 is surfaced without replaying a password or recovery code', async () => {
  const promise = firstValueFrom(http.post(base + '/auth/login', { email: 'fixture@example.test', password: 'synthetic-test-only', factor: 'test-only-recovery-code' })).catch(e => e);
  controller.expectOne(base + '/auth/csrf').flush({ csrfToken: 'test-only-csrf' }); await tick(); controller.expectOne(base + '/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
  assert.equal((await promise).status, 401); controller.expectNone(base + '/auth/refresh');
});

test('commercial admission rejection is explained without retry or alternate processing requests', async () => {
  const promise = firstValueFrom(http.post(base + '/edits/test/renders', { revisionVersion: 1 })).catch(e => e);
  controller.expectOne(base + '/auth/csrf').flush({ csrfToken: 'test-only-csrf' }); await tick(); controller.expectOne(base + '/edits/test/renders').flush({ code: 'MANUAL_PROCESSING_NOT_ADMITTED' }, { status: 403, statusText: 'Forbidden' });
  const error = await promise; assert.match(errorMessage(error), /no admite nuevas exportaciones manuales/); controller.expectNone(base + '/auth/refresh');
});

test('stale editor revisions retain a recoverable conflict message', () => {
  assert.match(errorMessage(new HttpErrorResponse({ status: 412 })), /tus cambios siguen en el formulario/);
});
