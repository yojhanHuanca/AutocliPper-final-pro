import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { cookieName, digest } from '@autoclipper/http-security';
import { DerivativesManager } from '../apps/autoclipper-project-service/dist/application/derivatives.manager.js';

const userId = 'f5eaac74-18d4-4df1-8fd6-68b269508099';
const uploadId = 'a129be21-270a-448a-b8f3-cb89c0651a12';
const secondaryUploadId = '9ee7f1de-1537-4c6c-945e-96d15c0f80c8';
const processingId = '34f3cd5a-bce0-4ecc-8bf5-64e5bd2cfc58';
const key = 'b0a2d4f6-09bc-47c1-8c34-53b07898bd57';
const audioSpec = { version: 1, kind: 'audio' };
const config = {
  CORS_ORIGIN: 'http://localhost:4200',
  CSRF_SIGNING_KEY: 'fixture-signing-key',
  INTERNAL_TOKEN: 'fixture-internal-token',
  IDENTITY_URL: 'http://identity.fixture',
  PROCESSING_ADMISSION_MODE: 'local',
};

function requestWithCsrf() {
  const payload = `${Date.now()}.derivative-idempotency-fixture`;
  const csrf = `${payload}.${createHmac('sha256', config.CSRF_SIGNING_KEY).update(payload).digest('base64url')}`;
  return {
    headers: {
      origin: config.CORS_ORIGIN,
      cookie: `autoclipper_csrf=${csrf}; ${cookieName('access')}=fixture-access-token`,
      'x-csrf-token': csrf,
      'idempotency-key': key,
    },
  };
}

function fixture({ admissionMode = 'local', priorSpec = audioSpec } = {}) {
  const events = [];
  const service = Object.create(DerivativesManager.prototype);
  service.config = { ...config, PROCESSING_ADMISSION_MODE: admissionMode };
  service.mediaUrl = 'http://media.fixture';
  service.authorize = async (_req, id, minimum) => {
    events.push({ kind: 'authorize', id, minimum });
    assert.ok([uploadId, secondaryUploadId].includes(id));
    assert.equal(minimum, 'editor');
    return { id, project_id: 'fixture-project', workspace_id: 'fixture-workspace', state: 'confirmed', expected_bytes: 4096, object_key: `fixtures/${id}.mp4`, etag: 'fixture-etag', sha256: 'a'.repeat(64), content_type: 'video/mp4' };
  };
  service.pool = {
    async query(sql, values = []) {
      events.push({ kind: 'query', sql, values });
      assert.equal(sql, 'SELECT * FROM processing_requests WHERE creator_id=$1 AND idempotency_key=$2');
      assert.deepEqual(values, [userId, key]);
      const requestHash = digest(JSON.stringify({ uploadId, spec: priorSpec }));
      return { rows: [{ id: processingId, creator_id: userId, upload_id: uploadId, project_id: 'fixture-project', workspace_id: 'fixture-workspace', request_hash: requestHash, spec: priorSpec, secondary_upload_id: null, status: 'queued' }] };
    },
  };
  return { service, events };
}

async function runReplay({ admissionMode = 'local', input = audioSpec, method = 'begin' } = {}) {
  const f = fixture({ admissionMode, priorSpec: input });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (inputUrl, init) => {
    const url = String(inputUrl);
    f.events.push({ kind: 'fetch', url });
    assert.equal(url, 'http://identity.fixture/v1/internal/authenticate', 'a replay must not call Media inspection');
    assert.deepEqual(JSON.parse(init.body), { token: 'fixture-access-token' });
    return new globalThis.Response(JSON.stringify({ id: userId, email: 'fixture@example.test' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    return { f, result: await f.service[method](requestWithCsrf(), uploadId, input, 'c5ecfdc1-63db-455c-9183-d910610ea19c') };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('processing replay returns its persisted ID during Media outage', async () => {
  const { f, result } = await runReplay();
  assert.deepEqual(result, { id: processingId, status: 'queued' });
  assert.equal(f.events.filter(event => event.kind === 'fetch').length, 1);
  assert.equal(f.events.some(event => event.kind === 'authorize' && event.id === uploadId), true);
  assert.equal(f.events.filter(event => event.kind === 'query').length, 1);
});

test('processing replay survives a closed admission switch but still checks upload permission', async () => {
  const { f, result } = await runReplay({ admissionMode: 'commercial' });
  assert.deepEqual(result, { id: processingId, status: 'queued' });
  assert.equal(f.events.some(event => event.kind === 'authorize'), true);
  assert.equal(f.events.some(event => event.kind === 'fetch' && event.url === 'http://media.fixture/v1/internal/inspection-status'), false);
});

test('split-screen replay reauthorizes both source uploads before returning the stored task', async () => {
  const splitSpec = {
    version: 1,
    kind: 'clip',
    startSeconds: 0,
    endSeconds: 2,
    aspect: 'vertical',
    splitScreen: { secondaryUploadId, layout: 'side_by_side', primaryRatio: 0.5, startSeconds: 0, shortInput: 'reject', audio: 'primary' },
    subtitles: { provenance: 'transcript', transcriptId: '6f8103cb-1a7c-441a-8b53-0359a748e4bc', cues: [{ startSeconds: 0, endSeconds: 1, text: 'Fixture caption' }] },
  };
  const { f, result } = await runReplay({ input: splitSpec, method: 'beginFromTranscript' });
  assert.deepEqual(result, { id: processingId, status: 'queued' });
  assert.deepEqual(f.events.filter(event => event.kind === 'authorize').map(event => event.id), [uploadId, secondaryUploadId]);
  assert.equal(f.events.some(event => event.kind === 'fetch' && event.url === 'http://media.fixture/v1/internal/inspection-status'), false);
});

test('reusing a processing key for a different spec conflicts before Media preflight', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async inputUrl => {
    assert.equal(String(inputUrl), 'http://identity.fixture/v1/internal/authenticate');
    return new globalThis.Response(JSON.stringify({ id: userId, email: 'fixture@example.test' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await assert.rejects(
      f.service.begin(requestWithCsrf(), uploadId, { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 2, aspect: 'source' }, 'c5ecfdc1-63db-455c-9183-d910610ea19c'),
      error => error.getStatus?.() === 409,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(f.events.filter(event => event.kind === 'authorize').length, 1);
});
