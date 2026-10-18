import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

// Streaming envelope: magic/version, random GCM nonce, ciphertext, GCM tag.
// AAD binds each volume to its snapshot, purpose and exact image identity.
const magic = Buffer.from('ACBK0001');
const headerBytes = magic.length + 12;
function keyBytes(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('BACKUP_KEY_INVALID');
  return key;
}
export async function encryptArchive(input, path, key, context) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce);
  cipher.setAAD(Buffer.from(context));
  await writeFile(path, Buffer.concat([magic, nonce]), { flag: 'wx', mode: 0o600 });
  await pipeline(input, cipher, createWriteStream(path, { flags: 'a' }));
  await appendFile(path, cipher.getAuthTag());
  const file = await open(path, 'r+');
  try { await file.sync(); } finally { await file.close(); }
}
async function decoder(path, key, context) {
  const size = (await stat(path)).size;
  if (size < headerBytes + 16) throw new Error('BACKUP_ARCHIVE_INVALID');
  const file = await open(path, 'r');
  const header = Buffer.alloc(headerBytes), tag = Buffer.alloc(16);
  try {
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
  } finally { await file.close(); }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error('BACKUP_ARCHIVE_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), header.subarray(magic.length));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return { input: createReadStream(path, { start: headerBytes, end: size - 17 }), decipher };
}
export async function verifyArchive(path, key, context) {
  const { input, decipher } = await decoder(path, key, context);
  await pipeline(input, decipher, new Writable({ write(_chunk, _encoding, done) { done(); } }));
}
export async function decryptArchive(path, key, context, output) {
  // Verify the complete tag before any plaintext reaches an extraction process.
  // Callers must keep the archive immutable between the two passes.
  await verifyArchive(path, key, context);
  const { input, decipher } = await decoder(path, key, context);
  await pipeline(input, decipher, output);
}
export async function encryptFile(inputPath, outputPath, key, context) {
  await encryptArchive(createReadStream(inputPath), outputPath, key, context);
}
export async function decryptFile(inputPath, outputPath, key, context) {
  await verifyArchive(inputPath, key, context);
  await decryptArchive(inputPath, key, context, createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }));
}
