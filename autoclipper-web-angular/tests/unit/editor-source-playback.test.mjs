import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@angular/compiler';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ApiTransport, EditorApi, EditorPreviewComponent } from '../../.local/tests/client.mjs';
import { signal } from '@angular/core';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('source playback requests the private source endpoint with an encoded upload id', async () => {
  const calls = [];
  const transport = { get: async path => { calls.push(path); return { url: 'https://media.example.test/private', expiresInSeconds: 120, contentType: 'video/mp4', bytes: 64, sha256: 'a'.repeat(64) }; } };
  TestBed.configureTestingModule({ providers: [EditorApi, { provide: ApiTransport, useValue: transport }, { provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } }] });
  try {
    const api = TestBed.inject(EditorApi);
    const response = await api.sourcePlayback('upload/id');
    assert.deepEqual(calls, ['/uploads/upload%2Fid/source-playback']);
    assert.equal(response.expiresInSeconds, 120);
  } finally { TestBed.resetTestingModule(); }
});

test('the real editor uses the render first and the authorized original as a clearly labeled fallback', async () => {
  const template = await readFile(new URL('../../src/app/features/editor/components/editor-preview/editor-preview.component.html', import.meta.url), 'utf8');
  const sourceSection = template.match(/class="source-playback"[\s\S]*?<\/section>/)?.[0];
  assert.ok(sourceSection);
  assert.match(sourceSection, /vm\.requestSourcePlayback\(\)/);
  assert.match(sourceSection, /toggleSelectionPlayback\(source\.token\)/);
  assert.match(sourceSection, /Reproducir selección/);
  assert.match(template, /@if \(vm\.previewSession\(\); as session\)/);
  assert.match(template, /@else if \(vm\.sourcePlaybackSession\(\); as source\)/);
  assert.match(template, /class="source-stage-video" controls preload="metadata" playsinline \[src\]="source\.url"/);
  assert.match(template, /sourcePlaybackFailed\(source\.token\)/);
  assert.match(template, /sourceTimeUpdate\(source\.token, sourceVideo\)/);
  assert.match(template, /PREVIA DEL ENCUADRE · EL CORTE FINAL SE GENERA AL EXPORTAR/);
  assert.match(template, /La vista previa aplica el formato, el encuadre y los subtítulos al video original/);
  assert.match(template, /pantalla dividida se confirman al exportar/);
  assert.match(template, /Exportación del servidor/);
  assert.match(template, /sourceCaptionAtPlayhead\(\)/);
});

test('the selection preview seeks to the saved start and stops at the saved end', async () => {
  const updates = [];
  const video = {
    currentTime: 8,
    paused: true,
    async play() { this.paused = false; },
    pause() { this.paused = true; },
  };
  const vm = {
    clipRangeUsable: () => true,
    sourcePlaybackSession: () => ({ token: 9 }),
    spec: { startSeconds: 2, endSeconds: 5 },
    sourceTimeChanged: (token, seconds) => updates.push([token, seconds]),
    sourcePlaybackFailed: () => assert.fail('A successful local video play must not fail the session.'),
  };
  const component = Object.create(EditorPreviewComponent.prototype);
  Object.assign(component, { vm, playingSelection: signal(false), sourceVideo: () => ({ nativeElement: video }) });

  await component.toggleSelectionPlayback(9);
  assert.equal(video.currentTime, 2);
  assert.equal(component.playingSelection(), true);
  video.currentTime = 5.2;
  component.sourceTimeUpdate(9, video);
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 5);
  assert.equal(component.playingSelection(), false);
  assert.deepEqual(updates.at(-1), [9, 5]);

  await component.toggleSelectionPlayback(9);
  assert.equal(video.currentTime, 2, 'Replaying after the selected end starts from the current saved start.');
  assert.equal(component.playingSelection(), true);
  await component.toggleSelectionPlayback(9);
  assert.equal(video.paused, true);
  assert.equal(component.playingSelection(), false);
});

test('the frame anchor updates the saved framing point by drag and keyboard', () => {
  let saves = 0;
  const vm = { canChangeCaptions: () => true, spec: { aspect: 'vertical' }, cropX: 0.5, cropY: 0.5, touchForm: () => saves++, beginFormGesture() {}, endFormGesture() {} };
  const component = Object.create(EditorPreviewComponent.prototype);
  Object.assign(component, { vm, draggingFrame: signal(false), framePointerOffsetX: 0, framePointerOffsetY: 0 });
  const handle = { getBoundingClientRect: () => ({ left: 190, top: 190, width: 20, height: 20 }), setPointerCapture() {} };
  const canvas = { getBoundingClientRect: () => ({ left: 100, top: 100, width: 200, height: 400 }) };

  component.startFrameDrag({ button: 0, currentTarget: handle, pointerId: 1, clientX: 195, clientY: 195, preventDefault() {} }, canvas);
  component.moveFrameDrag({ clientX: 195, clientY: 295 }, canvas);
  component.endFrameDrag();
  assert.equal(vm.cropX, 0.5);
  assert.equal(vm.cropY, 0.5);
  assert.equal(saves, 0, 'A drag ending at the same anchor does not create a dirty form change.');

  component.startFrameDrag({ button: 0, currentTarget: handle, pointerId: 2, clientX: 195, clientY: 195, preventDefault() {} }, canvas);
  component.moveFrameDrag({ clientX: 235, clientY: 375 }, canvas);
  assert.equal(vm.cropX, 0.7);
  assert.equal(vm.cropY, 0.7);
  component.endFrameDrag();
  component.frameAnchorKeydown({ key: 'ArrowLeft', shiftKey: true, preventDefault() {} });
  assert.equal(vm.cropX, 0.65);
  component.frameAnchorKeydown({ key: 'Home', shiftKey: false, preventDefault() {} });
  assert.equal(vm.cropX, 0.5);
  assert.equal(vm.cropY, 0.5);
  assert.equal(saves, 3);
});
