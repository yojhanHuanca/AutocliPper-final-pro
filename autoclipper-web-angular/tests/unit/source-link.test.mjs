import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLinkFeedback } from '../../.local/tests/client.mjs';

test('source link syntax never asserts provider support or import availability', () => {
  for (const value of ['https://example.test/video', '  https://kick.com/example  ', 'http://example.test/a']) {
    const result = sourceLinkFeedback(value);
    assert.equal(result.valid, true);
    assert.match(result.message, /todavía no está disponible/);
  }
});

test('source link rejects incomplete, executable, credential-bearing and oversized values', () => {
  for (const value of ['kick.com/example', 'javascript:alert(1)', 'file:///tmp/video', 'https://user:secret@example.test/video', 'https://example.test/' + 'a'.repeat(2048)]) {
    assert.equal(sourceLinkFeedback(value).valid, false);
  }
  assert.deepEqual(sourceLinkFeedback('  '), {valid:false, message:''});
});
