import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFailureMessage } from '../../.local/tests/client.mjs';

test('failed export messages stay human-readable and do not expose processor codes', () => {
  for (const code of ['FFMPEG_TIMEOUT', 'PROVIDER_OUTCOME_UNKNOWN', 'PRIVATE_PATH_CANARY', null]) {
    const message = exportFailureMessage(code);
    assert.match(message, /La exportación no se completó/);
    assert.doesNotMatch(message, /FFMPEG_TIMEOUT|PROVIDER_OUTCOME_UNKNOWN|PRIVATE_PATH_CANARY/);
  }
});
