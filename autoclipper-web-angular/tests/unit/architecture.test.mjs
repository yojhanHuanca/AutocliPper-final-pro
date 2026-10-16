import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

async function files(root) { const result = []; for (const entry of await readdir(root, { withFileTypes: true })) { const p=path.join(root, entry.name); if(entry.isDirectory())result.push(...await files(p));else result.push(p); } return result; }
test('core and shared cannot import features or layouts', async () => {
  for (const file of [...await files('src/app/core'), ...await files('src/app/shared')].filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))) {
    const source = await readFile(file,'utf8'); const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m=>m[1]);
    for (const dependency of imports) { if (dependency.startsWith('.')) { const target=path.resolve(path.dirname(file),dependency).replaceAll('\\','/'); assert.ok(!target.includes('/features/') && !target.includes('/layouts/'),`${file} imports ${dependency}`); } }
  }
});
test('generated public types identify the exact recorded gateway contract', async () => {
  const contract=await readFile('contracts/public-gateway.snapshot.json');const types=await readFile('src/app/core/contracts/gateway.generated.d.ts','utf8');
  assert.ok(types.includes(createHash('sha256').update(contract).digest('hex')),'Run npm run contracts after updating the recorded public contract.');
});
