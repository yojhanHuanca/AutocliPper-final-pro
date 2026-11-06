import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbortMultipartUploadCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { ProjectService } from '../apps/autoclipper-project-service/dist/application/project.service.js';

const uploads = new Map([
  ['multipart-expired', { id: 'multipart-expired', workspace_id: 'fixture-workspace', creator_id: 'fixture-owner', project_id: 'fixture-project', object_key: 'fixtures/multipart-source.mp4', expected_bytes: 4096, upload_id: 'fixture-multipart-id', state: 'pending', cleaned_at: null }],
  ['aborted-expired', { id: 'aborted-expired', workspace_id: 'fixture-workspace', creator_id: 'fixture-collaborator', project_id: 'fixture-project', object_key: 'fixtures/aborted-source.mp4', expected_bytes: 2048, upload_id: null, state: 'aborted', cleaned_at: null }],
  ['confirmed-before-lock', { id: 'confirmed-before-lock', workspace_id: 'fixture-workspace', creator_id: 'fixture-owner', project_id: 'fixture-project', object_key: 'fixtures/confirmed-source.mp4', expected_bytes: 1024, upload_id: null, state: 'confirmed', cleaned_at: null }],
]);

test('expired upload cleanup rechecks state under lock and releases only safely cleaned reservations', async () => {
  const events = [];
  const service = Object.create(ProjectService.prototype);
  service.pool = {
    async query(sql) {
      events.push({ kind: 'scan', sql });
      return { rows: [uploads.get('multipart-expired'), uploads.get('aborted-expired'), { ...uploads.get('confirmed-before-lock'), state: 'pending' }] };
    },
  };
  service.tx = async work => work({
    async query(sql, values = []) {
      events.push({ kind: 'query', sql, values });
      if (sql.startsWith('SELECT * FROM uploads WHERE id=$1')) {
        const row = uploads.get(values[0]);
        return { rows: row && row.state !== 'confirmed' && row.cleaned_at === null ? [row] : [] };
      }
      if (sql.startsWith("UPDATE uploads SET state='aborted',cleaned_at=now()")) {
        const row = uploads.get(values[0]);
        if (!row || row.state === 'confirmed' || row.cleaned_at) return { rows: [] };
        row.state = 'aborted';
        row.cleaned_at = new Date();
        return { rows: [{ id: row.id }] };
      }
      if (sql.startsWith('UPDATE workspace_storage SET reserved_bytes=reserved_bytes-$1')) return { rows: [] };
      throw new Error(`Unexpected cleanup query: ${sql}`);
    },
  });
  service.s3 = {
    async send(command) { events.push({ kind: 's3', command }); return {}; },
  };

  await service.cleanupExpiredUploads();

  const s3Events = events.filter(event => event.kind === 's3');
  assert.deepEqual(s3Events.map(event => event.command.constructor), [
    AbortMultipartUploadCommand,
    DeleteObjectCommand,
    DeleteObjectCommand,
  ]);
  assert.deepEqual(s3Events.map(event => event.command.input.Key), [
    'fixtures/multipart-source.mp4',
    'fixtures/multipart-source.mp4',
    'fixtures/aborted-source.mp4',
  ]);
  const quotaReleases = events.filter(event => event.kind === 'query' && event.sql.startsWith('UPDATE workspace_storage'));
  assert.deepEqual(quotaReleases.map(event => event.values), [[4096, 'fixture-workspace'], [2048, 'fixture-workspace']]);
  assert.equal(uploads.get('multipart-expired').cleaned_at instanceof Date, true);
  assert.equal(uploads.get('aborted-expired').cleaned_at instanceof Date, true);
  assert.equal(uploads.get('confirmed-before-lock').cleaned_at, null);
  assert.equal(s3Events.some(event => event.command.input.Key === 'fixtures/confirmed-source.mp4'), false);

  const scan = events.find(event => event.kind === 'scan').sql;
  assert.match(scan, /cleaned_at IS NULL AND \(state='aborted' OR state='pending'\) AND expires_at<now\(\)/u);
  const lock = events.find(event => event.kind === 'query' && event.sql.startsWith('SELECT * FROM uploads WHERE id=$1')).sql;
  assert.match(lock, /state<>'confirmed' AND cleaned_at IS NULL AND expires_at<now\(\) FOR UPDATE/u);
});
