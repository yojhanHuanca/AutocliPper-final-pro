import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../src/app/features/editor/', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('the account editor persists a revision before requesting its real render', async () => {
  const [state, api, template] = await Promise.all([
    read('state/editor.state.ts'),
    read('data-access/editor-api.service.ts'),
    read('pages/editor.component.html'),
  ]);

  assert.match(state, /this\.api\.save\(this\.id,\s*\{ version: draft\.version, spec: this\.buildSpec\(\) \}/);
  assert.match(state, /await this\.saveRevision\(generation\)[\s\S]*?await this\.requestRender\(saved, generation\)/);
  assert.match(state, /this\.api\.render\(this\.id, draft\.version, this\.renderAttempt\.key\)/);
  assert.match(api, /`\/edits\/\$\{encodeURIComponent\(id\)\}\/renders`/);
  assert.match(template, /\(click\)="exportRevision\(\)"/);
});

test('clip splitting uses the saved draft and sharing requires a connected OAuth account', async () => {
  const [state, api, timeline, inspector, documentation] = await Promise.all([
    read('state/editor.state.ts'),
    read('data-access/editor-api.service.ts'),
    read('components/editor-timeline/editor-timeline.component.html'),
    read('components/editor-inspector/editor-inspector.component.html'),
    readFile(new URL('../../docs/editor-real-workbench.md', import.meta.url), 'utf8'),
  ]);

  assert.match(timeline, /\(click\)="vm\.requestSplit\(\)"/);
  assert.match(timeline, /vm\.confirmSplit\(\)/);
  assert.match(timeline, /vm\.canSplitClip\(\)/);
  assert.match(timeline, /No genera videos/);
  assert.match(state, /this\.api\.split\(draft\.id, cutSeconds, this\.etag, key\)/);
  assert.match(api, /`\/edits\/\$\{encodeURIComponent\(id\)\}\/split`/);
  for (const action of ['Duplicar', 'Eliminar']) {
    const match = timeline.match(new RegExp(`<button[^>]*disabled[^>]*>${action}`));
    assert.ok(match, `${action} must remain unavailable without an API route`);
  }
  assert.match(timeline, /YouTube y la bandeja de TikTok requieren una cuenta conectada por OAuth/);
  assert.match(inspector, /La API no ofrece mezcla, volumen ni mute para el audio de la fuente/);
  assert.match(inspector, /EditorSpecDto no incluye controles de color/);
  assert.match(documentation, /Guardar y exportar[\s\S]*?primero persiste la revisión/);
  assert.ok(documentation.includes('`POST /edits/:id/renders`'));
  assert.ok(documentation.includes('`POST /edits/:id/split`'));
});

test('the video-first editor uses cobalt accents and stacks its controls on narrow screens', async () => {
  const [editorCss, timelineCss, previewCss] = await Promise.all([
    read('pages/editor.component.css'),
    read('components/editor-timeline/editor-timeline.component.css'),
    read('components/editor-preview/editor-preview.component.css'),
  ]);

  assert.match(editorCss, /--accent:#2859b8/);
  assert.match(editorCss, /@media\(max-width:760px\)[\s\S]*grid-template-columns:minmax\(0,1fr\)[\s\S]*grid-template-rows:auto/);
  assert.match(editorCss, /editor-inspector-tools \{ display:grid; grid-template-columns:repeat\(auto-fit,minmax\(68px,1fr\)\)/);
  assert.match(editorCss, /@container editor-page \(max-width:1180px\) and \(min-width:761px\)/);
  assert.match(editorCss, /editor-heading>\.button-row \{ display:grid; grid-template-columns:repeat\(auto-fit,minmax\(126px,1fr\)\)/);
  assert.match(timelineCss, /\.selected-range \{ background:#2859b8/);
  assert.match(previewCss, /\.frame-anchor[^}]*background:#2859b8e6/);
});

test('the real editor mounts an icon-only tool rail with accessible names at desktop and mobile widths', async () => {
  const [editor, page, rail, styles] = await Promise.all([
    read('pages/editor.component.ts'),
    read('pages/editor.component.html'),
    read('components/editor-rail/editor-rail.component.html'),
    read('pages/editor.component.css'),
  ]);

  assert.match(editor, /EditorRailComponent/);
  assert.match(page, /<ac-editor-rail\s*\/>/);
  assert.match(rail, /aria-label="Herramientas del editor"/);
  assert.match(rail, /\[attr\.aria-label\]="item\.label"/);
  assert.match(rail, /\[title\]="item\.label"/);
  assert.doesNotMatch(rail, /<ac-icon \[name\]="item\.icon" \/>\s*\{\{\s*item\.label/);
  assert.match(page, /class="button primary editor-export-action"/);
  assert.match(styles, /grid-template-columns:58px minmax\(170px,205px\) minmax\(300px,1fr\) minmax\(245px,290px\)/);
  assert.match(styles, /@media\(max-width:760px\)[\s\S]*\.editor-layout \.editor-rail \{ flex-direction:row/);
});
