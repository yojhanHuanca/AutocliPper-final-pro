import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@angular/compiler';
import { notFoundProjectsRoute } from '../../.local/tests/client.mjs';

test('not-found project action stays in the design route and sends app routes to projects', () => {
  assert.equal(notFoundProjectsRoute('/design/missing?view=demo'), '/design/projects');
  assert.equal(notFoundProjectsRoute('/design/edits/missing#top'), '/design/projects');
  assert.equal(notFoundProjectsRoute('/app/edits/missing'), '/app/projects');
  assert.equal(notFoundProjectsRoute('/login/missing'), '/app/projects');
});
