import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, client } from '../helpers/accounts.mjs';

test('Twitch HTTP contract reports unconfigured and requires an authenticated, CSRF-protected user without starting OAuth', async () => {
  const anonymous = client();
  const providers = await anonymous.request('/auth/providers');
  assert.equal(providers.status, 200);
  assert.equal(typeof providers.value.twitch?.configured, 'boolean');
  assert.equal(providers.value.twitch.configured, false);
  assert.equal((await anonymous.request('/auth/twitch/link')).status, 401);

  const user = await account();
  const status = await user.c.request('/auth/twitch/link');
  assert.equal(status.status, 200);
  assert.deepEqual(status.value, { configured: false, linked: false, account: null });

  const denied = await user.c.request('/auth/twitch/link', 'POST', {}, { 'x-csrf-token': 'invalid' });
  assert.equal(denied.status, 403);
  const link = await user.c.request('/auth/twitch/link', 'POST', {});
  assert.equal(link.status, 503);
  assert.equal(link.value.code, 'TWITCH_OAUTH_NOT_CONFIGURED');
  assert.equal('authorizationUrl' in link.value, false);
  assert.equal(user.c.jar.has('autoclipper_twitch_state'), false);
});
