import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { CollaborationApi, SessionStore } from '../../.local/tests/client.mjs';
import { ReviewPanelComponent, EditorState } from '../../.local/tests/client.mjs';
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('video review-link choices include only completed videos for the current revision', () => {
  const vm = {
    draft: () => ({ revision: { id: 'revision-current' } }),
    exports: () => [
      { id: 'current-video', editorRevisionId: 'revision-current', status: 'succeeded', artifacts: [{ kind: 'video' }] },
      { id: 'old-video', editorRevisionId: 'revision-old', status: 'succeeded', artifacts: [{ kind: 'video' }] },
      { id: 'current-failed', editorRevisionId: 'revision-current', status: 'failed', artifacts: [{ kind: 'video' }] },
      { id: 'current-captions', editorRevisionId: 'revision-current', status: 'succeeded', artifacts: [{ kind: 'srt' }] },
    ],
    canEditCollaboration: () => false,
    canAdminCollaboration: () => false,
    design: false,
  };
  TestBed.configureTestingModule({ providers: [
    { provide: EditorState, useValue: vm },
    { provide: SessionStore, useValue: { user: () => ({ id: 'reader-1' }) } },
    { provide: CollaborationApi, useValue: {} },
    { provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } },
  ] });
  try {
    const panel = TestBed.runInInjectionContext(() => new ReviewPanelComponent());
    assert.deepEqual(panel.videoExports().map(item => item.id), ['current-video']);
    panel.selectView('links');
    assert.equal(panel.view(), 'team', 'Readers must not navigate into editor-only link controls.');
    panel.selectView('activity');
    assert.equal(panel.view(), 'team', 'Non-admin members must not navigate into admin audit controls.');
  } finally { TestBed.resetTestingModule(); }
});
