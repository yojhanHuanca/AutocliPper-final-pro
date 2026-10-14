import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { Queue } from 'bullmq';
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { loadMediaConfig } from '@autoclipper/configuration';
import { eventually } from '@autoclipper/testing';
import { INSPECTION_QUEUE } from '@autoclipper/event-contracts';
import { createS3, redisConnection } from '../../apps/autoclipper-media-processing-service/dist/infrastructure/connections.js';
import { migrateMedia } from '../../apps/autoclipper-media-processing-service/dist/infrastructure/migrate.js';

// Explicit real dependencies. Missing environment or unavailable services fail,
// never silently skip and never substitute an in-memory database or fake S3.
const config = loadMediaConfig();
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
assert.ok(migrationUrl, 'MIGRATION_DATABASE_URL required for integration tests');

test('real PostgreSQL, Redis/BullMQ, S3 and FFmpeg inspection', { timeout: 180000 }, async t => {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 3000 });
  const s3 = createS3(config);
  const queue = new Queue(INSPECTION_QUEUE, { connection: { ...redisConnection(config.REDIS_URL), maxRetriesPerRequest: 1 } });
  const tasks = [];
  const keys = [];
  let worker;
  const fixtureRoot = process.env.TEST_TEMP_DIR ?? '.local';
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(join(fixtureRoot, 'integration-'));
  const port = 3101;
  async function startWorker() {
    worker = spawn(process.execPath, ['apps/autoclipper-media-processing-service/dist/main.js'], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'silent', TEMP_DIR: join(directory, 'worker') }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true
    });
    worker.stderr.on('data', () => {});
    await eventually(async () => {
      if (worker.exitCode !== null) throw new Error(`Worker exited with code ${worker.exitCode}`);
      try { return (await fetch(`http://127.0.0.1:${port}/v1/health/ready`, { signal: AbortSignal.timeout(5000) })).ok; } catch { return false; }
    }, 30000);
  }
  async function stopWorker() {
    if (!worker || worker.exitCode !== null) return;
    const closed = new Promise(resolve => worker.once('exit', resolve));
    worker.kill('SIGTERM');
    await closed;
  }
  async function enqueue(body, { etag, bytes, workspaceId, objectKey } = {}) {
    const id = randomUUID();
    const workspace = workspaceId ?? randomUUID();
    const key = objectKey ?? `workspaces/${workspace}/media/${id}/source.mp4`;
    let expectedEtag = etag;
    if (body !== undefined) {
      const put = await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body }));
      expectedEtag ??= put.ETag;
      keys.push(key);
    }
    const correlationId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO inspection_tasks(id, workspace_id, object_key, expected_bytes, expected_etag, correlation_id) VALUES ($1,$2,$3,$4,$5,$6)', [id, workspace, key, bytes ?? body?.length ?? 100, expectedEtag ?? 'missing', correlationId]);
      await client.query('INSERT INTO inspection_outbox(task_id, correlation_id) VALUES ($1,$2)', [id, correlationId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    tasks.push(id);
    return id;
  }
  async function terminal(id) {
    let row;
    await eventually(async () => {
      row = (await pool.query('SELECT * FROM inspection_tasks WHERE id=$1', [id])).rows[0];
      return row.status === 'succeeded' || row.status === 'failed';
    }, 30000);
    return row;
  }
  try {
    await t.test('migrations can be applied twice and runtime cannot modify schema or access another database', async () => {
      await migrateMedia(migrationUrl);
      await migrateMedia(migrationUrl);
      await assert.rejects(pool.query('CREATE TABLE forbidden_table(id integer)'), error => error.code === '42501');
      const otherUrl = new URL(config.DATABASE_URL); otherUrl.pathname = '/postgres';
      const other = new pg.Pool({ connectionString: otherUrl.href, connectionTimeoutMillis: 3000 });
      try { await assert.rejects(other.query('SELECT 1'), error => error.code === '42501'); } finally { await other.end(); }
    });
    await t.test('private storage denies unauthenticated reads', async () => {
      const key = `workspaces/${randomUUID()}/media/private.mp4`;
      await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: 'private' })); keys.push(key);
      const response = await fetch(`${config.S3_ENDPOINT}/${config.S3_BUCKET}/${key}`);
      assert.equal(response.status, 403);
    });
    const videoPath = join(directory, 'authorized-fixture.mp4');
    await promisify(execFile)(config.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=2', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-an', '-y', videoPath], { timeout: 15000, windowsHide: true });
    const video = await readFile(videoPath);
    await t.test('pending outbox survives worker startup; actual MP4 metadata is persisted', async () => {
      const id = await enqueue(video);
      await startWorker();
      const row = await terminal(id);
      assert.equal(row.status, 'succeeded');
      assert.equal(row.result.width, 320);
      assert.equal(row.result.height, 240);
      assert.ok(row.result.durationSeconds >= 1.9 && row.result.durationSeconds <= 2.1);
      assert.equal(row.attempts, 1);
      assert.ok(row.started_at && row.finished_at);
    });
    await t.test('outbox replay does not duplicate completed work', async () => {
      const id = tasks.at(-1);
      await pool.query('UPDATE inspection_outbox SET delivered_at=NULL WHERE task_id=$1', [id]);
      await eventually(async () => (await pool.query('SELECT delivered_at FROM inspection_outbox WHERE task_id=$1', [id])).rows[0].delivered_at !== null);
      assert.equal((await terminal(id)).attempts, 1);
      assert.equal((await queue.getJob(id)).attemptsMade, 1);
    });
    await t.test('unacknowledged work survives restart', async () => {
      await stopWorker();
      const id = await enqueue(video);
      await startWorker();
      assert.equal((await terminal(id)).status, 'succeeded');
    });
    await t.test('lost Redis queue entry is recovered from the persisted task and outbox', async () => {
      await stopWorker();
      const id = await enqueue(video);
      await pool.query('UPDATE inspection_outbox SET delivered_at=now() WHERE task_id=$1', [id]);
      assert.equal(await queue.getJob(id), undefined);
      await startWorker();
      assert.equal((await terminal(id)).status, 'succeeded');
    });
    await t.test('invalid file and changed ETag fail without retrying', async () => {
      const invalid = await terminal(await enqueue(Buffer.from('this is not a video')));
      assert.equal(invalid.status, 'failed'); assert.equal(invalid.error_code, 'PROBE_FAILED'); assert.equal(invalid.attempts, 1);
      const changed = await terminal(await enqueue(video, { etag: 'wrong-etag' }));
      assert.equal(changed.status, 'failed'); assert.equal(changed.error_code, 'OBJECT_CHANGED'); assert.equal(changed.attempts, 1);
    });
    await t.test('missing object retries three times and records a terminal error', async () => {
      const missing = await terminal(await enqueue(undefined));
      assert.equal(missing.status, 'failed'); assert.equal(missing.attempts, 3); assert.equal(missing.error_code, 'STORAGE_OR_NETWORK_ERROR');
    });
    await t.test('metrics require authorization and temporary files are removed', async () => {
      const denied = await fetch(`http://127.0.0.1:${port}/v1/metrics`);
      assert.equal(denied.status, 401);
      const response = await fetch(`http://127.0.0.1:${port}/v1/metrics`, { headers: { authorization: `Bearer ${config.INTERNAL_TOKEN}` } });
      assert.equal(response.status, 200); assert.match(await response.text(), /autoclipper_http_duration_seconds/);
      assert.deepEqual(await readdir(join(directory, 'worker')), []);
      await s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: keys[0] }));
    });
    await t.test('missing FFprobe makes readiness unavailable while liveness remains healthy', async () => {
      await stopWorker();
      worker = spawn(process.execPath, ['apps/autoclipper-media-processing-service/dist/main.js'], {
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'silent', FFPROBE_PATH: 'autoclipper-binary-that-does-not-exist' }, stdio: 'ignore', windowsHide: true
      });
      await eventually(async () => { try { return (await fetch(`http://127.0.0.1:${port}/v1/health/live`)).ok; } catch { return false; } });
      const ready = await fetch(`http://127.0.0.1:${port}/v1/health/ready`);
      assert.equal(ready.status, 503);
      const result = await ready.json();
      assert.equal(result.checks.ffprobe, 'unavailable');
      assert.equal(JSON.stringify(result).includes(config.S3_SECRET_KEY), false);
    });
  } finally {
    await stopWorker();
    for (const id of tasks) { const job = await queue.getJob(id); if (job) await job.remove(); }
    if (tasks.length) await pool.query('DELETE FROM inspection_tasks WHERE id=ANY($1::uuid[])', [tasks]);
    for (const key of keys) await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
    await queue.close(); s3.destroy(); await pool.end(); await rm(directory, { recursive: true, force: true });
  }
});
