// Runs only inside the isolated drill container. No production URLs are accepted.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { S3Client, CreateBucketCommand, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import { INSPECTION_QUEUE } from '@autoclipper/event-contracts';
import { InspectionRuntime } from '../../apps/autoclipper-media-processing-service/dist/application/inspection-runtime.js';
import { verifyMediaCleanup } from './media-cleanup-fixture.mjs';
import { verifyAnalysisCleanup } from './analysis-cleanup-fixture.mjs';
import { verifyPrivacyProfileExports } from './privacy-fixture.mjs';

const services = ['media', 'identity', 'workspace', 'project', 'analysis', 'billing'];
const hash = value => createHash('sha256').update(value).digest('hex');
const input = [];
for await (const chunk of process.stdin) input.push(chunk);
const config = JSON.parse(Buffer.concat(input).toString());
assert.ok(['source-pg', 'target-pg'].includes(config.pgHost));
assert.ok(['source-storage', 'target-storage'].includes(config.storageHost));
assert.ok(['seed', 'verify'].includes(config.phase));
const dbUrl = (service, role = 'owner') => `postgresql://autoclipper_${service}_${role}:${config.password}@${config.pgHost}:5432/autoclipper_${service}`;
const poolFor = (service, role) => new pg.Pool({ connectionString: dbUrl(service, role), max: 1, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
const bucket = 'recovery-fixture';
const endpoint = `http://${config.storageHost}:9000`;
const s3 = new S3Client({ endpoint, forcePathStyle: true, region: 'us-east-1', credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey } });
const report = { phase: config.phase, databases: [], objects: [] };
let checkpoint = 'DATABASES';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function manifest(pool) {
  const tables = (await pool.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename")).rows;
  const rows = [];
  for (const { schemaname, tablename } of tables) {
    const relation = `${quote(schemaname)}.${quote(tablename)}`;
    const data = (await pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text AS data FROM ${relation} t`)).rows[0].data;
    rows.push({ schema: schemaname, table: tablename, sha256: hash(data) });
  }
  return rows;
}
try {
  for (const service of services) {
    checkpoint = `DATABASE_${service.toUpperCase()}`;
    const owner = poolFor(service);
    try {
      if (config.phase === 'seed') {
        const app = service === 'media' ? 'media-processing' : service === 'analysis' ? 'content-analysis' : service;
        for (let attempt = 0; attempt < 2; attempt++) await migrate(drizzle(owner), { migrationsFolder: `/app/apps/autoclipper-${app}-service/migrations` });
        // Explicit synthetic test table, separate from business data.
        await owner.query('CREATE TABLE recovery_probe(id uuid PRIMARY KEY, checkpoint text NOT NULL)');
        await owner.query('INSERT INTO recovery_probe VALUES ($1,$2)', [randomUUID(), randomUUID()]);
      }
      report.databases.push({ service, tables: await manifest(owner) });
      const runtime = poolFor(service, 'runtime');
      try {
        await assert.rejects(runtime.query('CREATE TABLE recovery_forbidden(id integer)'), error => error.code === '42501');
        for (const other of services.filter(value => value !== service)) {
          const forbiddenUrl = new URL(dbUrl(service, 'runtime'));
          forbiddenUrl.pathname = `/autoclipper_${other}`;
          const forbidden = new pg.Pool({ connectionString: forbiddenUrl.href, connectionTimeoutMillis: 3000 });
          try { await assert.rejects(forbidden.query('SELECT 1'), error => error.code === '42501'); } finally { await forbidden.end(); }
        }
        if (service === 'identity') await assert.rejects(runtime.query('DELETE FROM admin_grants'), error => error.code === '42501');
      } finally { await runtime.end(); }
    } finally { await owner.end(); }
  }
  if (config.phase === 'seed') {
    checkpoint = 'OBJECT_FIXTURES';
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    const videoPath = '/tmp/recovery-fixture.mp4';
    await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=2', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-an', '-y', videoPath], { timeout: 15000 });
    const video = await readFile(videoPath), workspaceId = randomUUID(), id = randomUUID();
    const key = `workspaces/${workspaceId}/media/${id}/source.mp4`;
    const put = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: video }));
    report.objects.push({ key, etag: put.ETag, bytes: video.length, sha256: hash(video) });
    const multipartKey = 'multipart/fixture.bin';
    const upload = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: multipartKey }));
    const bodies = [Buffer.alloc(5 * 1024 * 1024, 61), Buffer.alloc(417, 62)], parts = [];
    for (let index = 0; index < bodies.length; index++) {
      const result = await s3.send(new UploadPartCommand({ Bucket: bucket, Key: multipartKey, UploadId: upload.UploadId, PartNumber: index + 1, Body: bodies[index] }));
      parts.push({ PartNumber: index + 1, ETag: result.ETag });
    }
    const completed = await s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: multipartKey, UploadId: upload.UploadId, MultipartUpload: { Parts: parts } }));
    assert.match(completed.ETag, /-2"?$/);
    report.objects.push({ key: multipartKey, etag: completed.ETag, bytes: Buffer.concat(bodies).length, sha256: hash(Buffer.concat(bodies)) });
    const media = poolFor('media', 'runtime');
    try {
      await media.query('BEGIN');
      await media.query('INSERT INTO inspection_tasks(id,workspace_id,object_key,expected_bytes,expected_etag,expected_sha256,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, workspaceId, key, video.length, put.ETag, hash(video), randomUUID()]);
      // Simulate acknowledgement before Redis loss; no fake successful processing.
      await media.query('INSERT INTO inspection_outbox(task_id,correlation_id,delivered_at) SELECT id,correlation_id,now() FROM inspection_tasks WHERE id=$1', [id]);
      await media.query('COMMIT');
    } finally { await media.end(); }
    const owner = poolFor('media');
    try { report.databases.find(value => value.service === 'media').tables = await manifest(owner); }
    finally { await owner.end(); }
    report.taskId = id;
    report.checkpointAt = new Date().toISOString();
  } else {
    checkpoint = 'DATABASE_MANIFEST';
    assert.deepEqual(report.databases, config.expected.databases, 'all six database table manifests must match before any worker runs');
    for (const object of config.expected.objects) {
      checkpoint = 'OBJECT_MANIFEST';
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
      assert.equal(head.ETag, object.etag, 'physical recovery must retain multipart ETag');
      assert.equal(head.ContentLength, object.bytes);
      const get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: object.key, IfMatch: object.etag }));
      assert.equal(hash(await get.Body.transformToByteArray()), object.sha256);
      assert.equal((await fetch(`${endpoint}/${bucket}/${object.key}`)).status, 403);
    }
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: dbUrl('media', 'runtime'), REDIS_URL: 'redis://target-redis:6379/0', S3_ENDPOINT: endpoint, S3_BUCKET: bucket, S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: 'true', S3_ACCESS_KEY: config.accessKey, S3_SECRET_KEY: config.secretKey, INTERNAL_TOKEN: config.internalToken, TEMP_DIR: '/tmp/recovery-worker', WORKER_CONCURRENCY: '1', MEDIA_WORKERS: 'inspection' });
    const queue = new Queue(INSPECTION_QUEUE, { connection: { host: 'target-redis', port: 6379, maxRetriesPerRequest: 1 } });
    checkpoint = 'OUTBOX_REPLAY';
    const runtime = new InspectionRuntime();
    try {
      assert.equal(await queue.getJob(config.expected.taskId), undefined, 'Redis must be fresh, not restored');
      await runtime.onModuleInit();
      let result;
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        result = (await runtime.pool.query('SELECT status,attempts,result,error_code FROM inspection_tasks WHERE id=$1', [config.expected.taskId])).rows[0];
        if (['succeeded', 'failed'].includes(result.status)) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      assert.equal(result.status, 'succeeded');
      assert.equal(result.attempts, 1);
      assert.equal(result.result.width, 320);
      assert.equal(result.result.height, 240);
      assert.ok(result.result.durationSeconds >= 1.9 && result.result.durationSeconds <= 2.1);
      report.replayedInspection = { status: result.status, attempts: result.attempts };
    } finally { await runtime.onModuleDestroy(); await queue.close(); }
    checkpoint = 'MEDIA_DERIVATIVE_CLEANUP';
    report.mediaCleanup = await verifyMediaCleanup(config,endpoint,bucket,config.expected.taskId);
    checkpoint = 'ANALYSIS_FAILED_ARTIFACT_CLEANUP';
    report.analysisCleanup = await verifyAnalysisCleanup(config,endpoint,bucket);
    report.objects = config.expected.objects.map(({ bytes, sha256 }) => ({ bytes, sha256 }));
    report.crossDatabaseDenials = 30;
    report.runtimeDdlDenials = 6;
    report.adminGrantWriteDenied = true;
    checkpoint = 'PRIVACY_PROFILE_EXPORT';
    report.privacyProfileExport = await verifyPrivacyProfileExports(config);
  }
  process.stdout.write(JSON.stringify(report) + '\n');
} catch (error) {
  if(typeof error.privacyCheckpoint==='string'&&/^[A-Z_]+$/u.test(error.privacyCheckpoint))checkpoint=`${checkpoint}_${error.privacyCheckpoint}`;
  process.stdout.write(JSON.stringify({ errorCode: /^[A-Z_0-9]+$/.test(error.code ?? '') ? error.code : 'FIXTURE_FAILED', checkpoint }) + '\n');
  process.exitCode = 1;
} finally { s3.destroy(); }
