import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { CollaborationApi, PublicReviewComponent } from '../../.local/tests/client.mjs';
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('paging public comments preserves the currently authorized video grant', async () => {
  const params = new BehaviorSubject(new Map());
  const api = { publicReview: async () => ({
    name: 'Clip de prueba', revisionVersion: 4, status: 'review',
    spec: { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 12, aspect: 'vertical' },
    videoEnabled: true, expiresAt: '2099-01-01T00:00:00Z',
    comments: { items: [{ id: 'comment-2', revisionVersion: 4, timeSeconds: 7, text: 'Siguiente página', version: 1, createdAt: '2026-01-01T00:00:00Z', deletedAt: null }], nextBeforeId: null },
  }) };
  TestBed.configureTestingModule({ providers: [
    { provide: CollaborationApi, useValue: api },
    { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
    { provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } },
  ] });
  try {
    const page = TestBed.runInInjectionContext(() => new PublicReviewComponent());
    params.next(new Map([['token', 'one-time-token']]));
    for (let attempt = 0; attempt < 20 && page.busy(); attempt++) await new Promise(resolve => setImmediate(resolve));
    page.review.set({
      name: 'Clip de prueba', revisionVersion: 4, status: 'review',
      spec: { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 12, aspect: 'vertical' },
      videoEnabled: true, expiresAt: '2099-01-01T00:00:00Z',
      comments: { items: [], nextBeforeId: 'comment-1' },
    });
    page.videoUrl.set('https://cdn.example.test/authorized-video.mp4');
    page.videoExpiresIn.set(120);
    await page.load('comment-1');
    assert.equal(page.videoUrl(), 'https://cdn.example.test/authorized-video.mp4');
    assert.equal(page.videoExpiresIn(), 120);
    assert.equal(page.review().comments.items[0].id, 'comment-2');
  } finally { TestBed.resetTestingModule(); }
});
