import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IconComponent } from '../../.local/tests/client.mjs';

test('every icon referenced by the application has a dedicated SVG path', () => {
  for (const name of ['lock', 'refresh']) {
    assert.ok(IconComponent.paths[name], `The ${name} icon must not fall back to the grid glyph.`);
  }
  assert.notEqual(IconComponent.paths.lock, IconComponent.paths.grid);
  assert.notEqual(IconComponent.paths.refresh, IconComponent.paths.grid);
});
