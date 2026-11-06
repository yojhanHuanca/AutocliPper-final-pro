import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateClipOutcome, pipelineStorageReservation } from '../apps/autoclipper-project-service/dist/application/pipeline-clips.js';
import { PipelineManager } from '../apps/autoclipper-project-service/dist/application/pipeline.manager.js';
import { pipelineSpec } from '@autoclipper/api-contracts';

test('multi-clip jobs reserve audio plus the maximum output for each requested render', () => {
  const spec = pipelineSpec.parse({version:2,mode:'automatic',provider:'whisper_cpp',clipCount:3,contentType:'gameplay',aspect:'vertical',subtitles:{source:'none'}});
  assert.equal(pipelineStorageReservation(spec), 338690048);
  const manual = pipelineSpec.parse({version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'},startSeconds:0,endSeconds:8,aspect:'square'});
  assert.equal(pipelineStorageReservation(manual), 202375168);
});

test('automatic pipeline contract exposes clip count, optional duration, aspect and subtitle choice while keeping MP4 fixed', () => {
  const base = {
    version: 2, mode: 'automatic', provider: 'whisper_cpp', clipCount: 2,
    contentType: 'tutorial', aspect: 'vertical', subtitles: { source: 'transcript' },
  };
  const spec = pipelineSpec.parse({ ...base, maxDurationSeconds: 45 });
  assert.equal(spec.clipCount, 2);
  assert.equal(spec.maxDurationSeconds, 45);
  assert.equal(spec.language, 'auto');
  assert.equal(spec.aspect, 'vertical');
  assert.equal(spec.subtitles.source, 'transcript');

  const noDuration = pipelineSpec.parse({ ...base, subtitles: { source: 'none' } });
  assert.equal(noDuration.maxDurationSeconds, undefined);
  assert.equal(noDuration.selectionMode, 'local');
  assert.equal(noDuration.subtitles.source, 'none');
  for (const invalid of [
    { ...base, clipCount: 4 },
    { ...base, maxDurationSeconds: 0 },
    { ...base, aspect: 'cinema' },
    { ...base, subtitles: { source: 'user' } },
    { ...base, format: 'webm' },
  ]) assert.equal(pipelineSpec.safeParse(invalid).success, false);
});

test('project maps default automatic requests to local analysis and requires explicit LLM selection', () => {
  const manager = Object.create(PipelineManager.prototype);
  const automatic = pipelineSpec.parse({version:2,mode:'automatic',provider:'whisper_cpp',clipCount:2,contentType:'tutorial',aspect:'vertical',subtitles:{source:'none'}});
  assert.deepEqual(manager.analysisSpec(automatic),{version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'local',count:2,minSeconds:1,maxSeconds:120}});
  assert.deepEqual(manager.analysisSpec({...automatic,selectionMode:'llm'}),{version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'llm',count:2,minSeconds:1,maxSeconds:120,contentType:'tutorial',instructions:''}});
});

test('pipeline completion waits for every clip and distinguishes partial success', () => {
  assert.equal(aggregateClipOutcome(3, ['succeeded','running','queued']), undefined);
  assert.equal(aggregateClipOutcome(3, ['succeeded','failed','succeeded']), 'partial_failed');
  assert.equal(aggregateClipOutcome(3, ['succeeded','succeeded','succeeded']), 'succeeded');
  assert.equal(aggregateClipOutcome(3, ['failed','failed','failed']), 'failed');
  assert.equal(aggregateClipOutcome(2, ['cancelled','cancelled']), 'cancelled');
  assert.equal(aggregateClipOutcome(3, ['succeeded','failed']), undefined);
});
