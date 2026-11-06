import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { DESIGN_MODE, SessionStore, WorkspaceStore, WorkspaceTeamComponent, WorkspaceTeamApi, WorkspaceLayoutComponent } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const renderer = { insertRootElement() {}, removeAllRootElements() {} };
const teamSpaces = [
  { id: 'alpha', name: 'Alpha', kind: 'team', role: 'owner' },
  { id: 'beta', name: 'Beta', kind: 'team', role: 'owner' },
];
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };

test('workspace team explains clip workflow access and role capabilities', () => {
  const { component } = setup({ members: async () => ({ items: [] }) });
  try {
    assert.deepEqual(component.teamWorkflow.map(({ step, title }) => [step, title]), [
      ['01', 'Preparar el video'],
      ['02', 'Editar y solicitar revisión'],
      ['03', 'Consultar resultados'],
    ]);
    assert.match(component.teamWorkflow[0].access, /Editor.*Administrador.*Propietario/);
    assert.equal(component.teamWorkflow[2].access, 'Todos los roles');
    assert.match(component.capabilities.find(({ role }) => role === 'Lector').detail, /comentarios y exportaciones.*No puede cargar ni editar/);
  } finally { TestBed.resetTestingModule(); }
});

test('workspace heading and role label follow the selected space and confirmed permission state',()=>{
  const {component,store}=setup({members:async()=>({items:[]})});
  try {
    assert.equal(component.pageTitle(),'Personas y permisos del equipo');
    assert.equal(component.activePermissionLabel(),'Propietario');
    component.workspacePermissionsUnconfirmed.set(true);
    assert.equal(component.activePermissionLabel(),'Por confirmar','A stale workspace role is not displayed as currently confirmed.');
    component.workspacePermissionsUnconfirmed.set(false);
    component.forbidden.set(true);
    assert.equal(component.activePermissionLabel(),'Sin acceso confirmado');
    component.forbidden.set(false);
    store.workspaces.set([{id:'personal',name:'Personal',kind:'personal',role:'owner'}]);
    store.workspaceId.set('personal');
    assert.equal(component.pageTitle(),'Tu espacio personal');
    store.workspaceId.set('');
    assert.equal(component.pageTitle(),'Selecciona un espacio');
    store.loaded.set(false);
    assert.equal(component.pageTitle(),'Consultando espacios');
    const template=readFileSync(new URL('../../src/app/features/workspaces/pages/workspace-team.component.html',import.meta.url),'utf8');
    assert.match(template,/<h1>\{\{ pageTitle\(\) \}\}<\/h1>/);
    assert.match(template,/\{\{ activePermissionLabel\(\) \}\}/);
    assert.match(template,/<ac-account-section-nav\s+\[design\]="design"\s+section="team"\s*\/>/);
  } finally {TestBed.resetTestingModule();}
});

