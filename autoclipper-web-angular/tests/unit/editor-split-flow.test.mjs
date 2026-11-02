import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { EditorState, EditorApi, ProjectsApi, CollaborationApi, DESIGN_MODE, EDITOR_DISCARD_CONFIRMATION, WorkspaceStore, SessionStore } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('splitting a saved clip requires confirmation, reuses an uncertain request key and lists only server-created drafts', async () => {
  const routeParams = new BehaviorSubject(new Map([['id', 'edit-source']]));
  const sourceDraft = {
    id: 'edit-source', uploadId: 'upload-1', projectId: 'project-1', name: 'Original', version: 7,
    revision: { id: 'revision-7', version: 7, createdAt: '2026-10-31T12:00:00Z', spec: { version: 1, kind: 'clip', startSeconds: 2, endSeconds: 8, aspect: 'vertical', subtitles: { source: 'none' } } },
  };
  const createdDraft = (id, name, startSeconds, endSeconds) => ({
    id, uploadId: 'upload-1', projectId: 'project-1', name, version: 1,
    revision: { id: `revision-${id}`, version: 1, createdAt: '2026-10-31T12:01:00Z', spec: { version: 1, kind: 'clip', startSeconds, endSeconds, aspect: 'vertical', subtitles: { source: 'none' } } },
  });
  const splitResult = { sourceDraftId: 'edit-source', left: createdDraft('edit-left', 'Original (1)', 2, 5), right: createdDraft('edit-right', 'Original (2)', 5, 8) };
  const writes = [];
  let rejectFirst = true;
  let renderCalls = 0;
  const api = {
    edit: async () => ({ draft: sourceDraft, etag: '"7"' }),
    project: async () => ({ id: 'project-1', name: 'Project', workspaceId: 'workspace-1' }),
    history: async () => ({ items: [], nextBeforeVersion: null }),
    comments: async () => ({ items: [], nextBeforeId: null }),
    exports: async () => ({ items: [] }),
    analysis: async () => ({ status: 'succeeded', transcript: { segments: [] } }),
    sourcePlayback: async () => ({ url: 'https://media.example.test/source', expiresInSeconds: 120, contentType: 'video/mp4', bytes: 100, sha256: 'a'.repeat(64) }),
    split: async (...args) => { writes.push(args); if (rejectFirst) { rejectFirst = false; throw new Error('La conexión se interrumpió.'); } return splitResult; },
    render: async () => { renderCalls++; },
  };
  const collaboration = { review: async () => ({ version: 1, reviewVersion: 1, status: 'draft', approvedRevisionVersion: null, approvals: [] }), comments: async () => ({ items: [], nextBeforeId: null }) };
  TestBed.configureTestingModule({ providers: [
    EditorState,
    { provide: EDITOR_DISCARD_CONFIRMATION, useValue: () => true },
    { provide: EditorApi, useValue: api },
    { provide: ProjectsApi, useValue: { upload: async () => ({ id: 'upload-1', projectId: 'project-1', state: 'confirmed', bytes: 100, expiresAt: '2026-11-01T12:00:00Z', inspection: { status: 'succeeded', result: { durationSeconds: 20, format: 'mp4', width: 1280, height: 720, videoCodec: 'h264', audioCodec: 'aac' } } }), edits: async () => ({ items: [{ id: 'edit-source', uploadId: 'upload-1', name: 'Original', version: 7, updatedAt: sourceDraft.revision.createdAt }] }) } },
    { provide: CollaborationApi, useValue: collaboration },
    { provide: DESIGN_MODE, useValue: false },
    { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable(), snapshot: { paramMap: new Map([['id', 'edit-source']]) } } },
    { provide: Router, useValue: { navigateByUrl: async () => true } },
    { provide: WorkspaceStore, useValue: { loaded: () => true, workspaces: () => [{ id: 'workspace-1', role: 'editor' }] } },
    { provide: SessionStore, useValue: { user: () => ({ id: 'editor-1' }) } },
    { provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } },
  ] });
  try {
    const state = TestBed.inject(EditorState);
    for (let attempt = 0; attempt < 30 && !state.draft(); attempt++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.draft().id, 'edit-source');
    assert.equal(state.canSplitClip(), true);

    state.requestSplit();
    assert.equal(state.splitCutSeconds(), 5, 'The default split point is the midpoint of the saved interval.');
    await state.confirmSplit();
    assert.match(state.error(), /conexión se interrumpió/);
    assert.equal(state.splitConfirmation(), true, 'The user can retry an uncertain operation without losing confirmation context.');
    assert.equal(state.splitRetryRequired(), true);
    state.splitCutSeconds.set(6);
    await state.confirmSplit();
    assert.equal(writes.length, 1, 'An uncertain operation cannot be changed into a new body with another key.');
    state.requestSplit();
    assert.equal(state.splitCutSeconds(), 5, 'The retry restores the original cut point.');

    await state.confirmSplit();
    assert.deepEqual(writes.map(([id, cut, etag]) => [id, cut, etag]), [
      ['edit-source', 5, '"7"'], ['edit-source', 5, '"7"'],
    ]);
    assert.equal(writes[0][3], writes[1][3], 'An uncertain retry reuses its idempotency key.');
    assert.deepEqual(state.projectEdits().map(item => item.id), ['edit-source', 'edit-left', 'edit-right']);
    assert.match(state.message(), /dos nuevos clips/);
    assert.match(state.message(), /No se inició ningún render/);
    assert.equal(renderCalls, 0);
    assert.equal(state.splitConfirmation(), false);

    state.spec.aspect = 'square';
    state.touchForm();
    assert.equal(state.canSplitClip(), false, 'Unsaved edits block splitting so the server receives the exact visible revision.');
    state.requestSplit();
    await state.confirmSplit();
    assert.equal(writes.length, 2);
  } finally { TestBed.resetTestingModule(); }
});

