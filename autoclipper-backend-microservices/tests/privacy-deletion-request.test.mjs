import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { IdentityService } from '../apps/autoclipper-identity-service/dist/application/identity.service.js';

const userId = 'c9ad7b75-08a8-4d24-99f4-4538d90ef010';
const config = { CORS_ORIGIN: 'http://localhost:4200', CSRF_SIGNING_KEY: 'fixture-signing-key' };

function requestWithCsrf() {
  const payload = `${Date.now()}.deletion-fixture`;
  const token = `${payload}.${createHmac('sha256', config.CSRF_SIGNING_KEY).update(payload).digest('base64url')}`;
  return { headers: { origin: config.CORS_ORIGIN, cookie: `autoclipper_csrf=${token}`, 'x-csrf-token': token } };
}

function fixture() {
  const events = [];
  let pendingRequest = null;
  const client = {
    async query(sql, values = []) {
      events.push({ kind: 'query', sql, values });
      if (sql.startsWith('INSERT INTO privacy_requests')) {
        assert.deepEqual(values.slice(1), [userId, 'deletion']);
        if (pendingRequest) return { rows: [] };
        pendingRequest = values[0];
        return { rows: [{ id: pendingRequest }] };
      }
      if (sql.startsWith('SELECT id FROM privacy_requests')) {
        assert.deepEqual(values, [userId, 'deletion']);
        return { rows: pendingRequest ? [{ id: pendingRequest }] : [] };
      }
      throw new Error(`Unexpected deletion request query: ${sql}`);
    },
  };
  const service = Object.create(IdentityService.prototype);
  service.config = config;
  service.mfa = { verify: async (_client, subject, factor) => { events.push({ kind: 'mfa', subject, factor }); } };
  service.sensitive = async (_req, password, work) => {
    assert.equal(password, 'fixture-password');
    return work(client, { id: userId });
  };
  service.audit = async (_client, actor, action) => { events.push({ kind: 'audit', actor, action }); };
  return { service, events };
}

test('repeated pending account-deletion request reuses its ID and never starts a purge', async () => {
  const f = fixture();
  const input = { kind: 'deletion', password: 'fixture-password' };
  const first = await f.service.privacy(requestWithCsrf(), input);
  const replay = await f.service.privacy(requestWithCsrf(), input);

  assert.match(first.id, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(first, { id: first.id, kind: 'deletion', state: 'requested', fulfillment: 'pending' });
  assert.deepEqual(replay, first);
  assert.equal(f.events.filter(event => event.kind === 'mfa').length, 2);
  assert.deepEqual(f.events.filter(event => event.kind === 'audit').map(event => event.action), ['privacy.deletion_requested']);
  assert.deepEqual(f.events.filter(event => event.kind === 'query').map(event => event.sql.split(' ')[0]), ['INSERT', 'INSERT', 'SELECT']);
  assert.equal(f.events.some(event => event.kind === 'query' && /\b(DELETE|UPDATE)\b/iu.test(event.sql)), false);

  const migration = await readFile(new URL('../apps/autoclipper-identity-service/migrations/0001_identity_security.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX pending_privacy_request_idx ON privacy_requests\(user_id,kind\) WHERE state='requested'/u);
});