test('team controls keep mobile layout and high-visibility keyboard focus',()=>{
  const css=readFileSync(new URL('../../src/app/features/workspaces/pages/workspace-team.component.css',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:600px\)[\s\S]*?\.team-studio-heading \{ flex-direction:column;/);
  assert.match(css,/team-studio :is\(a,button,select,input,summary\):focus-visible/);
});

function setup(api) {
  const store = { workspaces: signal(teamSpaces), workspaceId: signal('alpha'), loaded:signal(true), loadCalls: 0, async loadWorkspaces() { this.loadCalls++; } };
  TestBed.configureTestingModule({ providers: [
    { provide: TestComponentRenderer, useValue: renderer },
    { provide: DESIGN_MODE, useValue: false },
    { provide: WorkspaceStore, useValue: store },
    { provide: WorkspaceTeamApi, useValue: api },
    { provide: SessionStore, useValue: { user: signal({ id: 'actor' }) } },
  ] });
  return { store, component: TestBed.runInInjectionContext(() => new WorkspaceTeamComponent()) };
}

test('a late invitation response cannot update the newly selected workspace', async () => {
  const pending = deferred();
  const calls = [];
  const api = { members: async () => ({ items: [] }), invite: (...args) => { calls.push(args); return pending.promise; } };
  const { store, component } = setup(api);
  try {
    component.inviteEmail = 'guest@example.com';
    const request = component.invite();
    assert.equal(calls[0][0], 'alpha');
    store.workspaceId.set('beta');
    assert.equal(component.inviteEmail, '', 'A draft for Alpha must not appear in the Beta invitation form.');
    component.inviteEmail = 'new-workspace@example.com';
    pending.resolve();
    await request;
    assert.equal(component.message(), '');
    assert.equal(component.inviteEmail, 'new-workspace@example.com', 'The stale response must not repopulate or clear the new workspace draft.');
  } finally { TestBed.resetTestingModule(); }
});

test('changing workspace from a project or editor route returns to that workspace project list',async()=>{
  for(const url of ['/app/projects/project-one','/app/edits/draft-one','/app/edits']){
    const component=Object.create(WorkspaceLayoutComponent.prototype),calls=[];
    const workspace={workspaceId:signal('alpha'),workspaces:signal([{id:'alpha'},{id:'beta'}])};
    Object.assign(component,{design:false,workspace,workspaceSwitching:signal(false),error:signal('An error from an older navigation'),router:{url,navigateByUrl:async target=>{calls.push(target);return true;}}});
    await component.selectWorkspace('beta');
    assert.equal(workspace.workspaceId(),'beta');
    assert.deepEqual(calls,['/app/projects']);
    assert.equal(component.workspaceSwitching(),false);
    assert.equal(component.error(),'','A successful change clears an obsolete shell error.');
  }
});

test('cancelled draft navigation restores the previous workspace selection',async()=>{
  const component=Object.create(WorkspaceLayoutComponent.prototype),workspace={workspaceId:signal('alpha'),workspaces:signal([{id:'alpha'},{id:'beta'}])};
  Object.assign(component,{design:false,workspace,workspaceSwitching:signal(false),error:signal(''),router:{url:'/app/edits/draft-one',navigateByUrl:async()=>false}});
  await component.selectWorkspace('beta');
  assert.equal(workspace.workspaceId(),'alpha');
  assert.equal(component.workspaceSwitching(),false);
  assert.match(component.error(),/Se conserva el espacio anterior/,'A cancelled route change stays recoverable and explains how to retry.');
});

test('the workspace breadcrumb and project navigation follow registered app and design routes',()=>{
  const component=Object.create(WorkspaceLayoutComponent.prototype);
  Object.assign(component,{design:false,base:'/app',router:{url:'/app'}});
  const appRoutes=[
    ['/app','Inicio',false],
    ['/app/projects?sort=recent','Proyectos',true],
    ['/app/projects/project-one','Proyecto',true],
    ['/app/edits','Editor',true],
    ['/app/edits/draft-one','Editor de clip',true],
    ['/app/team','Equipo y espacio',false],
    ['/app/settings','Configuración',false],
    ['/app/consumption','Consumo',false],
  ];
  for(const [url,label,projectArea] of appRoutes){
    component.router.url=url;
    assert.equal(component.currentRouteLabel(),label,`breadcrumb for ${url}`);
    assert.equal(component.isProjectArea(),projectArea,`project navigation state for ${url}`);
  }
  component.design=true;component.base='/design';component.router.url='/design/editor';
  assert.equal(component.currentRouteLabel(),'Editor de clip');
  assert.equal(component.isProjectArea(),true);
  component.router.url='/design/projects/project-one';
  assert.equal(component.currentRouteLabel(),'Proyecto');
  assert.equal(component.isProjectArea(),true);
});

test('the icon-only workspace rail is limited to actual editor routes',()=>{
  const component=Object.create(WorkspaceLayoutComponent.prototype);
  Object.assign(component,{design:false,base:'/app',router:{url:'/app'}});
  for(const url of ['/app/edits','/app/edits/draft-one','/app/editor']){
    component.router.url=url;
    assert.equal(component.isEditorRoute(),true,`${url} uses the compact editor rail`);
  }
  for(const url of ['/app','/app/projects','/app/projects/project-one','/app/team','/design/projects']){
    component.router.url=url;
    component.design=url.startsWith('/design');
    component.base=component.design?'/design':'/app';
    assert.equal(component.isEditorRoute(),false,`${url} uses the expanded workspace navigation`);
  }
  component.design=true;component.base='/design';component.router.url='/design/editor';
  assert.equal(component.isEditorRoute(),true,'The design-only editor preview uses the compact rail too.');
});

test('a role change response does not refresh another selected workspace', async () => {
  const pending = deferred();
  const calls = [];
  const api = { members: async () => ({ items: [] }), setRole: (...args) => { calls.push(args); return pending.promise; } };
  const { store, component } = setup(api);
  try {
    const member = { userId: 'editor-1', role: 'editor', createdAt: '2026-01-01T00:00:00.000Z' };
    component.members.set([member]); component.membersLoaded.set(true);
    component.roleDrafts.set({ [member.userId]: 'reader' });
    component.transferTarget.set(member.userId);
    component.transferConfirmation.set(true);
    const request = component.saveRole(member);
    assert.deepEqual(calls[0], ['alpha', 'editor-1', 'reader']);
    store.workspaceId.set('beta');
    pending.resolve();
    await request;
    assert.equal(store.loadCalls, 0);
    assert.equal(component.message(), '');
  } finally { TestBed.resetTestingModule(); }
});

test('a confirmed role change stays confirmed when refreshing the workspace list fails', async () => {
  const calls = [];
  const { component, store } = setup({ members: async () => ({ items: [] }), setRole: async (...args) => { calls.push(args); } });
  try {
    store.loadWorkspaces = async () => { throw new Error('Workspace list unavailable'); };
    const member = { userId: 'editor-1', role: 'editor', createdAt: '2026-01-01T00:00:00.000Z' };
    component.members.set([member]); component.membersLoaded.set(true);
    component.roleDrafts.set({ [member.userId]: 'reader' });

    await component.saveRole(member);

    assert.deepEqual(calls, [['alpha', 'editor-1', 'reader']]);
    assert.match(component.message(), /Rol actualizado/);
    assert.match(component.error(), /El cambio se guardó, pero no se pudo actualizar la lista de espacios/);
    assert.equal(component.workspacePermissionsUnconfirmed(), true);
    assert.equal(component.workspaceListRefreshFailed(), true);
    assert.equal(component.canManage(), false, 'A role or ownership mutation must not leave actions enabled under the last pre-mutation role if the fresh role list failed.');
    assert.equal(component.canTransfer(), false);
  } finally { TestBed.resetTestingModule(); }
});

test('workspace refresh errors are handled and exposed instead of becoming unhandled promises', async () => {
  const { component, store } = setup({ members: async () => ({ items: [] }) });
  try {
    store.loadWorkspaces = async () => { throw new Error('Workspace list unavailable'); };
    component.forbidden.set(true);
    await component.refreshWorkspaces();
    assert.match(component.error(), /No se pudieron actualizar los espacios/);
    assert.match(component.error(), /Workspace list unavailable/);
    assert.equal(component.workspaceRefreshBusy(), false);
  } finally { TestBed.resetTestingModule(); }
});

test('design, denied and loading team states cannot invite, change roles, remove or transfer',async()=>{
  const calls=[];
  const api={members:async()=>({items:[]}),invite:async()=>calls.push('invite'),setRole:async()=>calls.push('role'),remove:async()=>calls.push('remove'),transfer:async()=>calls.push('transfer')};
  for(const blocked of ['design','forbidden','loading']) {
    const {component}=setup(api);
    try {
      const member={userId:'guest',role:'editor'};
      component.members.set([member]); component.membersLoaded.set(true); component.roleDrafts.set({guest:'reader'});
      component.pendingRemoval.set('guest'); component.transferTarget.set('guest'); component.transferConfirmation.set(true);
      if(blocked==='design') component.design=true; else component[blocked].set(true);
      await component.invite(); await component.saveRole(member); await component.confirmRemove(member); await component.transferOwnership();
    } finally {TestBed.resetTestingModule();}
  }
  assert.deepEqual(calls,[]);
});

test('workspace administrator cannot promote another member to administrator through a draft',async()=>{
  const calls=[];
  const {component,store}=setup({members:async()=>({items:[]}),setRole:async(...args)=>calls.push(args)});
  try {
    store.workspaces.set([{id:'alpha',name:'Alpha',kind:'team',role:'admin'}]);
    component.members.set([{userId:'guest',role:'editor'}]); component.membersLoaded.set(true);
    component.roleDrafts.set({guest:'admin'});
    await component.saveRole({userId:'guest',role:'editor'});
    assert.deepEqual(calls,[]);
  } finally {TestBed.resetTestingModule();}
});

test('a denied member refresh clears people, role drafts and destructive confirmations',async()=>{
  const {component}=setup({members:async()=>{throw new HttpErrorResponse({status:403});}});
  try {
    component.members.set([{userId:'former-member',role:'editor'}]);
    component.roleDrafts.set({'former-member':'reader'});
    component.pendingRemoval.set('former-member'); component.transferTarget.set('former-member'); component.transferConfirmation.set(true);
    await component.refresh();
    assert.deepEqual(component.members(),[]);
    assert.deepEqual(component.roleDrafts(),{});
    assert.equal(component.pendingRemoval(),''); assert.equal(component.transferTarget(),'');
    assert.equal(component.transferConfirmation(),false);
    assert.equal(component.canManage(),false);
    assert.equal(component.canTransfer(),false);
    assert.equal(component.membersLoaded(),false);
  } finally {TestBed.resetTestingModule();}
});


test('member count is only confirmed after a successful response and is unknown during refresh failure',async()=>{
  const pending=deferred();
  const api={members:()=>pending.promise};
  const {component}=setup(api);
  try {
    const request=component.refresh();
    assert.equal(component.membersLoaded(),false);
    pending.resolve({items:[{userId:'actor',role:'owner',createdAt:'2026-10-18T00:00:00.000Z'}]});
    await request;
    assert.equal(component.membersLoaded(),true); assert.equal(component.members().length,1);
    api.members=async()=>{throw new Error('temporarily unavailable');};
    await component.refresh();
    assert.equal(component.membersLoaded(),false);
    assert.equal(component.members().length,1,'previous rows remain qualified by the error, without a current count');
    assert.equal(component.canManageMember(component.members()[0]),false,'Stale members cannot be changed until the list is confirmed again.');
    assert.equal(component.canTransfer(),false,'Ownership transfer must use members from a confirmed list.');
  } finally {TestBed.resetTestingModule();}
});

test('a role that differs from the confirmed member row cannot be mutated',async()=>{
  const calls=[];
  const {component}=setup({members:async()=>({items:[]}),setRole:async(...args)=>calls.push(args)});
  try {
    const current={userId:'guest',role:'reader',createdAt:'2026-01-01T00:00:00.000Z'};
    component.members.set([current]); component.membersLoaded.set(true);
    component.roleDrafts.set({guest:'reader'});
    await component.saveRole({...current,role:'editor'});
    assert.deepEqual(calls,[],'The mutation must match the confirmed member role, not a stale or caller-supplied row.');
  } finally {TestBed.resetTestingModule();}
});

test('workspace administrators can consult and confirm revocation of pending invitations',async()=>{
  const calls=[];
  const invitation={id:'6ba7b810-9dad-41d1-80b4-00c04fd430c8',email:'guest@example.test',role:'editor',expiresAt:'2099-01-01T00:00:00.000Z',acceptedAt:null,revokedAt:null};
  const {component}=setup({members:async()=>({items:[]}),invitations:async id=>{calls.push(['list',id]);return {items:[{id:invitation.id,email:invitation.email,role:invitation.role,expires_at:invitation.expiresAt,accepted_at:null,revoked_at:null}]}},revokeInvitation:async(...args)=>{calls.push(['revoke',...args]);return {revoked:true}}});
  try {
    await component.loadInvitations();
    assert.equal(component.invitationsLoaded(),true);
    assert.equal(component.invitationStatus(component.invitations()[0]),'pending');
    component.pendingInvitationRevocation.set(invitation.id);
    await component.revokeInvitation(invitation);
    assert.deepEqual(calls,[['list','alpha'],['revoke','alpha',invitation.id],['list','alpha']]);
    assert.match(component.message(),/Invitación para guest@example.test revocada/);
  } finally {TestBed.resetTestingModule();}
});

test('a failed invitation refresh keeps old rows read-only until the current list is confirmed',async()=>{
  const calls=[];
  const invitation={id:'6ba7b810-9dad-41d1-80b4-00c04fd430c8',email:'guest@example.test',role:'editor',expiresAt:'2099-01-01T00:00:00.000Z',acceptedAt:null,revokedAt:null};
  let requests=0;
  const {component}=setup({members:async()=>({items:[]}),invitations:async()=>{if(++requests===1)return{items:[{id:invitation.id,email:invitation.email,role:invitation.role,expires_at:invitation.expiresAt,accepted_at:null,revoked_at:null}]};throw new HttpErrorResponse({status:503});},revokeInvitation:async(...args)=>calls.push(args)});
  try{
    await component.loadInvitations();
    component.pendingInvitationRevocation.set(invitation.id);
    await component.loadInvitations();
    assert.equal(component.invitationsLoaded(),false);
    assert.deepEqual(component.invitations().map(item=>item.email),[invitation.email],'The prior list remains visible for reference.');
    assert.equal(component.pendingInvitationRevocation(),'','A confirmation from the previous query is discarded.');
    await component.revokeInvitation(invitation);
    assert.deepEqual(calls,[],'A stale pending row cannot be revoked until the list is confirmed again.');
  }finally{TestBed.resetTestingModule();}
});

test('a denied invitation refresh clears email rows from the previous workspace access',async()=>{
  const invitation={id:'6ba7b810-9dad-41d1-80b4-00c04fd430c8',email:'private@example.test',role:'editor',expiresAt:'2099-01-01T00:00:00.000Z',acceptedAt:null,revokedAt:null};
  let requests=0;
  const {component}=setup({members:async()=>({items:[]}),invitations:async()=>{if(++requests===1)return{items:[{id:invitation.id,email:invitation.email,role:invitation.role,expires_at:invitation.expiresAt,accepted_at:null,revoked_at:null}]};throw new HttpErrorResponse({status:403});}});
  try{
    await component.loadInvitations();
    component.pendingInvitationRevocation.set(invitation.id);
    await component.loadInvitations();
    assert.deepEqual(component.invitations(),[]);
    assert.equal(component.invitationsLoaded(),false);
    assert.equal(component.pendingInvitationRevocation(),'');
  }finally{TestBed.resetTestingModule();}
});

test('a stale invitation result cannot replace the selected workspace list',async()=>{
  const pending=deferred();
  const {store,component}=setup({members:async()=>({items:[]}),invitations:()=>pending.promise});
  try {
    const request=component.loadInvitations();
    store.workspaceId.set('beta');
    pending.resolve({items:[{id:'6ba7b810-9dad-41d1-80b4-00c04fd430c8',email:'stale@example.test',role:'editor',expires_at:'2099-01-01T00:00:00.000Z',accepted_at:null,revoked_at:null}]});
    await request;
    assert.deepEqual(component.invitations(),[]);
  } finally {TestBed.resetTestingModule();}
});

test('a late invitation refresh for the same workspace cannot replace the newest confirmed list',async()=>{
  const first=deferred(),second=deferred();
  let requests=0;
  const {component}=setup({members:async()=>({items:[]}),invitations:()=>++requests===1?first.promise:second.promise});
  const row=(id,email)=>({id,email,role:'editor',expires_at:'2099-01-01T00:00:00.000Z',accepted_at:null,revoked_at:null});
  try{
    const older=component.loadInvitations();
    const newer=component.loadInvitations();
    second.resolve({items:[row('6ba7b810-9dad-41d1-80b4-00c04fd430c8','current@example.test')]});
    await newer;
    first.resolve({items:[row('6ba7b810-9dad-41d1-80b4-00c04fd430c9','stale@example.test')]});
    await older;
    assert.equal(component.invitationsLoaded(),true);
    assert.deepEqual(component.invitations().map(item=>item.email),['current@example.test']);
  }finally{TestBed.resetTestingModule();}
});