test('read-only workspaces cannot invoke clip splitting', async () => {
  const routeParams = new BehaviorSubject(new Map([['id', 'edit-readonly']]));
  const api = {
    edit: async () => ({ draft: { id: 'edit-readonly', uploadId: 'upload-1', projectId: 'project-1', name: 'Clip', version: 1, revision: { id: 'revision-1', version: 1, createdAt: '2026-10-31T12:00:00Z', spec: { version: 1, kind: 'clip', startSeconds: 1, endSeconds: 9, aspect: 'vertical', subtitles: { source: 'none' } } } }, etag: '"1"' }),
    project: async () => ({ id: 'project-1', name: 'Project', workspaceId: 'workspace-1' }),
    history: async () => ({ items: [], nextBeforeVersion: null }), comments: async () => ({ items: [], nextBeforeId: null }), exports: async () => ({ items: [] }),
  };
  let splitCalls = 0;
  TestBed.configureTestingModule({ providers: [
    EditorState, { provide: EDITOR_DISCARD_CONFIRMATION, useValue: () => true }, { provide: EditorApi, useValue: { ...api, split: async () => { splitCalls++; } } },
    { provide: ProjectsApi, useValue: { upload: async () => ({ id: 'upload-1', projectId: 'project-1', state: 'confirmed', bytes: 100, expiresAt: '2026-11-01T12:00:00Z', inspection: { status: 'succeeded', result: { durationSeconds: 20, format: 'mp4', width: 1280, height: 720, videoCodec: 'h264', audioCodec: 'aac' } } }), edits: async () => ({ items: [] }) } },
    { provide: CollaborationApi, useValue: { review: async () => ({ version: 1, reviewVersion: 1, status: 'draft', approvedRevisionVersion: null, approvals: [] }), comments: async () => ({ items: [], nextBeforeId: null }) } },
    { provide: DESIGN_MODE, useValue: false }, { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable(), snapshot: { paramMap: new Map([['id', 'edit-readonly']]) } } },
    { provide: Router, useValue: { navigateByUrl: async () => true } }, { provide: WorkspaceStore, useValue: { loaded: () => true, workspaces: () => [{ id: 'workspace-1', role: 'reader' }] } },
    { provide: SessionStore, useValue: { user: () => ({ id: 'reader-1' }) } }, { provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } },
  ] });
  try {
    const state = TestBed.inject(EditorState);
    for (let attempt = 0; attempt < 30 && !state.draft(); attempt++) await new Promise(resolve => setImmediate(resolve));
    state.requestSplit();
    await state.confirmSplit();
    assert.equal(state.canSplitClip(), false);
    assert.equal(splitCalls, 0);
    assert.equal(state.splitConfirmation(), false);
  } finally { TestBed.resetTestingModule(); }
});
