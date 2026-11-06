import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the editor empty workspace shows no synthetic clips or media and directs users to real projects', async () => {
  const [css, template, component] = await Promise.all([
    readFile(new URL('../../src/app/features/editor/pages/editor.component.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/app/features/editor/pages/editor.component.html', import.meta.url), 'utf8'),
    readFile(new URL('../../src/app/features/editor/pages/editor.component.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(template, /class="editor-layout editor-empty-workspace"/);
  assert.match(template, /Clips del proyecto/);
  assert.match(template, /Tu video aparecerá aquí/);
  assert.match(template, /class="editor-empty-timeline-tracks"/);
  assert.match(template, /role="tablist" aria-label="Herramientas del clip"/);
  for (const tool of ['Recorte', 'Texto', 'Formato', 'Subtítulos', 'Audio', 'Color']) assert.match(template, new RegExp(`>${tool}<\\/button>`));
  assert.match(template, /\[routerLink\]="vm\.design \? '\/design\/projects' : '\/app\/projects'"/);
  assert.doesNotMatch(template, /ac-editor-demo|editor-demo\.mp4|MP4 sintético|Proyecto de muestra/);
  assert.doesNotMatch(component, /EditorDemoComponent/);
  assert.match(css, /\.editor-empty-workspace[\s\S]*?\.editor-empty-timeline-tracks/);
});
