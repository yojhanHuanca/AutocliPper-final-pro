import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { cookieName } from '@autoclipper/http-security';
import { EditorManager } from '../apps/autoclipper-project-service/dist/application/editor.manager.js';
import { editorSplitIdempotencyKeys, splitEditorSpec } from '../apps/autoclipper-project-service/dist/application/editor-split.js';

const { structuredClone } = globalThis;
const creatorId = '1bf2d1f9-7195-46b7-b9c8-a2a35a4798ac';
const uploadId = '34c4d1e7-5e7c-4e88-8c0f-2699368240ec';
const projectId = 'c8f506bd-9381-477f-b68c-0e6ac714e464';
const workspaceId = '09f9bda5-35a6-4ef4-a5e0-0e3a774c5598';
const draftId = 'ab89a2e8-18bf-4f78-8c56-2f70b4483c4a';
const correlationId = 'f8d05c92-b97e-4fe6-90f4-34a3c0100c84';
const csrfKey = 'fixture-csrf-signing-key-with-at-least-32-characters';
const internalToken = 'fixture-internal-token-that-is-at-least-32-characters';
const sourceSpec = {
  version: 1,
  kind: 'clip',
  startSeconds: 4,
  endSeconds: 14,
  aspect: 'vertical',
  subtitles: {
    source: 'user',
    cues: [
      { startSeconds: 4, endSeconds: 8, text: 'First caption' },
      { startSeconds: 8, endSeconds: 10, text: 'Caption across the cut' },
      { startSeconds: 11, endSeconds: 13, text: 'Last caption' },
    ],
  },
};

function request(key, { ifMatch = '"1"', cutCsrf = false } = {}) {
  const payload = `${Date.now()}.fixture-csrf-payload`;
  const csrf = `${payload}.${createHmac('sha256', csrfKey).update(payload).digest('base64url')}`;
  return {
    headers: {
      origin: 'http://localhost:4200',
      cookie: `${cookieName('csrf')}=${csrf}; ${cookieName('access')}=fixture-access-token`,
      ...(cutCsrf ? {} : { 'x-csrf-token': csrf }),
      ...(ifMatch === null ? {} : { 'if-match': ifMatch }),
      'idempotency-key': key,
    },
  };
}

function revision(draft, spec, version = 1) {
  return {
    id: randomUUID(),
    draft_id: draft.id,
    version,
    author_id: creatorId,
    action: 'created',
    restored_from_version: null,
    spec,
    render_spec: { version: 1, kind: 'clip', startSeconds: spec.startSeconds, endSeconds: spec.endSeconds, aspect: spec.aspect },
    created_at: new Date('2026-10-31T00:00:00.000Z'),
  };
}

function draft(id, key, hash, name = 'Original') {
  return {
    id,
    upload_id: uploadId,
    project_id: projectId,
    workspace_id: workspaceId,
    name,
    current_version: 1,
    creator_id: creatorId,
    idempotency_key: key,
    request_hash: hash,
    created_at: new Date('2026-10-31T00:00:00.000Z'),
    updated_at: new Date('2026-10-31T00:00:00.000Z'),
  };
}

class FakePool {
  constructor() {
    this.drafts = new Map();
    this.revisions = new Map();
    this.writes = [];
    this.failNextRevisionInsert = null;
    this.tail = Promise.resolve();
    const source = draft(draftId, randomUUID(), 'a'.repeat(64));
    this.drafts.set(source.id, source);
    this.revisions.set(`${source.id}:1`, revision(source, sourceSpec));
  }

  async query(sql, values = []) {
    return this.queryState(sql, values, this);
  }

  async connect() {
    return new FakeClient(this);
  }

  async acquire() {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    await previous;
    return release;
  }

