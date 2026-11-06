import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { account } from '../helpers/accounts.mjs';

const execute = promisify(execFile);
test('real free AI: upload → Whisper → model selection → FFmpeg → edit/export → sharing availability', { timeout: 600000 }, async () => {
  assert.equal(process.env.LOCAL_AI_ACCEPTANCE, 'true', 'Explicit opt-in is required for real local inference.');
  const alice = await account();
  const providers = await alice.c.request('/analyses/providers');
  assert.equal(providers.status, 200);
  assert.equal(providers.value.paidExecutionEnabled, false);
  assert.equal(providers.value.selection.provider, 'local_ai');
  assert.equal(providers.value.selection.readiness.status, 'ready');
  const root = resolve('.local/semantic-pipeline');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  assert.ok(resolve(directory).startsWith(root + sep));
  let projectId;
  const request = async (path, method = 'GET', input) => {
    const result = await alice.c.request(path, method, input, method === 'POST' ? { 'idempotency-key': randomUUID() } : {});
    assert.ok(result.status >= 200 && result.status < 300, `${method} ${path}: HTTP ${result.status}, ${result.value.code ?? 'unexpected response'}`);
    return result.value;
  };
  const wait = async (path, complete) => {
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const result = await request(path);
      if (['failed', 'cancelled', 'partial_failed'].includes(result.status)) assert.fail(`${path}: ${result.errorCode ?? result.status}`);
      if (complete(result)) return result;
      await new Promise(done => setTimeout(done, 1200));
    }
    assert.fail(`Local pipeline timed out: ${path}`);
  };
  try {
    const workspace = await request('/workspaces', 'POST', { kind: 'personal', name: 'Free AI flow acceptance' });
    const project = await request('/projects', 'POST', { workspaceId: workspace.id, name: 'Synthetic Spanish speech — semantic AI' });
    projectId = project.id;
    let upload;
    if(process.env.LOCAL_AI_SOURCE_URL){
      const imported=await request(`/projects/${projectId}/source-links/import`,'POST',{url:process.env.LOCAL_AI_SOURCE_URL});
      assert.equal(imported.state,'succeeded');
      upload={id:imported.uploadId};
    }else{
    const source = join(directory, 'source.mp4');
    await execute(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=25', '-i', fileURLToPath(new URL('../fixtures/speech-es.wav', import.meta.url)), '-shortest', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source], { timeout: 30000, windowsHide: true });
    const bytes = await readFile(source);
      upload = await request(`/projects/${projectId}/uploads`, 'POST', { mode: 'put', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), contentType: 'video/mp4' });
    assert.ok((await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes })).ok);
    await request(`/uploads/${upload.id}/confirm`, 'POST');

    }
    await wait(`/uploads/${upload.id}`, item => {assert.notEqual(item.inspection?.status,'failed','Source inspection failed');return item.inspection?.status==='succeeded';});
    const pipeline = await request(`/uploads/${upload.id}/pipelines`, 'POST', { version: 2, mode: 'automatic', provider: 'whisper_cpp', selectionMode: 'llm', language: 'auto', clipCount: 1, maxDurationSeconds: 8, contentType: 'tutorial', instructions: 'Elige una explicación útil del proyecto.', aspect: 'vertical', subtitles: { source: 'transcript', style: { template: 'boxed', fontSize: 24, position: 'bottom' } } });
    const completed = await wait(`/pipelines/${pipeline.id}`, item => item.status === 'succeeded');
    assert.equal(completed.clips.length, 1);
    const clip = completed.clips[0];
    assert.equal(clip.status, 'succeeded');
    const analysis = await request(`/analyses/${completed.analysisId}`);
    assert.equal(analysis.selection.provider, 'ollama');
    assert.equal(analysis.selection.estimatedExternalCostUsd, 0);
    assert.equal(analysis.transcript.estimatedExternalCostUsd, 0);
    const artifact = await request(`/processing/${clip.processingId}/download?kind=video`);
    const rendered = Buffer.from(await (await fetch(artifact.url)).arrayBuffer());
    assert.equal(createHash('sha256').update(rendered).digest('hex'), artifact.sha256);
    assert.equal(rendered.toString('ascii', 4, 8), 'ftyp');
    const target = join(directory, 'clip.mp4');
    await writeFile(target, rendered);
    const metadata = JSON.parse((await execute(process.env.FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', target], { timeout: 15000, windowsHide: true })).stdout);
    assert.ok(Number(metadata.format.duration) > 0 && Number(metadata.format.duration) < 8.5);
    const edit = await request(`/uploads/${upload.id}/edits`, 'POST', { name: 'Edited semantic clip', spec: { version: 1, kind: 'clip', startSeconds: clip.startSeconds, endSeconds: clip.endSeconds, aspect: 'vertical', framing: { x: 0.5, y: 0.5 }, subtitles: { source: 'transcript', analysisId: completed.analysisId, style: { template: 'clean', fontSize: 24, position: 'bottom' } } } });
    const exported = await request(`/edits/${edit.id}/renders`, 'POST', { revisionVersion: 1 });
    await wait(`/processing/${exported.id}`, item => item.status === 'succeeded');
    const connections = await request('/social/connections');
    assert.deepEqual(connections.providers.map(item => item.provider).sort(), ['tiktok', 'youtube']);
    assert.equal(JSON.stringify(connections).includes('accessToken'), false);
    const unavailable = connections.providers.find(item => !item.configured);
    if (unavailable) {
      const denied = await alice.c.request(`/processing/${exported.id}/publications`, 'POST', { provider: unavailable.provider, title: 'Synthetic acceptance only', madeForKids: false, consent: true }, { 'idempotency-key': randomUUID() });
      assert.equal(denied.status, 503);
      assert.equal(denied.value.code, 'SOCIAL_OAUTH_NOT_CONFIGURED');
    }
    console.log('Verified real local transcription, generative selection, MP4 checksum, editor export, and honest OAuth availability. No paid call or external publication was made.');
  } finally {
    if (projectId) await alice.c.request(`/projects/${projectId}`, 'DELETE').catch(() => undefined);
    await alice.c.request('/auth/logout', 'POST').catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
