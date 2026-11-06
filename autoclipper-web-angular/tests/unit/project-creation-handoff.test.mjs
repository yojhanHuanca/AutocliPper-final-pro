import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { DESIGN_MODE, DashboardComponent, ProjectCollectionComponent, ProjectComponent, ProjectsApi, SessionStore, WorkspaceStore } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

function dashboardSetup({projects=[],projectsLoaded=false,error='',role='editor',workspaceId='workspace-one',workspaces=[{id:'workspace-one'}],workspaceLoaded=true,design=false}={}){
  const vm={projects:signal(projects),projectsLoaded:signal(projectsLoaded),error:signal(error)};
  const dashboard=Object.create(DashboardComponent.prototype);
  const workspace={workspaceId:signal(workspaceId),loaded:signal(workspaceLoaded),workspaces:signal(workspaces)};
  Object.assign(dashboard,{vm,workspace,design,base:design?'/design':'/app',activeWorkspace:()=>workspaces.find(item=>item.id===workspaceId)??null,resumeProject:()=>projects[0]??null,canCreate:()=>['owner','admin','editor'].includes(role)});
  return{dashboard,vm};
}

test('dashboard distinguishes an unselected workspace from a confirmed empty workspace',()=>{
  const unselected=dashboardSetup({workspaceId:'removed-workspace',workspaces:[{id:'workspace-one'}]}).dashboard;
  assert.equal(unselected.workspaceSelectionRequired(),true);
  const selected=dashboardSetup({workspaceId:'workspace-one'}).dashboard;
  assert.equal(selected.workspaceSelectionRequired(),false);
  const loading=dashboardSetup({workspaceLoaded:false,workspaceId:'',workspaces:[{id:'workspace-one'}]}).dashboard;
  assert.equal(loading.workspaceSelectionRequired(),false,'The workspace loading state must not be presented as a selection error.');
  const design=dashboardSetup({design:true,workspaceId:'',workspaces:[{id:'workspace-one'}]}).dashboard;
  assert.equal(design.workspaceSelectionRequired(),false,'Design preview is independent of a connected workspace.');
});

test('dashboard Crear clips opens the most recent project at Fuente, or opens project creation after a confirmed empty list',()=>{
  const recent={id:'project-recent',workspaceId:'workspace-one',name:'Proyecto reciente',createdAt:'2026-10-20T00:00:00Z',version:1};
  const existing=dashboardSetup({projects:[recent],projectsLoaded:true}).dashboard;
  assert.equal(existing.canCreate(),true);
  assert.deepEqual(existing.createClipsDestination(),['/app/projects','project-recent']);
  assert.equal(existing.createClipsQueryParams(),null);
  assert.equal(existing.createClipsLabel(),'Crear clips');
  assert.deepEqual(existing.createClipsDestinationQueryParams(),{createClips:'1'});
  const empty=dashboardSetup({projects:[],projectsLoaded:true}).dashboard;
  assert.deepEqual(empty.createClipsDestination(),['/app/projects']);
  assert.deepEqual(empty.createClipsQueryParams(),{new:'1'});
  assert.equal(empty.createClipsLabel(),'Crear proyecto');
  assert.equal(empty.createClipsDestinationQueryParams(),null);
  const unconfirmed=dashboardSetup({projects:[],projectsLoaded:false}).dashboard;
  assert.equal(unconfirmed.createClipsQueryParams(),null,'An unconfirmed list must not send the user straight to project creation.');
  assert.equal(unconfirmed.createClipsLabel(),'Consultar proyectos','The action copy must not promise creation before the project list is confirmed.');
  const failed=dashboardSetup({projects:[recent],projectsLoaded:false,error:'No se pudo consultar proyectos.'}).dashboard;
  assert.deepEqual(failed.createClipsDestination(),['/app/projects'],'A stale project is not selected after a failed or incomplete list read.');
  assert.equal(failed.createClipsQueryParams(),null,'A failed list read must never be treated as an empty list.');
  assert.equal(failed.createClipsLabel(),'Consultar proyectos');
});

