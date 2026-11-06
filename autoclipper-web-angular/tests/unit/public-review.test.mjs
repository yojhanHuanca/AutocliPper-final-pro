import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { CollaborationApi, HttpErrorResponse, PublicReviewComponent } from '../../.local/tests/client.mjs';
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

test('public comment pages deduplicate rows and stop a repeated cursor without losing authorized content',async()=>{
  const comment=id=>({id,revisionVersion:4,timeSeconds:3,text:id,version:1,createdAt:'2026-01-01T00:00:00Z',deletedAt:null});
  const state=Object.create(PublicReviewComponent.prototype);
  const current={name:'Clip de prueba',revisionVersion:4,status:'review',spec:{version:1,kind:'clip',startSeconds:0,endSeconds:12,aspect:'vertical'},videoEnabled:true,expiresAt:'2099-01-01T00:00:00Z',comments:{items:[comment('comment-1')],nextBeforeId:'cursor-one'}};
  Object.assign(state,{token:'share-token',generation:1,seenCommentCursors:new Set(),api:{publicReview:async()=>({ ...current,comments:{items:[comment('comment-1'),comment('comment-2')],nextBeforeId:'cursor-one'} })}});
  for(const [key,value] of Object.entries({review:current,nextBeforeId:'cursor-one',videoUrl:'https://cdn.example.test/video.mp4',videoExpiresIn:120,busy:false,error:'',videoError:''}))state[key]=signal(value);
  await state.load('cursor-one');
  assert.deepEqual(state.review().comments.items.map(item=>item.id),['comment-1','comment-2']);
  assert.equal(state.nextBeforeId(),null);
  assert.match(state.error(),/cursor repetido/);
  assert.equal(state.videoUrl(),'https://cdn.example.test/video.mp4','Paging comments keeps the authorized media grant.');
});

test('a failed public comment page can be retried with the same cursor',async()=>{
  let calls=0;
  const state=Object.create(PublicReviewComponent.prototype);
  const current={name:'Clip',revisionVersion:1,status:'review',spec:{version:1,kind:'clip',startSeconds:0,endSeconds:2,aspect:'vertical'},videoEnabled:false,expiresAt:'2099-01-01T00:00:00Z',comments:{items:[],nextBeforeId:'cursor-one'}};
  Object.assign(state,{token:'share-token',generation:1,seenCommentCursors:new Set(),api:{publicReview:async()=>{if(++calls===1)throw new HttpErrorResponse({status:503});return {...current,comments:{items:[{id:'comment-1',revisionVersion:1,timeSeconds:1,text:'Listo',version:1,createdAt:'2026-01-01T00:00:00Z',deletedAt:null}],nextBeforeId:null}};}}});
  for(const [key,value] of Object.entries({review:current,nextBeforeId:'cursor-one',videoUrl:'',videoExpiresIn:null,busy:false,error:'',videoError:''}))state[key]=signal(value);
  await state.load('cursor-one');
  assert.match(state.error(),/No se pudo conectar/);
  assert.equal(state.nextBeforeId(),'cursor-one');
  await state.load('cursor-one');
  assert.equal(calls,2);
  assert.equal(state.review().comments.items[0].text,'Listo');
  assert.equal(state.nextBeforeId(),null);
});

test('shared review video playback does not request cross-origin access to signed media',async()=>{
  const html=await readFile(new URL('../../src/app/features/collaboration/pages/public-review.component.html',import.meta.url),'utf8');
  const video=html.match(/<video[^>]*>/)?.[0];
  assert.ok(video);
  assert.match(video,/controls/);
  assert.match(video,/\[src\]="videoUrl\(\)"/);
  assert.doesNotMatch(video,/crossorigin/i);
});

