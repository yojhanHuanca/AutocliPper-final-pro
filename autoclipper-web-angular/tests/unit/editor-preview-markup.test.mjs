import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('signed editor video previews use native playback without requiring cross-origin pixel access', async () => {
  const template = await readFile(new URL('../../src/app/features/editor/components/editor-preview/editor-preview.component.html', import.meta.url), 'utf8');
  const video = template.match(/<video[\s\S]*?#renderVideo[\s\S]*?<\/video>/)?.[0];
  assert.ok(video, 'The authorized preview player remains present.');
  assert.match(video, /controls/);
  assert.match(video, /preload="metadata"/);
  assert.match(video, /\[src\]="session\.url"/);
  assert.doesNotMatch(video, /crossorigin|crossOrigin/i, 'The player does not require a CORS policy from signed media storage to play and read duration/time.');
  assert.match(video, /\(loadedmetadata\)=/);
  assert.match(video, /\(timeupdate\)=/);
  assert.match(video, /\(error\)=/);
  const sourceVideo = template.match(/<video[^>]*#sourceVideo[\s\S]*?<\/video>/)?.[0];
  assert.ok(sourceVideo, 'The authorized source player remains present.');
  assert.match(sourceVideo, /\[style\.object-position\]=/);
  assert.match(template, /source-preview-canvas/);
  assert.match(template, /sourceCaptionAtPlayhead\(\)/);
});

test('a real saved draft opens the video-first workbench with its existing edit and export controls', async () => {
  const template = await readFile(new URL('../../src/app/features/editor/pages/editor.component.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../src/app/features/editor/pages/editor.component.css', import.meta.url), 'utf8');
  const previewCss = await readFile(new URL('../../src/app/features/editor/components/editor-preview/editor-preview.component.css', import.meta.url), 'utf8');
  const timelineCss = await readFile(new URL('../../src/app/features/editor/components/editor-timeline/editor-timeline.component.css', import.meta.url), 'utf8');
  const globalCss = await readFile(new URL('../../src/styles.css', import.meta.url), 'utf8');

  assert.match(template, /@if \(vm\.draft\(\)\) \{[\s\S]*?class="editor-layout"[\s\S]*?<ac-editor-rail \/>[\s\S]*?<ac-editor-preview \/>[\s\S]*?<ac-editor-inspector \/>[\s\S]*?<ac-editor-timeline \/>/);
  assert.match(template, /Guardar y exportar/);
  assert.match(template, /exportRevision\(\)/);
  assert.match(css, /\.editor-layout \.editor-timeline \{[^}]*border-radius:12px;/);
  assert.match(css, /grid-template-columns:58px minmax\(170px,205px\) minmax\(300px,1fr\) minmax\(245px,290px\)/,
    'The desktop editor grid reserves space for the icon rail, clip list, preview and inspector.');
  assert.match(css, /\.editor-layout > ac-editor-rail \{ grid-column:1; grid-row:1; \}/);
  assert.match(css, /\.editor-layout > ac-editor-preview \{ grid-column:3; grid-row:1;/);
  assert.match(css, /\.editor-layout > ac-editor-inspector \{ grid-column:4; grid-row:1;/);
  assert.match(css, /\.editor-layout \{[^}]*grid-template-rows:auto auto; align-content:start;[^}]*\}/);
  assert.match(previewCss, /\.editor-stage\s*\{[^}]*height:\s*auto;\s*min-height:\s*640px;\s*overflow:\s*visible;/);
  assert.match(previewCss, /ac-editor-preview\s*\{[^}]*height:\s*auto;/);
  assert.doesNotMatch(timelineCss, /\.editor-timeline\s*\{\s*height:\s*100%;\s*overflow:\s*auto;/,
    'The full editor document can scroll instead of trapping the timeline inside a fixed-height panel.');
  assert.match(globalCss, /\.app-body:has\(ac-editor\):not\(:has\(\.demo-editor\)\) \.app-main \{ height: auto;[^}]*overflow: visible; \}/,
    'The real editor does not inherit the desktop shell viewport lock that clipped its timeline.');
});
