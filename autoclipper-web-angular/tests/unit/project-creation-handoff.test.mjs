import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { DESIGN_MODE, ProjectCollectionComponent, ProjectsApi, SessionStore, WorkspaceStore } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('a created project is reopened after navigation failure without repeating the create request', async () => {
  let creates = 0;
  const navigations = [];
  const results = [false, true];
  const workspace = {
    workspaceId: signal('workspace-one'),
    loaded: signal(true),
    workspaces: signal([{ id: 'workspace-one', role: 'owner' }]),
  };
  const api = {
    list: async () => ({ items: [] }),
    create: async () => { creates++; return { id: 'created-project' }; },
  };
  TestBed.configureTestingModule({ providers: [
    { provide: ProjectsApi, useValue: api },
    { provide: WorkspaceStore, useValue: workspace },
    { provide: SessionStore, useValue: { user: () => null } },
    { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
    { provide: Router, useValue: { navigate: async route => { navigations.push(route); return results.shift(); } } },
    { provide: DESIGN_MODE, useValue: false },
    { provide: TestComponentRenderer, useValue: { insertRootElement() {}, removeAllRootElements() {} } },
  ] });
  try {
    const component = TestBed.runInInjectionContext(() => new ProjectCollectionComponent());
    for (let turn = 0; turn < 20 && component.busy(); turn++) await new Promise(resolve => setImmediate(resolve));
    component.projectName = 'Primer proyecto';
    await component.create();
    assert.equal(creates, 1);
    assert.match(component.error(), /ya está creado/);
    assert.equal(component.hasCreatedProjectForCurrentInput(), true);
    await component.create();
    assert.equal(creates, 1);
    assert.equal(navigations.length, 2);
    assert.deepEqual(navigations, [['/app/projects', 'created-project'], ['/app/projects', 'created-project']]);
    assert.equal(component.error(), '');
  } finally { TestBed.resetTestingModule(); }
});