test('a public review with an invalid expiry is treated as expired and cannot request video access', async () => {
  let videoRequests = 0;
  const state = Object.create(PublicReviewComponent.prototype);
  const review = {
    name: 'Clip', revisionVersion: 1, status: 'review',
    spec: { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 2, aspect: 'vertical' },
    videoEnabled: true, expiresAt: 'not-a-date', comments: { items: [], nextBeforeId: null },
  };
  Object.assign(state, { token: 'share-token', generation: 1, api: { publicVideo: async () => { videoRequests++; return { url: 'https://cdn.example.test/video.mp4', contentType: 'video/mp4', expiresInSeconds: 120 }; } } });
  for (const [key, value] of Object.entries({ review, videoError: '', loadingVideo: false, videoUrl: '', videoExpiresIn: null })) state[key] = signal(value);

  assert.equal(state.isExpired(), true);
  assert.equal(state.canLoadVideo(), false);
  await state.loadVideo();
  assert.equal(videoRequests, 0);
  assert.match(state.videoError(), /vigencia válida/);
});

test('a public video grant rejects media URLs that embed credentials', async () => {
  const state = Object.create(PublicReviewComponent.prototype);
  const review = {
    name: 'Clip', revisionVersion: 1, status: 'review',
    spec: { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 2, aspect: 'vertical' },
    videoEnabled: true, expiresAt: '2099-01-01T00:00:00Z', comments: { items: [], nextBeforeId: null },
  };
  Object.assign(state, {
    token: 'share-token', generation: 1, videoGeneration: 0,
    api: { publicVideo: async () => ({ url: 'https://user:secret@cdn.example.test/video.mp4', contentType: 'video/mp4', expiresInSeconds: 120 }) },
  });
  for (const [key, value] of Object.entries({
    review, videoError: '', loadingVideo: false, videoUrl: '', videoExpiresIn: null, expiryCheck: signal(0),
  })) state[key] = signal(value);

  await state.loadVideo();
  assert.equal(state.videoUrl(), '');
  assert.match(state.videoError(), /permiso de video válido/);
});

test('a revoked review link clears previously authorized comments and video access', async () => {
  const params = new BehaviorSubject(new Map());
  const review = {
    name: 'Clip de prueba', revisionVersion: 4, status: 'review',
    spec: { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 12, aspect: 'vertical' },
    videoEnabled: true, expiresAt: '2099-01-01T00:00:00Z',
    comments: { items: [{ id: 'comment-1', revisionVersion: 4, timeSeconds: 3, text: 'Observación autorizada', version: 1, createdAt: '2026-01-01T00:00:00Z', deletedAt: null }], nextBeforeId: 'cursor-1' },
  };
  const api = { publicReview: async (_token, beforeId) => {
    if (beforeId) throw new HttpErrorResponse({ status: 410 });
    return review;
  } };
  TestBed.configureTestingModule({ providers: [
    { provide: CollaborationApi, useValue: api },
    { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
    { provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } },
  ] });
  try {
    const page = TestBed.runInInjectionContext(() => new PublicReviewComponent());
    params.next(new Map([['token', 'one-time-token']]));
    for (let attempt = 0; attempt < 20 && page.busy(); attempt++) await new Promise(resolve => setImmediate(resolve));
    page.videoUrl.set('https://cdn.example.test/authorized-video.mp4');
    page.videoExpiresIn.set(120);
    await page.load('cursor-1');
    assert.equal(page.review(), null);
    assert.equal(page.nextBeforeId(), null);
    assert.equal(page.videoUrl(), '');
    assert.equal(page.videoExpiresIn(), null);
    assert.match(page.error(), /enlace no está disponible/);
  } finally { TestBed.resetTestingModule(); }
});

