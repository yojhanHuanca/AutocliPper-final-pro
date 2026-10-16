import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIanaTimezone } from '../../.local/tests/client.mjs';

test('timezone field accepts supported zone names and rejects arbitrary input', () => {
  assert.equal(isValidIanaTimezone('America/Lima'), true);
  assert.equal(isValidIanaTimezone('Etc/UTC'), true);
  assert.equal(isValidIanaTimezone('not-a-time-zone'), false);
  assert.equal(isValidIanaTimezone('not/a-zone'), false);
  assert.equal(isValidIanaTimezone('  '), false);
});
