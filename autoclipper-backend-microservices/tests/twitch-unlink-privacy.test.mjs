import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { IdentityService } from '../apps/autoclipper-identity-service/dist/application/identity.service.js';
import { seal } from '../apps/autoclipper-identity-service/dist/infrastructure/mail.js';

const userId = 'd19641bf-5b01-4afa-babd-135b25d1c6a4';
const encryptionKey = 'a'.repeat(64);
const config = { CORS_ORIGIN: 'http://localhost:4200', CSRF_SIGNING_KEY: 'fixture-signing-key' };

function requestWithCsrf() {
  const payload = `${Date.now()}.fixture-nonce`;
  const token = `${payload}.${createHmac('sha256', config.CSRF_SIGNING_KEY).update(payload).digest('base64url')}`;
  return { headers: { origin: config.CORS_ORIGIN, cookie: `autoclipper_csrf=${token}`, 'x-csrf-token': token } };
}

function unlinkFixture({ revokeFails = false, linkPresent = true } = {}) {
  const events = [];
  const projectMedia = { importRow: { id: 'source-import-id', uploadId: 'confirmed-upload-id' }, deleted: false };
  const tokenCipher = seal(JSON.stringify({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }), encryptionKey, `twitch:${userId}`);
  const service = Object.create(IdentityService.prototype);
  service.config = config;
  service.encryptionKey = encryptionKey;
  service.twitch = { clientId: 'fixture-client' };
  service.me = async () => ({ id: userId });
  service.tx = async work => work({ query: async (sql, values) => {
    if (sql.includes('pg_advisory_xact_lock')) {
      assert.equal(sql, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))');
      assert.deepEqual(values, [`twitch-refresh:${userId}`]);
      events.push('lock-refresh');
      return { rows: [{ pg_advisory_xact_lock: null }] };
    }
    events.push('delete-link');
    assert.equal(sql, 'DELETE FROM twitch_links WHERE user_id=$1 RETURNING token_cipher');
    assert.deepEqual(values, [userId]);
    return { rows: linkPresent ? [{ token_cipher: tokenCipher }] : [] };
  } });
  service.audit = async (_client, actor, action) => {
    assert.equal(actor, userId);
    assert.equal(action, 'twitch.unlinked');
    events.push('audit-unlink');
  };
  return { service, events, projectMedia, revokeFails };
}

for (const revokeFails of [false, true]) {
  test(`Twitch unlink atomically removes only its own local credential before provider revocation (revokeFails=${revokeFails})`, async () => {
    const fixture = unlinkFixture({ revokeFails });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      fixture.events.push('provider-revoke');
      assert.deepEqual(fixture.events.slice(0, 3), ['lock-refresh', 'delete-link', 'audit-unlink']);
      assert.equal(String(input), 'https://id.twitch.tv/oauth2/revoke');
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      const body = new globalThis.URLSearchParams(init.body);
      assert.equal(body.get('client_id'), 'fixture-client');
      assert.equal(body.get('token'), 'fixture-access');
      assert.equal(fixture.projectMedia.deleted, false, 'unlinking OAuth must preserve project imports and media');
      if (revokeFails) throw new Error('fixture provider unavailable');
      return new globalThis.Response(null, { status: 204 });
    };
    try {
      assert.deepEqual(await fixture.service.unlinkTwitch(requestWithCsrf()), { unlinked: true });
      assert.deepEqual(fixture.events, ['lock-refresh', 'delete-link', 'audit-unlink', 'provider-revoke']);
      assert.equal(fixture.projectMedia.deleted, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test('repeated Twitch unlink is idempotent and does not touch project imports or media', async () => {
  const fixture = unlinkFixture({ linkPresent: false });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no credential should be revoked'); };
  try {
    assert.deepEqual(await fixture.service.unlinkTwitch(requestWithCsrf()), { unlinked: true });
    assert.deepEqual(fixture.events, ['lock-refresh', 'delete-link']);
    assert.equal(fixture.projectMedia.deleted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
