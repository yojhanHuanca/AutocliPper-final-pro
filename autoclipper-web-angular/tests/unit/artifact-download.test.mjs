import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPrivateArtifact } from '../../.local/tests/client.mjs';

test('signed downloads omit native fetch credentials and never attach API headers', async () => {
  const original = globalThis.fetch; let captured;
  globalThis.fetch = async (url, options) => { captured = {url,options}; return new Response('test artifact bytes'); };
  try { assert.equal(await (await fetchPrivateArtifact('http://localhost:19000/fixture?signature=test-only')).text(),'test artifact bytes'); assert.equal(captured.options.credentials,'omit'); assert.equal(captured.options.redirect,'error'); assert.equal(captured.options.headers,undefined); }
  finally { globalThis.fetch = original; }
});
test('expired download grants are surfaced without opening a credentialed fallback', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('',{status:403});
  try { await assert.rejects(fetchPrivateArtifact('http://localhost:19000/fixture?signature=test-only'),/venció/); }
  finally { globalThis.fetch = original; }
});
