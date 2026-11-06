import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('compact clip-flow step buttons retain their stage names for assistive technology', async () => {
  const template = await readFile(new URL('../../src/app/features/projects/pages/project-detail.component.html', import.meta.url), 'utf8');
  const button = template.match(/<button type="button" class="creator-step"[\s\S]*?>/)?.[0];

  assert.ok(button, 'The creator stepper button is present.');
  assert.match(button, /\[attr\.aria-label\]="'Paso ' \+ \(index \+ 1\) \+ ': ' \+ step\.label"/);
});
