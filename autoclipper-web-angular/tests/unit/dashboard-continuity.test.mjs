import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { DashboardComponent } from '../../.local/tests/client.mjs';

function dashboard({ denied = true, loadWorkspaces = async () => true, load = async () => {} } = {}) {
  const workspaceId = signal('alpha');
  const component = Object.create(DashboardComponent.prototype);
  Object.assign(component, {
    design: false,
    vm: { denied: signal(denied), load },
    workspace: { workspaceId, loadWorkspaces },
    activeWorkspaceId: () => workspaceId(),
    workspaceRefreshBusy: signal(false),
    workspaceRefreshError: signal(''),
  });
  return { component, workspaceId };
}

test('a dashboard access denial refreshes memberships before retrying the selected space', async () => {
  const calls = [];
  const { component } = dashboard({
    loadWorkspaces: async () => { calls.push('workspaces'); return true; },
    load: async id => calls.push(`dashboard:${id}`),
  });
  await component.retry();
  assert.deepEqual(calls, ['workspaces', 'dashboard:alpha']);
  assert.equal(component.workspaceRefreshError(), '');
  assert.equal(component.workspaceRefreshBusy(), false);
});

test('a workspace switch during access refresh leaves loading the new selection to workspace navigation', async () => {
  const calls = [];
  const { component, workspaceId } = dashboard({
    loadWorkspaces: async () => { workspaceId.set('beta'); return true; },
    load: async id => calls.push(id),
  });
  await component.retry();
  assert.deepEqual(calls, [], 'The workspace selection effect owns the new workspace load.');
});

test('workspace refresh errors are visible and the action remains retryable', async () => {
  let attempts = 0;
  const { component } = dashboard({ loadWorkspaces: async () => { attempts++; throw new Error('gateway offline'); } });
  await component.retry();
  assert.match(component.workspaceRefreshError(), /No se pudieron actualizar tus espacios.*gateway offline/);
  assert.equal(component.workspaceRefreshBusy(), false);
  await component.retry();
  assert.equal(attempts, 2);
});

test('dashboard differentiates confirmed empty results from failed or partial project, draft and source queries', () => {
  const template = readFileSync(new URL('../../src/app/features/dashboard/pages/dashboard.component.html', import.meta.url), 'utf8');
  assert.match(template, /vm\.projectsLoaded\(\) \? 'Aún no hay proyectos en este espacio\.' : 'No se confirmó la lista de proyectos\.'/);
  assert.match(template, /vm\.sourcesError\(\) \? 'No se confirmaron las fuentes\./);
  assert.match(template, /vm\.draftsError\(\) \? 'Las fuentes no se pueden consultar hasta confirmar algunos borradores\.'/);
  assert.match(template, /Se conserva la última lista confirmada mientras vuelves a consultar\./);
  assert.doesNotMatch(template, /Creado \{\{ project\.createdAt[^}]*\}\} · Versión \{\{ project\.version \}\}/, 'Internal project versions are not presented as creator activity.');
});