test('dashboard real draft cards stay in the account editor and never open the synthetic design demo',()=>{
  const app=dashboardSetup().dashboard;
  assert.deepEqual(app.editorDestination('draft-1'),['/app/edits','draft-1']);
  assert.deepEqual(app.projectDestination('project-1'),['/app/projects','project-1']);
  const design=dashboardSetup({design:true}).dashboard;
  assert.deepEqual(design.editorDestination('draft-1'),['/app/projects']);
  assert.deepEqual(design.projectDestination('project-1'),['/design/projects','project-1']);
  const template=readFileSync(new URL('../../src/app/features/dashboard/pages/dashboard.component.html',import.meta.url),'utf8');
  assert.match(template,/\[routerLink\]="editorDestination\(draft\.id\)"/,'Both resume entry points must use the contextual editor route.');
  assert.match(template,/\[routerLink\]="projectDestination\(project\.id\)"/,'Project rows must stay in the dashboard route context.');
  assert.match(template,/\[routerLink\]="projectDestination\(source\.projectId\)"/,'Source rows must return to the matching project in the current route context.');
  assert.doesNotMatch(template,/home-next-steps/,'The dashboard must avoid repeating project, editor and team links already available in the primary modules.');
});

test('project consumes the create-clips navigation once, after access is confirmed',()=>{
  const component=Object.create(ProjectComponent.prototype);
  let wizardCalls=0;const navigations=[];
  Object.assign(component,{
    route:{snapshot:{queryParamMap:{get:key=>key==='createClips'?'1':null}}},
    router:{navigate:async(...args)=>{navigations.push(args);return true;}},
    project:signal({id:'project-recent'}),
    canEdit:()=>true,
    openCreatorWizard:()=>{wizardCalls++;},
  });
  component.openCreatorWizardFromNavigation();
  assert.equal(wizardCalls,1);
  assert.equal(navigations.length,1);
  assert.deepEqual(navigations[0][1],{relativeTo:component.route,queryParams:{createClips:null},queryParamsHandling:'merge',replaceUrl:true});
  component.canEdit=()=>false;
  component.openCreatorWizardFromNavigation();
  assert.equal(wizardCalls,1,'Readers cannot launch the editing flow from a crafted link.');
  assert.equal(navigations.length,1);
});

test('the confirmed empty-library action opens the focus-managed project dialog and identifies its return target',()=>{
  const template=readFileSync(new URL('../../src/app/features/projects/components/project-collection/project-collection.component.html',import.meta.url),'utf8');
  assert.match(template,/<button id="project-empty-create-button"[^>]*\(click\)="openCreateDialog\(\)"[^>]*>[^<]*<span class="create-button-icon">/);
  assert.doesNotMatch(template,/<button[^>]*\(click\)="newProject\.set\(true\)"[^>]*>[^<]*<span class="create-button-icon">/);
  assert.match(template,/\[routerLink\]="\['\/app\/projects', project\.id\]"[^>]*[\s\S]*?<span>Abrir proyecto<\/span>/,'Every card opens its real project detail route with a destination-specific action label.');
  assert.match(template,/importa un video de YouTube[\s\S]*Twitch requieren una cuenta vinculada con permisos/,'The project dialog describes the OAuth and server checks required before a Twitch import.');
  assert.doesNotMatch(template,/añadir un enlace admitido/,'The dialog must not imply unsupported link behavior.');
});