  queryState(sql, values, state) {
    const query = sql.replace(/\s+/gu, ' ').trim();
    if (query.startsWith('SELECT * FROM editor_drafts WHERE id=$1')) {
      const row = state.drafts.get(values[0]);
      return Promise.resolve({ rows: row ? [structuredClone(row)] : [] });
    }
    if (query.startsWith('SELECT * FROM editor_drafts WHERE creator_id=$1 AND idempotency_key=$2')) {
      const row = [...state.drafts.values()].find((item) => item.creator_id === values[0] && item.idempotency_key === values[1]);
      return Promise.resolve({ rows: row ? [structuredClone(row)] : [] });
    }
    if (query.startsWith('SELECT * FROM editor_revisions WHERE draft_id=$1 AND version=$2')) {
      const row = state.revisions.get(`${values[0]}:${values[1]}`);
      return Promise.resolve({ rows: row ? [structuredClone(row)] : [] });
    }
    if (query.startsWith('INSERT INTO editor_drafts(')) {
      const row = {
        id: values[0], upload_id: values[1], project_id: values[2], workspace_id: values[3], creator_id: values[4],
        name: values[5], idempotency_key: values[6], request_hash: values[7], current_version: 1,
        created_at: new Date('2026-10-31T00:00:01.000Z'), updated_at: new Date('2026-10-31T00:00:01.000Z'),
      };
      state.drafts.set(row.id, row);
      state.writes.push('editor_drafts');
      return Promise.resolve({ rows: [structuredClone(row)] });
    }
    if (query.startsWith('INSERT INTO editor_revisions(')) {
      if (state instanceof FakeClient) {
        state.revisionInsertCount += 1;
        if (state.revisionInsertCount === this.failNextRevisionInsert) {
          this.failNextRevisionInsert = null;
          throw new Error('fixture revision insert failed');
        }
      }
      const row = {
        id: values[0], draft_id: values[1], version: values[2], author_id: values[3], action: values[4],
        spec: values[5], render_spec: values[6], correlation_id: values[7], restored_from_version: values[8],
        created_at: new Date('2026-10-31T00:00:01.000Z'),
      };
      state.revisions.set(`${row.draft_id}:${row.version}`, row);
      state.writes.push('editor_revisions');
      return Promise.resolve({ rows: [structuredClone(row)] });
    }
    throw new Error(`Unexpected fixture query: ${query}`);
  }
}

class FakeClient {
  constructor(pool) { this.pool = pool; }
  async query(sql, values = []) {
    const query = sql.replace(/\s+/gu, ' ').trim();
    if (query === 'BEGIN') {
      this.transaction = true;
      return { rows: [] };
    }
    if (query.startsWith('SELECT pg_advisory_xact_lock')) {
      this.releaseLock = await this.pool.acquire();
      this.drafts = new Map([...this.pool.drafts].map(([key, value]) => [key, structuredClone(value)]));
      this.revisions = new Map([...this.pool.revisions].map(([key, value]) => [key, structuredClone(value)]));
      this.writes = [];
      this.revisionInsertCount = 0;
      return { rows: [] };
    }
    if (query === 'COMMIT') {
      this.pool.drafts = this.drafts;
      this.pool.revisions = this.revisions;
      this.pool.writes.push(...this.writes);
      this.releaseLock?.();
      this.transaction = false;
      return { rows: [] };
    }
    if (query === 'ROLLBACK') {
      this.releaseLock?.();
      this.transaction = false;
      return { rows: [] };
    }
    return this.pool.queryState(query, values, this);
  }
  release() { if (this.transaction) this.releaseLock?.(); }
}

async function fixture(t) {
  const identity = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (req.headers['x-service-token'] !== internalToken || input.token !== 'fixture-access-token') {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: creatorId, email: 'split-fixture@example.test' }));
  });
  identity.listen(0, '127.0.0.1');
  await once(identity, 'listening');
  t.after(() => new Promise((resolve) => {
    identity.closeAllConnections();
    identity.close(resolve);
  }));

  const pool = new FakePool();
  let editorAllowed = true;
  const derivatives = {
    sourceForEditor: async (_req, id) => ({
      upload: { id, project_id: projectId, workspace_id: workspaceId },
      metadata: { durationSeconds: 30, width: 1280, height: 720, audioCodec: 'aac' },
    }),
    validateEditorSplit: async () => {},
  };
  const analyses = { prepareRender: async () => { throw new Error('unexpected analysis call'); } };
  const config = {
    INTERNAL_TOKEN: internalToken,
    IDENTITY_URL: `http://127.0.0.1:${identity.address().port}`,
    CSRF_SIGNING_KEY: csrfKey,
    CORS_ORIGIN: 'http://localhost:4200',
  };
  const manager = new EditorManager(pool, config, derivatives, analyses, async (_req, _uploadId, minimum) => {
    assert.equal(minimum, 'editor');
    if (!editorAllowed) throw new ForbiddenException();
    return {};
  });
  t.after(() => { pool.close?.(); });
  return { manager, pool, denyEditor: () => { editorAllowed = false; } };
}

