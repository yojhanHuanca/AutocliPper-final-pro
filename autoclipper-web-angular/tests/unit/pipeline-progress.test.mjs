import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipelineProgress } from '../../.local/tests/client.mjs';

const states = (status, events = []) =>
  pipelineProgress(status, events.map((event) => ({ status: event })))
    .map(({ id, state }) => [id, state]);

test('the pipeline guide follows the server phase and only marks prior work complete', () => {
  assert.deepEqual(states('audio', ['queued']), [
    ['queued', 'complete'], ['audio', 'current'], ['analysis', 'pending'], ['render', 'pending'],
  ]);
  assert.deepEqual(states('analysis', ['queued', 'audio']), [
    ['queued', 'complete'], ['audio', 'complete'], ['analysis', 'current'], ['render', 'pending'],
  ]);
  assert.deepEqual(states('render', ['queued', 'audio', 'analysis']), [
    ['queued', 'complete'], ['audio', 'complete'], ['analysis', 'complete'], ['render', 'current'],
  ]);
});

test('success, failure and cancellation have distinct truthful terminal steps', () => {
  assert.ok(states('succeeded').every(([, state]) => state === 'complete'));
  assert.deepEqual(states('failed', ['queued', 'audio', 'analysis', 'failed']), [
    ['queued', 'complete'], ['audio', 'complete'], ['analysis', 'failed'], ['render', 'pending'],
  ]);
  assert.deepEqual(states('cancelled', ['queued', 'audio', 'cancelled']), [
    ['queued', 'complete'], ['audio', 'cancelled'], ['analysis', 'pending'], ['render', 'pending'],
  ]);
});
