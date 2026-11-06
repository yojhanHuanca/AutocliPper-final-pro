import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = relative => readFile(new URL(relative, import.meta.url), 'utf8');

test('the editor route has no synthetic project and dashboard drafts use account-backed editor routes', async () => {
  const [editor, component, landing, dashboard, routes] = await Promise.all([
    source('../../src/app/features/editor/pages/editor.component.html'),
    source('../../src/app/features/editor/pages/editor.component.ts'),
    source('../../src/app/features/landing/pages/landing.component.html'),
    source('../../src/app/features/dashboard/pages/dashboard.component.ts'),
    source('../../src/app/app.routes.ts'),
  ]);
  assert.doesNotMatch(editor, /ac-editor-demo|MP4 sintético|Proyecto de muestra|demo visual/);
  assert.doesNotMatch(component, /EditorDemoComponent/);
  assert.match(editor, /class="editor-layout editor-empty-workspace"[\s\S]*?\[routerLink\]="vm\.design \? '\/design\/projects' : '\/app\/projects'"/);
  assert.match(landing, /Ver el editor/);
  assert.match(dashboard, /return this\.design \? \["\/app\/projects"\] : \["\/app\/edits", draftId\]/);
  assert.match(routes, /path: "app"[\s\S]*?path: "edits"[\s\S]*?path: "design"[\s\S]*?path: "editor"/);
});

test('opening the real editor without a draft stays in a useful empty state and never requests an empty ID', async () => {
  const [state, editor] = await Promise.all([
    source('../../src/app/features/editor/state/editor.state.ts'),
    source('../../src/app/features/editor/pages/editor.component.html'),
  ]);
  assert.match(state, /if \(!this\.design && this\.id\) void this\.reload\(\)/);
  assert.match(state, /async reload\(\): Promise<void> \{\s*if \(!this\.id\) \{/);
  assert.match(editor, /class="editor-layout editor-empty-workspace"/);
  assert.match(editor, /Tu video aparecerá aquí/);
  assert.match(editor, /Elegir proyecto/);
  assert.match(editor, /\[routerLink\]="vm\.design \? '\/design\/projects' : '\/app\/projects'"/);
});

test('the real editor uses a project clip list, video preview, API-backed inspector and honest unavailable tools', async () => {
  const [editor, inspector, timeline] = await Promise.all([
    source('../../src/app/features/editor/pages/editor.component.html'),
    source('../../src/app/features/editor/components/editor-inspector/editor-inspector.component.html'),
    source('../../src/app/features/editor/components/editor-timeline/editor-timeline.component.html'),
  ]);
  assert.match(editor, /class="editor-clip-list"/);
  assert.match(editor, /<ac-editor-preview \/>[\s\S]*?<ac-editor-inspector \/>[\s\S]*?<ac-editor-timeline \/>/);
  assert.match(editor, /@if \(vm\.draft\(\)\) \{[\s\S]*?<div class="editor-layout">\s*<ac-editor-rail \/>/,
    'The icon rail belongs to an opened draft, not to the empty editor route.');
  for (const tool of ['Recorte', 'Subtítulos', 'Formato', 'Audio', 'Color']) assert.ok(inspector.includes(`>${tool}</button>`));
  assert.match(inspector, /Audio<\/button>/);
  assert.match(inspector, /Color<\/button>/);
  assert.match(inspector, /disabled title="La API no ofrece mezcla/);
  assert.match(inspector, /disabled title="EditorSpecDto no incluye controles de color/);
  assert.match(timeline, /Dividir crea dos borradores persistidos/);
  assert.match(timeline, /Duplicar/);
  assert.match(timeline, /Eliminar/);
  assert.match(timeline, /YouTube y la bandeja de TikTok requieren una cuenta conectada por OAuth/);
  assert.match(timeline, /role="slider" aria-label="Inicio del recorte"/);
  assert.match(timeline, /role="slider" aria-label="Final del recorte"/);
  assert.match(timeline, /startRangeDrag\(\$event, 'start'/);
  assert.match(timeline, /rangeHandleKeydown\(\$event, 'end'/);
  assert.match(timeline, /class="selected-range" role="group" tabindex="0"/);
  assert.match(timeline, /startSelectionDrag\(\$event\)/);
  assert.match(timeline, /moveSelectionKeydown\(\$event\)/);
});
