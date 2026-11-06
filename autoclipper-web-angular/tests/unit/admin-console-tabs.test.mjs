import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@angular/compiler';
import { signal } from '@angular/core';
import { AdminConsoleComponent } from '../../.local/tests/client.mjs';

test('admin console tabs expose one selected tab and support roving arrow, Home and End navigation', () => {
  const component = Object.create(AdminConsoleComponent.prototype);
  component.activeView = signal('summary');
  component.availableSections = () => [{ id: 'users' }, { id: 'jobs' }];
  component.showSummary = () => component.activeView.set('summary');
  component.selectSection = view => component.activeView.set(view);
  const oldDocument = globalThis.document;
  const focused = [];
  globalThis.document = { getElementById: id => ({ focus: () => focused.push(id) }) };
  try {
    const keys = [];
    const press = key => component.onDataTabKeydown({ key, preventDefault: () => keys.push(key) });
    press('ArrowLeft');
    assert.equal(component.activeView(), 'jobs', 'ArrowLeft wraps from the first tab to the last.');
    press('ArrowRight');
    assert.equal(component.activeView(), 'summary', 'ArrowRight wraps from the last tab to the first.');
    press('End');
    assert.equal(component.activeView(), 'jobs');
    press('Home');
    assert.equal(component.activeView(), 'summary');
    press('Enter');
    assert.deepEqual(keys, ['ArrowLeft', 'ArrowRight', 'End', 'Home'], 'Unmapped keys keep native button behavior.');
    assert.deepEqual(focused, ['admin-tab-jobs', 'admin-tab-summary', 'admin-tab-jobs', 'admin-tab-summary']);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});

test('admin console tabs are associated with their selected panel', () => {
  const template = readFileSync(new URL('../../src/app/features/administration/pages/admin-console.component.html', import.meta.url), 'utf8');
  assert.match(template, /role="tablist"/);
  assert.match(template, /role="tab"[^\n]*aria-controls="admin-view-panel"/);
  assert.match(template, /\[attr\.aria-selected\]="activeView\(\) === 'summary'"/);
  assert.match(template, /id="admin-view-panel" role="tabpanel"[^\n]*\[attr\.aria-labelledby\]="dataTabId\(activeView\(\)\)"/);
});