test('revoking the link while renewing video permission also clears review text and comments', async () => {
  const params = new BehaviorSubject(new Map());
  const review = {
    name: 'Clip de prueba', revisionVersion: 4, status: 'review',
    spec: { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 12, aspect: 'vertical' },
    videoEnabled: true, expiresAt: '2099-01-01T00:00:00Z',
    comments: { items: [{ id: 'comment-1', revisionVersion: 4, timeSeconds: 3, text: 'Observación autorizada', version: 1, createdAt: '2026-01-01T00:00:00Z', deletedAt: null }], nextBeforeId: 'cursor-1' },
  };
  const api = {
    publicReview: async () => review,
    publicVideo: async () => { throw new HttpErrorResponse({ status: 410 }); },
  };
  TestBed.configureTestingModule({ providers: [
    { provide: CollaborationApi, useValue: api },
    { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
    { provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } },
  ] });
  try {
    const page = TestBed.runInInjectionContext(() => new PublicReviewComponent());
    params.next(new Map([['token', 'one-time-token']]));
    for (let attempt = 0; attempt < 20 && page.busy(); attempt++) await new Promise(resolve => setImmediate(resolve));
    page.videoUrl.set('https://cdn.example.test/authorized-video.mp4');
    page.videoExpiresIn.set(120);
    await page.loadVideo();
    assert.equal(page.review(), null);
    assert.equal(page.nextBeforeId(), null);
    assert.equal(page.videoUrl(), '');
    assert.equal(page.videoExpiresIn(), null);
    assert.match(page.error(), /enlace no está disponible/);
  } finally { TestBed.resetTestingModule(); }
});

test('a late video grant is discarded when a refreshed review removes video permission', async () => {
  let resolveVideo;
  const pendingVideo = new Promise(resolve => { resolveVideo = resolve; });
  const review = (videoEnabled) => ({
    name: 'Clip', revisionVersion: 2, status: 'review',
    spec: { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 2, aspect: 'vertical' },
    videoEnabled, expiresAt: '2099-01-01T00:00:00Z', comments: { items: [], nextBeforeId: null },
  });
  const state = Object.create(PublicReviewComponent.prototype);
  Object.assign(state, {
    token: 'share-token', generation: 1, videoGeneration: 0, expiryTimer: null,
    videoGrantExpiresAt: null, seenCommentCursors: new Set(),
    api: { publicVideo: async () => pendingVideo, publicReview: async () => review(false) },
  });
  for (const [key, value] of Object.entries({
    review: review(true), nextBeforeId: null, videoUrl: '', videoExpiresIn: null,
    busy: false, loadingVideo: false, error: '', videoError: '', expiryCheck: 0,
  })) state[key] = signal(value);

  const videoRequest = state.loadVideo();
  assert.equal(state.loadingVideo(), true);
  await state.load();
  assert.equal(state.review().videoEnabled, false);
  assert.equal(state.loadingVideo(), false);
  resolveVideo({ url: 'https://cdn.example.test/video.mp4', contentType: 'video/mp4', expiresInSeconds: 120 });
  await videoRequest;

  assert.equal(state.videoUrl(), '');
  assert.equal(state.videoExpiresIn(), null);
  assert.equal(state.loadingVideo(), false);
  state.clearExpiryTimer();
});

test('shared video URL and visible grant clear when the short media permission expires', async () => {
  const state = Object.create(PublicReviewComponent.prototype);
  const review = {
    name: 'Clip', revisionVersion: 1, status: 'review',
    spec: { version: 1, kind: 'clip', startSeconds: 0, endSeconds: 2, aspect: 'vertical' },
    videoEnabled: true, expiresAt: '2099-01-01T00:00:00Z', comments: { items: [], nextBeforeId: null },
  };
  Object.assign(state, {
    review: signal(review), videoUrl: signal('https://cdn.example.test/video.mp4'),
    videoExpiresIn: signal(1), videoError: signal(''), expiryCheck: signal(0),
    videoGeneration: 0, videoGrantExpiresAt: Date.now() - 1, expiryTimer: null,
  });
  state.scheduleExpiryCheck();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.videoUrl(), '');
  assert.equal(state.videoExpiresIn(), null);
  assert.match(state.videoError(), /permiso temporal de video venció/);
  state.clearExpiryTimer();
});
