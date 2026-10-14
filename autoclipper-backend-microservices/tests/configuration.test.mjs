import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGatewayConfig, loadMediaConfig } from '@autoclipper/configuration';

test('configuration rejects ambiguous booleans and invalid ports', () => {
  assert.equal(loadGatewayConfig({ ENABLE_DOCS: 'false' }).ENABLE_DOCS, false);
  assert.equal(loadGatewayConfig({ ENABLE_DOCS: 'true' }).ENABLE_DOCS, true);
  assert.throws(() => loadGatewayConfig({ ENABLE_DOCS: 'yes' }));
  assert.throws(() => loadGatewayConfig({ PORT: '0' }));
});
test('configuration errors do not expose credential values', () => {
  const password = 'SENSITIVE_CONFIGURATION_VALUE';
  assert.throws(() => loadMediaConfig({ DATABASE_URL: password }), error => !error.message.includes(password) && error.message.includes('DATABASE_URL'));
});
