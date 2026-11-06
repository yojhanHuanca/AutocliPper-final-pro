import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ProcessingRuntime } from '../apps/autoclipper-media-processing-service/dist/application/processing-runtime.js';

const taskId = '30ae0bc9-63e5-4a56-bfaa-0bfb57e29f19';
const workspaceId = '5b811a5e-01d6-47d5-90a0-aa29f733688a';

test('recovery of a stale running render removes its fixed task outputs before starting another attempt', async () => {
  const events = [];
  const task = {
    id: taskId,
    workspace_id: workspaceId,
    creator_id: 'fixture-user',
    inspection_id: 'fixture-inspection',
    spec: { version: 1, kind: 'audio' },
    request_hash: 'a'.repeat(64),
    status: 'running',
    correlation_id: 'fixture-correlation',
    attempts: 1,
    cancel_requested: false,
    cleanup_pending: false,
    result: null,
    error_code: null,
    started_at: new Date(),
    finished_at: null,
  };
  const lease = {
    on() {},
    removeListener() {},
    release() {},
    async query(sql) {
      events.push({ kind: 'query', sql });
      if (sql.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql === 'SELECT * FROM processing_tasks WHERE id=$1') return { rows: [task] };
      if (sql.startsWith('SELECT * FROM inspection_tasks')) return { rows: [] };
      return { rows: [] };
    },
  };
  const runtime = Object.create(ProcessingRuntime.prototype);
  runtime.config = { S3_BUCKET: 'fixture-bucket' };
  runtime.pool = { connect: async () => lease, query: async () => ({ rows: [] }) };
  runtime.active = new Map();
  runtime.s3 = {
    async send(command) {
      assert.ok(command instanceof DeleteObjectCommand);
      events.push({ kind: 'delete-object', key: command.input.Key });
      return {};
    },
  };

  await assert.rejects(runtime.process({ data: { version: 1, taskId } }));

  const firstDelete = events.findIndex(event => event.kind === 'delete-object');
  const sourceRead = events.findIndex(event => event.kind === 'query' && event.sql.startsWith('SELECT * FROM inspection_tasks'));
  assert.ok(firstDelete >= 0 && firstDelete < sourceRead, 'stale task artifacts must be removed before the retry reads and renders its source');
  const deletedKeys = events.filter(event => event.kind === 'delete-object').map(event => event.key);
  assert.deepEqual(deletedKeys.slice(0, 4), [
    `workspaces/${workspaceId}/media/derivatives/${taskId}/clip.mp4`,
    `workspaces/${workspaceId}/media/derivatives/${taskId}/audio.wav`,
    `workspaces/${workspaceId}/media/derivatives/${taskId}/captions.srt`,
    `workspaces/${workspaceId}/media/derivatives/${taskId}/captions.vtt`,
  ]);
  assert.equal(deletedKeys.every(key => key.startsWith(`workspaces/${workspaceId}/media/derivatives/${taskId}/`)), true);
});
