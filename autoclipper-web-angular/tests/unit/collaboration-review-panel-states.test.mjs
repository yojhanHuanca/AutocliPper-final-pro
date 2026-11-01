import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { CollaborationApi, EditorState, ReviewPanelComponent, SessionStore } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const renderer = { insertRootElement() {}, removeAllRootElements() {} };
const editId = 'edit-current';
const reviewLink = {
  id: 'link-1', revisionVersion: 4, expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-10-31T00:00:00.000Z', revokedAt: null,
};
const comment = {
  id: 'comment-1', authorId: 'reader-1', deletedAt: null, version: 2, timeSeconds: 3,
};

function setup({ vm: overrides = {}, api: apiOverrides = {}, role = 'editor' } = {}) {
  const currentEditId = signal(editId);
  const vm = {
    get id() { return currentEditId(); },
    canEditCollaboration: () => ['owner', 'admin', 'editor'].includes(role),
    canAdminCollaboration: () => ['owner', 'admin'].includes(role),
    collaborationRole: () => role,
    review: signal({ status: 'review', version: 4 }),
    comments: signal([comment]),
    loadNotice: signal(''),
    busy: signal(false),
    dirty: () => false,
    design: false,
    message: signal(''),
    error: signal(''),
    replyTarget: signal(null),
    clearReply() {},
    loadReview: async () => {},
    loadComments: async () => {},
    deleteComment: async () => { vm.message.set('Comentario retirado.'); },
    approve: async () => { vm.message.set('Revisión aprobada.'); },
    returnReview: async () => { vm.message.set('La revisión volvió al editor.'); },
    ...overrides,
  };
  const calls = [];
  const api = {
    links: async id => { calls.push(['links', id]); return { items: [reviewLink] }; },
    audit: async id => { calls.push(['audit', id]); return { items: [], nextBeforeId: null }; },
    revokeLink: async (id, linkId) => { calls.push(['revoke', id, linkId]); },
    ...apiOverrides,
  };
  TestBed.configureTestingModule({ providers: [
    { provide: EditorState, useValue: vm },
    { provide: SessionStore, useValue: { user: () => ({ id: 'reader-1' }) } },
    { provide: CollaborationApi, useValue: api },
    { provide: TestComponentRenderer, useValue: renderer },
  ] });
  const panel = TestBed.runInInjectionContext(() => new ReviewPanelComponent());
  return { panel, vm, api, calls, currentEditId };
}

test('a review-link revoke requires the confirmed, currently listed link and updates status after server success', async () => {
  const { panel, calls } = setup();
  await panel.loadLinks();

  await panel.revoke(reviewLink);
  assert.equal(calls.some(call => call[0] === 'revoke'), false);
  assert.equal(panel.linkStatus(reviewLink), 'Activo');

  panel.requestLinkRevocation(reviewLink);
  await panel.revoke(reviewLink);
  assert.deepEqual(calls.find(call => call[0] === 'revoke'), ['revoke', editId, reviewLink.id]);
  assert.equal(panel.linkStatus(reviewLink), 'Revocado');
  assert.equal(panel.pendingLinkRevocation(), '');
  TestBed.resetTestingModule();
});

test('a denied review-link refresh clears private rows instead of presenting them as current', async () => {
  const { panel } = setup({ api: { links: async () => { throw new HttpErrorResponse({ status: 403 }); } } });
  panel.links.set([reviewLink]);
  panel.linksLoaded.set(true);
  await panel.loadLinks();

  assert.deepEqual(panel.links(), []);
  assert.equal(panel.linksLoaded(), false);
  assert.ok(panel.linksError());
  TestBed.resetTestingModule();
});

test('a pending link-list response from a previous edit cannot replace the current collaboration list', async () => {
  let resolve;
  const result = new Promise(done => resolve = done);
  const { panel, currentEditId } = setup({ api: { links: () => result } });
  const request = panel.loadLinks();
  currentEditId.set('edit-next');
  resolve({ items: [reviewLink] });
  await request;

  assert.deepEqual(panel.links(), []);
  TestBed.resetTestingModule();
});

test('comment removal and review decisions wait for explicit confirmation', async () => {
  const { panel, vm } = setup({ role: 'admin' });
  panel.requestCommentRemoval(comment);
  assert.equal(vm.message(), '');
  await panel.confirmCommentRemoval(comment);
  assert.equal(vm.message(), 'Comentario retirado.');
  assert.equal(panel.pendingCommentRemoval(), '');

  panel.requestDecision('approve');
  assert.equal(vm.message(), 'Comentario retirado.');
  await panel.confirmDecision();
  assert.equal(vm.message(), 'Revisión aprobada.');
  assert.equal(panel.pendingDecision(), null);
  TestBed.resetTestingModule();
});

test('read-only members cannot request comment removal or review decisions', () => {
  const { panel, vm } = setup({ role: 'reader' });
  panel.requestCommentRemoval(comment);
  panel.requestDecision('approve');
  assert.equal(panel.pendingCommentRemoval(), '');
  assert.equal(panel.pendingDecision(), null);
  assert.equal(vm.message(), '');
  TestBed.resetTestingModule();
});
