import '@angular/compiler';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppearancePreferenceService } from '../../.local/tests/client.mjs';

test('legacy profile dark resolves to white while a newly explicit dark choice is remembered', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const document = { documentElement: { dataset: {} } };
  const values = new Map();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia: () => ({ matches: true, addEventListener() {} }) },
  });

  try {
    const appearance = new AppearancePreferenceService();
    appearance.restoreForUser('user-1');
    assert.equal(document.documentElement.dataset.theme, 'light');

    appearance.applyFromProfile('user-1', 'system');
    assert.equal(document.documentElement.dataset.theme, 'light');
    appearance.applyFromProfile('user-1', 'dark');
    assert.equal(document.documentElement.dataset.theme, 'light');
    appearance.applyFromProfile('user-1', 'light');
    assert.equal(document.documentElement.dataset.theme, 'light');

    appearance.applyFromUserChoice('user-1', 'dark');
    assert.equal(document.documentElement.dataset.theme, 'dark');
    const restored = new AppearancePreferenceService();
    restored.restoreForUser('user-1');
    restored.applyFromProfile('user-1', 'dark');
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(restored.profileTheme('user-1', 'dark'), 'dark');
  } finally {
    for (const [key, descriptor] of [['document', originalDocument], ['localStorage', originalLocalStorage], ['window', originalWindow]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