test('splitting validates source boundaries and clips crossing subtitles without losing text', { timeout: 5000 }, () => {
  const [left, right] = splitEditorSpec(sourceSpec, 9);
  assert.equal(left.startSeconds, 4);
  assert.equal(left.endSeconds, 9);
  assert.equal(right.startSeconds, 9);
  assert.equal(right.endSeconds, 14);
  assert.deepEqual(left.subtitles.cues[1], { startSeconds: 8, endSeconds: 9, text: 'Caption across the cut' });
  assert.deepEqual(right.subtitles.cues[0], { startSeconds: 9, endSeconds: 10, text: 'Caption across the cut' });
  assert.equal(splitEditorSpec(sourceSpec, 4.05), null);
  assert.equal(splitEditorSpec(sourceSpec, 8.005), null, 'a caption cut that would drop a sub-0.01s fragment is rejected');
  assert.equal(splitEditorSpec(sourceSpec, 14), null);
  assert.equal(splitEditorSpec(sourceSpec, Number.NaN), null);
  const transcript = { ...sourceSpec, subtitles: { source: 'transcript', analysisId: randomUUID() } };
  const transcriptParts = splitEditorSpec(transcript, 9);
  assert.equal(transcriptParts[0].subtitles.analysisId, transcript.subtitles.analysisId);
  assert.equal(transcriptParts[1].subtitles.analysisId, transcript.subtitles.analysisId);
});

test('editor split is atomic, authorized, If-Match guarded, and idempotent under concurrent replay', { timeout: 10000 }, async (t) => {
  const { manager, pool, denyEditor } = await fixture(t);
  pool.failNextRevisionInsert = 2;
  await assert.rejects(manager.split(request(randomUUID()), draftId, { cutSeconds: 9 }, correlationId), /fixture revision insert failed/u);
  assert.equal(pool.drafts.size, 1, 'failed second revision rolls back both output drafts');
  assert.equal(pool.revisions.size, 1, 'failed second revision rolls back the first output revision');
  assert.deepEqual(pool.writes, []);

  const requestKey = randomUUID();
  const headers = () => request(requestKey);
  const [leftKey, rightKey] = editorSplitIdempotencyKeys(creatorId, requestKey);
  assert.match(leftKey, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.notEqual(leftKey, rightKey);

  const [first, replay] = await Promise.all([
    manager.split(headers(), draftId, { cutSeconds: 9 }, correlationId),
    manager.split(headers(), draftId, { cutSeconds: 9 }, correlationId),
  ]);
  assert.equal(first.left.id, replay.left.id);
  assert.equal(first.right.id, replay.right.id);
  assert.equal(pool.drafts.size, 3);
  assert.equal(pool.revisions.size, 3);
  assert.equal(pool.drafts.get(draftId).current_version, 1, 'input draft is retained unchanged');
  assert.equal(first.left.uploadId, uploadId);
  assert.equal(first.right.uploadId, uploadId);
  assert.equal(first.left.projectId, projectId);
  assert.equal(first.right.projectId, projectId);
  assert.equal(first.left.revision.spec.endSeconds, 9);
  assert.equal(first.right.revision.spec.startSeconds, 9);
  assert.deepEqual(pool.writes.sort(), ['editor_drafts', 'editor_drafts', 'editor_revisions', 'editor_revisions']);

  await assert.rejects(manager.split(headers(), draftId, { cutSeconds: 10 }, correlationId), (error) => error.getStatus() === 409);
  await assert.rejects(manager.split(request(randomUUID(), { ifMatch: null }), draftId, { cutSeconds: 9 }, correlationId), (error) => error.getStatus() === 428);
  await assert.rejects(manager.split(request(randomUUID(), { ifMatch: '"2"' }), draftId, { cutSeconds: 9 }, correlationId), (error) => error.getStatus() === 412);
  await assert.rejects(manager.split(request(randomUUID()), draftId, { cutSeconds: 4.05 }, correlationId), (error) => error.getStatus() === 400);
  await assert.rejects(manager.split(request(randomUUID(), { cutCsrf: true }), draftId, { cutSeconds: 9 }, correlationId), (error) => error.getStatus() === 403);

  denyEditor();
  await assert.rejects(manager.split(request(randomUUID()), draftId, { cutSeconds: 9 }, correlationId), (error) => error.getStatus() === 403);
  assert.equal(pool.drafts.size, 3);
});
