import { readFileSync } from 'node:fs';
import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { EditorInspectorComponent } from '../../.local/tests/client.mjs';

const template = readFileSync(new URL('../../src/app/features/editor/components/editor-inspector/editor-inspector.component.html', import.meta.url), 'utf8');

test('editor inspector tabs use roving focus and wrap with arrow, Home and End keys', () => {
  const component = Object.create(EditorInspectorComponent.prototype);
  component.vm = { tab: signal('composition') };
  const oldDocument = globalThis.document;
  const oldAnimationFrame = globalThis.requestAnimationFrame;
  const focused = [];
  const prevented = [];
  globalThis.document = { getElementById: id => ({ focus: () => focused.push(id) }) };
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  try {
    const press = key => component.onToolTabKeydown({ key, preventDefault: () => prevented.push(key) });
    press('ArrowLeft');
    assert.equal(component.vm.tab(), 'format');
    press('ArrowRight');
    assert.equal(component.vm.tab(), 'composition');
    press('End');
    assert.equal(component.vm.tab(), 'format');
    press('Home');
    assert.equal(component.vm.tab(), 'composition');
    press('Enter');
    assert.deepEqual(prevented, ['ArrowLeft', 'ArrowRight', 'End', 'Home']);
    assert.deepEqual(focused, [
      'editor-inspector-tab-format',
      'editor-inspector-tab-composition',
      'editor-inspector-tab-format',
      'editor-inspector-tab-composition',
    ]);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = oldAnimationFrame;
  }
});

test('editor inspector associates each active tool tab with its panel and omits tab semantics for other sections', () => {
  const component = Object.create(EditorInspectorComponent.prototype);
  assert.equal(component.isToolTab('composition'), true);
  assert.equal(component.isToolTab('captions'), true);
  assert.equal(component.isToolTab('format'), true);
  assert.equal(component.isToolTab('history'), false);
  assert.equal(component.isToolTab('review'), false);
  for (const tab of ['composition', 'captions', 'format']) {
    assert.match(template, new RegExp(`id="editor-inspector-tab-${tab}"[^>]*aria-controls="editor-inspector-panel"`));
  }
  assert.match(template, /\[attr\.aria-labelledby\]="isToolTab\(vm\.tab\(\)\) \? inspectorTabId\(vm\.tab\(\)\) : null"/);
  assert.match(template, /\[attr\.role\]="isToolTab\(vm\.tab\(\)\) \? 'tabpanel' : null"/);
  assert.match(template, /\[attr\.tabindex\]="vm\.tab\(\) === 'composition' \? 0 : -1"/);
});
