import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canTransition, validateMetadata, validateObjectKey } from '../apps/autoclipper-media-processing-service/dist/domain/inspection.js';
import { inspectionEvent } from '@autoclipper/event-contracts';

const valid = { format: { duration: '2.0', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 320, height: 240 }] };
test('metadata validates format, finite duration and video dimensions', () => {
  assert.equal(validateMetadata(valid, 10).durationSeconds, 2);
  assert.throws(() => validateMetadata({ ...valid, format: { ...valid.format, duration: 'Infinity' } }, 10));
  assert.throws(() => validateMetadata(valid, 1), /MEDIA_LIMIT_EXCEEDED/);
  assert.throws(() => validateMetadata({ ...valid, streams: [] }, 10));
  assert.throws(() => validateMetadata({ ...valid, format: { ...valid.format, format_name: 'hls' } }, 10));
});
test('object references reject cross-workspace keys, traversal and external URLs', () => {
  const workspace = randomUUID();
  validateObjectKey(`workspaces/${workspace}/media/source.mp4`, workspace);
  for (const key of [`workspaces/${randomUUID()}/media/source.mp4`, `workspaces/${workspace}/media/../../secrets`, 'http://169.254.169.254/latest/meta-data']) assert.throws(() => validateObjectKey(key, workspace));
});
test('terminal jobs cannot be re-entered; events accept only versioned task references', () => {
  assert.equal(canTransition('queued', 'running'), true);
  assert.equal(canTransition('running', 'queued'), true);
  assert.equal(canTransition('succeeded', 'running'), false);
  assert.equal(canTransition('failed', 'queued'), false);
  const event = { version: 1, taskId: randomUUID(), correlationId: randomUUID() };
  assert.equal(inspectionEvent.safeParse(event).success, true);
  assert.equal(inspectionEvent.safeParse({ ...event, url: 'http://localhost' }).success, false);
  assert.equal(inspectionEvent.safeParse({ ...event, version: 2 }).success, false);
});
