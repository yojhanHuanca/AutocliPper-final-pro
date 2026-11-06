import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DerivativesManager } from '../apps/autoclipper-project-service/dist/application/derivatives.manager.js';

const taskId = 'd1e31786-50f1-4a67-9254-1d0a908feee2';
const uploadId = '6e4dcba1-5ff2-4c48-a678-62f8807d9b46';
const workspaceId = 'f517714e-4890-4bb0-a1d0-a817ec4500ca';
const objectKey = `workspaces/${workspaceId}/media/derivatives/${taskId}/clip.mp4`;

test('repeated download signs the same stored artifact without creating another task or object', async () => {
  const events = [];
  const row = {
    id: taskId,
    upload_id: uploadId,
    project_id: 'fixture-project',
    workspace_id: workspaceId,
    creator_id: 'fixture-user',
    request_hash: 'a'.repeat(64),
    spec: { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 2, aspect: 'vertical' },
    reservation_bytes: 68157440,
    status: 'succeeded',
    attempts: 1,
    error_code: null,
    result: { artifacts: [{ kind: 'video', objectKey, bytes: 1234, sha256: 'b'.repeat(64), etag: '"fixture-etag"', contentType: 'video/mp4' }], durationSeconds: 2, width: 720, height: 1280 },
    started_at: new Date(),
    finished_at: new Date(),
    cleanup_pending: false,
    delivered_at: new Date(),
    cancel_requested: false,
    cancel_delivered_at: null,
    settled_at: new Date(),
  };
  const manager = Object.create(DerivativesManager.prototype);
  manager.pool = { query: async (sql, values) => {
    events.push({ kind: 'query', sql, values });
    assert.equal(sql, 'SELECT * FROM processing_requests WHERE id=$1');
    assert.deepEqual(values, [taskId]);
    return { rows: [row] };
  } };
  manager.authorize = async (_req, id, minimum) => {
    assert.equal(id, uploadId);
    assert.equal(minimum, 'reader');
    return { id: uploadId, project_id: 'fixture-project', workspace_id: workspaceId, state: 'confirmed', expected_bytes: 1234, object_key: `workspaces/${workspaceId}/media/${uploadId}/source.media`, etag: '"source-etag"', sha256: 'c'.repeat(64), content_type: 'video/mp4' };
  };
  manager.s3 = { send: async command => {
    assert.ok(command instanceof HeadObjectCommand);
    events.push({ kind: 'head', key: command.input.Key });
    return { ContentLength: 1234, ETag: '"fixture-etag"' };
  } };
  manager.bucket = 'fixture-bucket';
  manager.signer = new S3Client({
    region: 'us-east-1',
    endpoint: 'http://s3.fixture.invalid',
    forcePathStyle: true,
    credentials: { accessKeyId: 'fixture-access-key', secretAccessKey: 'fixture-secret-key' },
  });

  try {
    const first = await manager.download({}, taskId, 'video');
    const replay = await manager.download({}, taskId, 'video');
    assert.equal(first.contentType, 'video/mp4');
    assert.equal(replay.contentType, 'video/mp4');
    assert.equal(first.expiresInSeconds, 120);
    assert.equal(replay.expiresInSeconds, 120);
    assert.equal(new URL(first.url).pathname.endsWith(objectKey), true);
    assert.equal(new URL(replay.url).pathname.endsWith(objectKey), true);
    assert.deepEqual(events.filter(event => event.kind === 'head').map(event => event.key), [objectKey, objectKey]);
    assert.equal(events.filter(event => event.kind === 'query').length, 2);
    assert.equal(events.some(event => /\b(INSERT|UPDATE|DELETE)\b/iu.test(event.sql)), false);
  } finally {
    manager.signer.destroy();
  }
});
