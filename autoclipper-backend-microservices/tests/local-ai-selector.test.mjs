import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAISelector } from '../apps/autoclipper-content-analysis-service/dist/infrastructure/local-ai-selector.js';
import { AnalysisRuntime } from '../apps/autoclipper-content-analysis-service/dist/application/analysis-runtime.js';

const transcript = { language: 'es', durationSeconds: 30, segments: [
  { startSeconds: 0, endSeconds: 5, text: 'Bienvenidos al canal, hoy tenemos varias noticias.' },
  { startSeconds: 5, endSeconds: 15, text: 'El secreto es guardar una copia antes de editar. Así puedes recuperar el original.' },
  { startSeconds: 15, endSeconds: 25, text: 'Esta es otra demostración completa de cómo organizar el trabajo.' },
] };
const spec = { mode: 'llm', count: 1, minSeconds: 2, maxSeconds: 15, contentType: 'tutorial', instructions: 'Consejos prácticos' };

test('local AI selects actual transcript cues without cloud requests or a paid budget', async () => {
  const calls = [];
  const selector = new LocalAISelector(async (url, init) => {
    calls.push(url);
    assert.equal(new URL(url).hostname, 'local-ai');
    const request = JSON.parse(init.body);
    assert.equal(request.think, false);
    assert.equal(request.stream, false);
    assert.ok(request.format.properties.candidateId);
    return globalThis.Response.json({ done: true, message: { content: JSON.stringify({candidateId:'choice_1',title:'Guarda una copia antes de editar',explanation:'Un consejo completo y práctico.'}) }, prompt_eval_count: 100, eval_count: 25 });
  });
  const result = await selector.select(transcript, spec, new globalThis.AbortController().signal);
  assert.equal(result.segments[0].startSeconds, 5);
  assert.equal(result.segments[0].endSeconds, 15);
  assert.equal(result.provider, 'ollama');
  assert.equal(result.estimatedExternalCostUsd, 0);
  assert.equal(calls.length, 1);
});

test('a hallucinated cue is rejected rather than replaced with an arbitrary clip', async () => {
  const selector = new LocalAISelector(async () => globalThis.Response.json({ done: true, message: { content: JSON.stringify({candidateId:'choice_900',title:'Inventado',explanation:'No aparece en el origen.'}) } }));
  await assert.rejects(selector.select(transcript, spec, new globalThis.AbortController().signal), error => error.code === 'LOCAL_AI_INVALID_SELECTION');
});

test('local AI readiness checks the installed model and reports an absent model safely', async () => {
  const ready = new LocalAISelector(async () => globalThis.Response.json({ models: [{ name: 'qwen3:0.6b' }] }));
  assert.equal((await ready.diagnostics()).configured, true);
  const missing = new LocalAISelector(async () => globalThis.Response.json({ models: [] }));
  assert.equal((await missing.diagnostics()).code, 'LOCAL_AI_NOT_READY');
});

test('local generative preflight succeeds with payment disabled and a zero external budget', async () => {
  const runtime = Object.create(AnalysisRuntime.prototype);
  runtime.selectionProvider = 'local_ai';
  runtime.localAISelector = new LocalAISelector(async () => globalThis.Response.json({ models: [{ name: 'qwen3:0.6b' }] }));
  runtime.selector = runtime.localAISelector;
  runtime.providers = { whisper_cpp: { configured: async () => true } };
  runtime.deepgram = { budget: 0, unitPrice: 0, approved: false };
  const result = await runtime.preflight({ provider: 'whisper_cpp', selection: spec }, 30);
  assert.deepEqual(result, { ready: true, code: null, httpStatus: 200 });
});
