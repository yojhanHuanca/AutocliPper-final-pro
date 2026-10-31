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
  assert.match(template, /vm\.dirty\(\) \? vm\.saveAndRender\(\) : vm\.render\(\)/);
});

test('unsupported timeline operations and publishing stay disabled with contract explanations', async () => {
  const [timeline, inspector, documentation] = await Promise.all([
    read('components/editor-timeline/editor-timeline.component.html'),
    read('components/editor-inspector/editor-inspector.component.html'),
    readFile(new URL('../../docs/editor-real-workbench.md', import.meta.url), 'utf8'),
  ]);

  for (const action of ['Dividir clip', 'Duplicar', 'Eliminar']) {
    const match = timeline.match(new RegExp(`<button[^>]*disabled[^>]*>${action}`));
    assert.ok(match, `${action} must remain unavailable without an API route`);
  }
  assert.match(timeline, /no está disponible: el servidor no ofrece una operación de publicación/);
  assert.match(inspector, /La API no ofrece mezcla, volumen ni mute para el audio de la fuente/);
  assert.match(inspector, /EditorSpecDto no incluye controles de color/);
  assert.match(documentation, /Guardar y exportar[\s\S]*?primero persiste la revisión/);
  assert.ok(documentation.includes('`POST /edits/:id/renders`'));
});

test('the video-first editor uses cobalt accents and stacks its controls on narrow screens', async () => {
  const [editorCss, timelineCss, previewCss] = await Promise.all([
    read('pages/editor.component.css'),
    read('components/editor-timeline/editor-timeline.component.css'),
    read('components/editor-preview/editor-preview.component.css'),
  ]);

  assert.match(editorCss, /--accent:#2859b8/);
  assert.match(editorCss, /@media\(max-width:760px\)[\s\S]*grid-template-columns:minmax\(0,1fr\)[\s\S]*grid-template-rows:auto/);
  assert.match(timelineCss, /\.selected-range \{ background:#2859b8/);
  assert.match(previewCss, /\.frame-anchor[^}]*background:#2859b8e6/);
});
