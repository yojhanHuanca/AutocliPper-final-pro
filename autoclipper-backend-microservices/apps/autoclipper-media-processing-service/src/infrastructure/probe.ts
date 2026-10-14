import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { MediaConfig } from '@autoclipper/configuration';
import { InspectionError, validateMetadata, validateObjectKey } from '../domain/inspection.js';

const execute = promisify(execFile);
export async function probeLocal(path: string, config: Pick<MediaConfig, 'FFPROBE_PATH' | 'PROBE_TIMEOUT_MS' | 'MAX_VIDEO_SECONDS'>) {
  let stdout: string;
  try {
    const result = await execute(config.FFPROBE_PATH, ['-v', 'error', '-max_alloc', '67108864', '-threads', '1', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height', '-of', 'json', path], { shell: false, timeout: config.PROBE_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1048576, windowsHide: true });
    stdout = result.stdout;
  } catch { throw new InspectionError('PROBE_FAILED', false); }
  try { return validateMetadata(JSON.parse(stdout) as unknown, config.MAX_VIDEO_SECONDS); }
  catch (error) { if (error instanceof InspectionError) throw error; throw new InspectionError('INVALID_MEDIA', false); }
}

export async function inspectObject(s3: S3Client, config: MediaConfig, task: { objectKey: string; workspaceId: string; expectedBytes: number; expectedEtag: string }) {
  validateObjectKey(task.objectKey, task.workspaceId);
  if (task.expectedBytes > config.MAX_PROBE_BYTES) throw new InspectionError('MEDIA_LIMIT_EXCEEDED', false);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), config.PROBE_TIMEOUT_MS);
  let directory: string | undefined;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: task.objectKey }), { abortSignal: abort.signal });
    if (head.ContentLength !== task.expectedBytes || head.ETag !== task.expectedEtag) throw new InspectionError('OBJECT_CHANGED', false);
    await mkdir(config.TEMP_DIR, { recursive: true });
    directory = await mkdtemp(join(config.TEMP_DIR, 'probe-'));
    await chmod(directory, 0o700);
    const path = join(directory, 'source.media');
    const object = await s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: task.objectKey, IfMatch: task.expectedEtag }), { abortSignal: abort.signal });
    if (!object.Body) throw new InspectionError('EMPTY_OBJECT', false);
    let bytes = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > task.expectedBytes ? new InspectionError('MEDIA_LIMIT_EXCEEDED', false) : null, chunk);
    } });
    await pipeline(object.Body as Readable, limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal: abort.signal });
    if (bytes !== task.expectedBytes) throw new InspectionError('OBJECT_CHANGED', false);
    clearTimeout(timer);
    return await probeLocal(path, config);
  } finally {
    clearTimeout(timer);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
