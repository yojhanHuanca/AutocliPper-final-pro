import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { ProjectCollectionComponent, ProjectsApi } from '../../.local/tests/client.mjs';

const project = (overrides = {}) => ({
  id: 'project-a', workspaceId: 'workspace-a', name: 'Proyecto original',
  version: 7, createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
});

function collection({ role = 'editor', items = [project()], api = {} } = {}) {
  const workspace = {
    workspaceId: signal('workspace-a'),
    loaded: signal(true),
    workspaces: signal([{ id: 'workspace-a', role }]),
  };
  const state = Object.create(ProjectCollectionComponent.prototype);
  Object.assign(state, {
    design: false,
    workspace,
    api,
    generation: 0,
    loadedWorkspaceId: 'workspace-a',
    busy: signal(false),
    loaded: signal(true),
    error: signal(''),
    mutationError: signal(''),
    confirmedSearch: signal(''),
    projects: signal(items),
    pageIndex: signal(0),
    pageCount: () => Math.max(1, Math.ceil(state.projects().length / 12)),
    loadedCount: { emit(value) { this.value = value; } },
    projectAction: signal('rename'),
    actionProject: signal(items[0] ?? project()),
    renameValue: '  Proyecto nuevo  ',
    search: '',
    canEdit: () => ['owner', 'admin', 'editor'].includes(role),
  });
  return state;
}

test('rename uses the project version, trims the name and updates only after server confirmation', async () => {
  const calls = [];
  const state = collection({ api: { updateProject: async (...args) => { calls.push(args); return { id: 'project-a', workspaceId: 'workspace-a', name: 'Proyecto nuevo', version: 8 }; } } });
  await state.saveRename();
  assert.deepEqual(calls, [['project-a', { name: 'Proyecto nuevo', version: 7 }]]);
  assert.deepEqual(state.projects().map(({ name, version }) => ({ name, version })), [{ name: 'Proyecto nuevo', version: 8 }]);
  assert.equal(state.projectAction(), null);
  assert.equal(state.busy(), false);
});

test('rename conflict retains the confirmed project and keeps the editor open for retry', async () => {
  const state = collection({ api: { updateProject: async () => { throw { status: 409 }; } } });
  await state.saveRename();
  assert.equal(state.projects()[0].name, 'Proyecto original');
  assert.equal(state.projects()[0].version, 7);
  assert.equal(state.projectAction(), 'rename');
  assert.match(state.mutationError(), /cambió/);
});

test('the project leaves the active list only after the trash endpoint confirms it', async () => {
  let calls = 0;
  const state = collection({ api: { trashProject: async () => { calls++; } } });
  state.projectAction.set('archive');
  await state.archiveProject();
  assert.equal(calls, 1);
  assert.deepEqual(state.projects(), []);
  assert.equal(state.loadedCount.value, 0);
  assert.equal(state.projectAction(), null);
});

test('read-only members cannot rename or move projects to the trash endpoint', async () => {
  let writes = 0;
  const state = collection({ role: 'reader', api: {
    updateProject: async () => { writes++; return { id: 'project-a', version: 8 }; },
    trashProject: async () => { writes++; },
  } });
  await state.saveRename();
  state.projectAction.set('archive');
  await state.archiveProject();
  assert.equal(writes, 0);
  assert.equal(state.projects()[0].name, 'Proyecto original');
});

test('a temporary refresh failure retains the last confirmed project list', async () => {
  const previous = project();
  const state = collection({ items: [previous], api: { list: async () => { throw { status: 503 }; } } });
  await state.load('workspace-a');
  assert.deepEqual(state.projects(), [previous]);
  assert.equal(state.loaded(), true);
  assert.notEqual(state.error(), '');
  assert.equal(state.busy(), false);
});

test('a denied project list clears private rows from the last workspace response', async () => {
  const state = collection({ api: { list: async () => { throw { status: 403 }; } } });
  await state.load('workspace-a');
  assert.deepEqual(state.projects(), []);
  assert.equal(state.loaded(), false);
  assert.equal(state.loadedCount.value, null);
  assert.notEqual(state.error(), '');
});

test('project rename and trash use the existing PATCH and DELETE routes', async () => {
  const calls = [];
  const transport = {
    patch: async (...args) => { calls.push(['PATCH', ...args]); },
    get: async (...args) => { calls.push(['GET', ...args]); return project({ name: 'Nuevo nombre', version: 8 }); },
    delete: async (...args) => { calls.push(['DELETE', ...args]); },
  };
  const api = Object.create(ProjectsApi.prototype);
  api.api = transport;
  await api.updateProject('project/a', { name: 'Nuevo nombre', version: 7 });
  await api.trashProject('project/a');
  assert.deepEqual(calls, [
    ['PATCH', '/projects/project%2Fa', { name: 'Nuevo nombre', version: 7 }],
    ['GET', '/projects/project%2Fa'],
    ['DELETE', '/projects/project%2Fa'],
  ]);
});

test('project cards open the real project route and its saved drafts open the account editor', () => {
  const collectionTemplate = readFileSync(new URL('../../src/app/features/projects/components/project-collection/project-collection.component.html', import.meta.url), 'utf8');
  const projectTemplate = readFileSync(new URL('../../src/app/features/projects/pages/project-detail.component.html', import.meta.url), 'utf8');
  const shellTemplate = readFileSync(new URL('../../src/app/layouts/workspace/workspace-layout.component.html', import.meta.url), 'utf8');
  const shellCss = readFileSync(new URL('../../src/app/layouts/workspace/workspace-layout.component.css', import.meta.url), 'utf8');
  assert.match(collectionTemplate, /\[routerLink\]="\['\/app\/projects', project\.id\]"/);
  assert.match(projectTemplate, /\[routerLink\]="\['\/app\/edits', edit\.id\]"/);
  assert.match(shellTemplate, /base \+ '\/projects'/);
  assert.match(shellTemplate, />Proyectos<\/a>/);
  assert.match(shellCss, /\.app-shell\.editor-mode \.sidebar nav > a\s*\{[^}]*font-size:\s*0/s);
  assert.match(shellCss, /\.sidebar nav > a\s*\{[^}]*font-size:\s*12px/s, 'Outside editor mode, sidebar labels retain their normal text layout.');
});