test('an empty library with an unsubmitted search offers to run that search instead of creating a project',()=>{
  const template=readFileSync(new URL('../../src/app/features/projects/components/project-collection/project-collection.component.html',import.meta.url),'utf8');
  assert.match(template,/@else if \(resultsNeedRefresh\(\)\) \{[\s\S]*?\(click\)="load\(\)"[\s\S]*Buscar esta búsqueda/);
  assert.match(template,/Buscar proyectos por '\s*\+ search\.trim\(\)/);
  assert.match(template,/No encontramos ese proyecto/);
});

test('design preview has no disabled project mutations or fake workspace-selection state',()=>{
  const template=readFileSync(new URL('../../src/app/features/projects/components/project-collection/project-collection.component.html',import.meta.url),'utf8');
  assert.match(template,/@if \(!design\) \{\s*<button id="project-create-button"/);
  assert.match(template,/@if \(!design\) \{\s*<form class="project-search"/);
  assert.match(template,/Conecta tu cuenta para buscar proyectos reales/);
  assert.match(template,/@else if \(!design && !workspace\.workspaceId\(\)\)/);
  assert.match(template,/empty-permission-note/);
});

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
    assert.match(component.mutationError(), /ya está creado/);
    assert.equal(component.hasCreatedProjectForCurrentInput(), true);
    await component.create();
    assert.equal(creates, 1);
    assert.equal(navigations.length, 2);
    assert.deepEqual(navigations, [['/app/projects', 'created-project'], ['/app/projects', 'created-project']]);
    assert.equal(component.mutationError(), '');
  } finally { TestBed.resetTestingModule(); }
});

test('project collection pages through only the real results returned by the capped query',async()=>{
  const workspace={workspaceId:signal('workspace-one'),loaded:signal(true),workspaces:signal([{id:'workspace-one',role:'owner'}])};
  const items=Array.from({length:25},(_,index)=>({id:`project-${index+1}`,workspaceId:'workspace-one',name:`Proyecto ${String(index+1).padStart(2,'0')}`,version:1,createdAt:'2026-01-01T00:00:00Z'}));
  const calls=[];
  TestBed.configureTestingModule({providers:[
    {provide:ProjectsApi,useValue:{list:async(id,search)=>{calls.push({id,search});return{items:search?items.filter(item=>item.name.includes(search)):items};}}},
    {provide:WorkspaceStore,useValue:workspace},{provide:SessionStore,useValue:{user:()=>null}},
    {provide:ActivatedRoute,useValue:{snapshot:{queryParamMap:{get:()=>null}}}},{provide:Router,useValue:{navigate:async()=>true}},
    {provide:DESIGN_MODE,useValue:false},{provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  try {
    const component=TestBed.runInInjectionContext(()=>new ProjectCollectionComponent());
    for(let turn=0;turn<20&&component.busy();turn++)await new Promise(resolve=>setImmediate(resolve));
    if(!component.loaded()) await component.load();
    assert.equal(component.loaded(),true);
    assert.equal(component.pageCount(),3);
    assert.deepEqual(component.visibleProjects().map(item=>item.id),items.slice(0,12).map(item=>item.id));
    component.nextPage();
    assert.equal(component.pageIndex(),1);
    assert.deepEqual(component.visibleProjects().map(item=>item.id),items.slice(12,24).map(item=>item.id));
    component.nextPage();
    assert.deepEqual(component.visibleProjects().map(item=>item.id),['project-25']);
    component.nextPage();assert.equal(component.pageIndex(),2,'The last page cannot advance beyond returned results.');
    component.previousPage();assert.equal(component.pageIndex(),1);
    component.search='Proyecto 25';await component.load();
    assert.equal(component.pageIndex(),0,'A new server search returns to its first page.');
    assert.deepEqual(component.visibleProjects().map(item=>item.id),['project-25']);
    assert.equal(calls.filter(call=>call.search==='Proyecto 25').length,1,'Changing local pages never re-fetches projects; only a new search reaches the API.');
  } finally {TestBed.resetTestingModule();}
});

function collectionState(api,workspaceId='alpha') {
  const component=Object.create(ProjectCollectionComponent.prototype);
  Object.assign(component,{
    design:false,generation:0,search:'',projectName:'',creationBody:'',creationKey:'',workspace:{workspaceId:signal(workspaceId)},api,router:{navigate:async()=>true},canEdit:()=>true,
    projects:signal([{id:'previous',workspaceId,name:'Anterior',version:1,createdAt:'2026-01-01T00:00:00Z'}]),
    pageIndex:signal(2),busy:signal(false),loaded:signal(true),error:signal(''),mutationError:signal(''),confirmedSearch:signal(''),
    projectAction:signal(null),actionProject:signal(null),renameValue:'',
    loadedCount:{emit(value){this.value=value;}},
  });
  return component;
}

test('a response for an old project workspace cannot repopulate the library after selection clears',async()=>{
  let resolve;
  const component=collectionState({list:()=>new Promise(done=>resolve=done)});
  const request=component.load('alpha');
  component.workspace.workspaceId.set('');
  await component.load('');
  resolve({items:[{id:'late-alpha',workspaceId:'alpha',name:'Alpha',version:1,createdAt:'2026-01-01T00:00:00Z'}]});
  await request;
  assert.deepEqual(component.projects(),[]);
  assert.equal(component.loaded(),false);
  assert.equal(component.busy(),false);
  assert.equal(component.loadedCount.value,null);
});

test('a project list with the wrong workspace provenance stays hidden and retryable',async()=>{
  const component=collectionState({list:async()=>({items:[{id:'foreign',workspaceId:'beta',name:'Beta',version:1,createdAt:'2026-01-01T00:00:00Z'}]})});
  await component.load('alpha');
  assert.deepEqual(component.projects(),[]);
  assert.equal(component.loaded(),false);
  assert.equal(component.loadedCount.value,null);
  assert.match(component.error(),/no corresponde al espacio seleccionado/);
  assert.equal(component.busy(),false);
});

test('a successful project creation during a workspace switch keeps its receipt without navigating into the new scope',async()=>{
  let resolve,creates=0;const navigations=[];
  const component=collectionState({create:()=>{creates++;return new Promise(done=>resolve=done);}});
  component.router.navigate=async route=>{navigations.push(route);return true;};
  component.projectName='Proyecto en Alpha';
  const request=component.create();
  component.workspace.workspaceId.set('beta');
  resolve({id:'created-alpha'});
  await request;
  assert.deepEqual(navigations,[],'The creation response must not navigate away from the newly selected workspace.');
  assert.equal(component.error(),'');
  component.workspace.workspaceId.set('alpha');
  assert.equal(component.hasCreatedProjectForCurrentInput(),true,'Returning to the original scope exposes the confirmed create receipt.');
  await component.create();
  assert.equal(creates,1,'Reopening the created project must not submit another create request.');
  assert.deepEqual(navigations,[['/app/projects','created-alpha']]);
});

test('a failed project creation from a previous workspace does not surface an error in the new scope',async()=>{
  let reject;
  const component=collectionState({create:()=>new Promise((_resolve,fail)=>reject=fail)});
  component.projectName='Proyecto de prueba';
  const request=component.create();
  component.workspace.workspaceId.set('beta');
  reject(new Error('Alpha unavailable'));
  await request;
  assert.equal(component.error(),'');
  assert.equal(component.busy(),false);
});

test('the project dialog traps keyboard focus and cannot be dismissed while creation is pending',()=>{
  const originalDocument=globalThis.document,originalAnimationFrame=globalThis.requestAnimationFrame;
  const focused=[];let prevented=0;const animationFrames=[];
  const makeTarget=name=>({name,isConnected:true,getClientRects:()=>[{}],getAttribute:()=>null,focus(){focused.push(name);globalThis.document.activeElement=this;}});
  const first=makeTarget('close'),last=makeTarget('submit');
  globalThis.document={activeElement:first,getElementById:()=>null};
  globalThis.requestAnimationFrame=callback=>{animationFrames.push(callback);return animationFrames.length;};
  try {
    const component=collectionState({});
    component.newProject=signal(true);component.busy=signal(false);
    const dialog={querySelectorAll:()=>[first,last]};
    const key=(key,shiftKey=false)=>component.onCreateDialogKeydown({key,shiftKey,currentTarget:dialog,preventDefault(){prevented++;}});
    key('Tab',true);
    assert.deepEqual(focused,['submit'],'Shift+Tab from the first control stays inside the dialog.');
    key('Tab');
    assert.deepEqual(focused,['submit','close'],'Tab from the last control cycles to the first.');
    key('Escape');
    assert.equal(component.newProject(),false);
    animationFrames.splice(0).forEach(callback=>callback());
    component.newProject.set(true);component.busy.set(true);
    key('Escape');
    assert.equal(component.newProject(),true,'Escape cannot hide a pending create request.');
    assert.equal(prevented,4);
  } finally {
    if(originalDocument===undefined) delete globalThis.document; else globalThis.document=originalDocument;
    if(originalAnimationFrame===undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame=originalAnimationFrame;
  }
});
