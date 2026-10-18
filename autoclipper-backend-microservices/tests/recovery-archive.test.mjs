import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { encryptArchive, decryptArchive, verifyArchive } from '../scripts/recovery/archive.mjs';

test('encrypted recovery archive authenticates bytes, key and snapshot before extraction', async () => {
  const root = resolve('.local');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'archive-test-'));
  assert.ok(directory.startsWith(root + sep));
  const key = randomBytes(32), body = randomBytes(1024 * 1024 + 13);
  const path = join(directory, 'volume.enc'), context = 'fixture:postgres:image-sha';
  try {
    await encryptArchive(Readable.from(body), path, key, context);
    assert.equal((await readFile(path)).includes(body.subarray(0, 64)), false);
    const chunks = [];
    await decryptArchive(path, key, context, new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } }));
    assert.deepEqual(Buffer.concat(chunks), body);
    await assert.rejects(encryptArchive(Readable.from(body), path, key, context), { code: 'EEXIST' });
    await assert.rejects(verifyArchive(path, randomBytes(32), context));
    await assert.rejects(verifyArchive(path, key, context + ':other-volume'));
    for (const position of [0, 12, 100, (await readFile(path)).length - 1]) {
      const damaged = await readFile(path); damaged[position] ^= 1;
      const broken = join(directory, `broken-${position}.enc`);
      await writeFile(broken, damaged);
      let emitted = 0;
      await assert.rejects(decryptArchive(broken, key, context, new Writable({ write(chunk, _encoding, done) { emitted += chunk.length; done(); } })));
      assert.equal(emitted, 0, 'unauthenticated plaintext must not reach extraction');
    }
    const truncated = join(directory, 'truncated.enc');
    await writeFile(truncated, Buffer.alloc(10));
    await assert.rejects(verifyArchive(truncated, key, context));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
