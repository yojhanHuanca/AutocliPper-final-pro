import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute } from '@angular/router';
import { SettingsComponent, SettingsApi, DESIGN_MODE, SessionStore, WorkspaceStore } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('settings keeps successful account sections and localizes session and privacy states', async () => {
  const profile={id:'user-1',email:'qa@example.test',name:'QA',version:2,preferences:{timezone:'America/Lima',emailNotifications:false,locale:'es',theme:'light'}};
  const mfa={enabled:false,recoveryCodesRemaining:0};
  const api={profile:async()=>profile,mfa:async()=>mfa,privacy:async()=>{throw new Error('Privacy endpoint unavailable');},sessions:async()=>{throw new Error('Session endpoint unavailable');}};
  TestBed.configureTestingModule({providers:[
    SettingsComponent,
    {provide:SettingsApi,useValue:api},{provide:DESIGN_MODE,useValue:false},
    {provide:SessionStore,useValue:{user:{set(){},}}},
    {provide:WorkspaceStore,useValue:{workspaces:signal([]),workspaceId:signal(''),loaded:signal(true)}},
    {provide:ActivatedRoute,useValue:{snapshot:{}}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  try {
    const state=TestBed.inject(SettingsComponent);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(state.profile(),profile);
    assert.deepEqual(state.mfa(),mfa);
    assert.equal(state.sessions().length,0);
    assert.equal(state.sessionsLoaded(),false);
    assert.equal(state.emailNotifications,false);
    assert.match(state.sessionsError(),/Session endpoint unavailable/);
    assert.equal(state.privacyKindLabel('export'),'Exportación de datos');
    assert.equal(state.privacyStateLabel('requested'),'Registrada · alcance global pendiente');
    assert.deepEqual(state.privacy(),[]);
    assert.match(state.error(),/privacidad/);
    assert.equal(state.busy(),false);
  } finally { TestBed.resetTestingModule(); }
});

function securitySubject(api) {
  TestBed.configureTestingModule({providers:[
    SettingsComponent,{provide:SettingsApi,useValue:api},{provide:DESIGN_MODE,useValue:true},
    {provide:SessionStore,useValue:{user:signal(null)}},
    {provide:WorkspaceStore,useValue:{workspaces:signal([]),workspaceId:signal(''),loaded:signal(true)}},
    {provide:ActivatedRoute,useValue:{snapshot:{}}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  const state=TestBed.inject(SettingsComponent);
  state.design=false; state.tab.set('Seguridad'); state.mfa.set({enabled:false,recoveryCodesRemaining:0});
  state.privacyExportRequestId.set('export-pending');
  state.privacyManifest.set({
    requestId:'export-pending',kind:'export',requestState:'requested',globalFulfillment:'pending',requiredScopes:1,preparedScopes:0,
    scopes:[{scope:'identity-profile-v1',required:true,supported:true,status:'pending',receiptId:null,sha256:null,capturedAt:null,lastErrorCode:null,attempts:0}],
  });
  state.password='synthetic-proof'; state.factor='123456';
  return state;
}

test('hiding or leaving MFA setup prevents a late response from restoring its secret',async()=>{
  for(const leave of [false,true]) {
    let resolve;
    const state=securitySubject({setupMfa:()=>new Promise(done=>resolve=done)});
    try {
      const request=state.setupMfa();
      if(leave) state.selectTab('Perfil'); else state.hideSetup();
      resolve({otpauthUri:'test-only-secret',expiresInSeconds:60}); await request;
      assert.equal(state.setupUri(),''); assert.deepEqual(state.recoveryCodes(),[]);
      assert.equal(state.password,'');
    } finally {TestBed.resetTestingModule();}
  }
});

test('enabled MFA and its one-time codes remain confirmed when status refresh fails',async()=>{
  const state=securitySubject({enableMfa:async()=>({recoveryCodes:['synthetic-code']}),mfa:async()=>{throw new Error('Status unavailable');}});
  try {
    state.setupUri.set('test-only-uri');
    await state.enableMfa();
    assert.deepEqual(state.recoveryCodes(),['synthetic-code']);
    assert.match(state.message(),/2FA activada/);
    assert.match(state.mfaError(),/Status unavailable/);
    assert.equal(state.mfa(),null);
    assert.equal(state.error(),'');
    assert.equal(state.password,''); assert.equal(state.factor,'');
  } finally {TestBed.resetTestingModule();}
});

test('session revocation asks for confirmation, supports cancellation and then refreshes the real list',async()=>{
  const calls=[];
  const active={id:'session-active',createdAt:'2026-10-01T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z',revokedAt:null};
  const revoked={...active,revokedAt:'2026-10-28T00:00:00Z'};
  const state=securitySubject({revoke:async id=>{calls.push(['revoke',id]);},sessions:async()=>{calls.push(['sessions']);return {items:[revoked]};}});
  try {
    state.sessions.set([active]); state.sessionsLoaded.set(true);
    await state.revoke(active.id);
    assert.deepEqual(calls,[],'The first click only opens the confirmation state.');
    assert.equal(state.pendingSessionRevocation(),active.id);
    state.cancelSessionRevocation(active.id);
    assert.equal(state.pendingSessionRevocation(),'');
    await state.revoke(active.id);
    await state.revoke(active.id);
    assert.deepEqual(calls,[['revoke',active.id],['sessions']]);
    assert.equal(state.sessions()[0].revokedAt,revoked.revokedAt);
    assert.equal(state.pendingSessionRevocation(),'');
    assert.match(state.message(),/Sesión revocada/);
  } finally {TestBed.resetTestingModule();}
});

test('session revoke cannot target a missing or already revoked session and a server failure keeps confirmation retryable',async()=>{
  let calls=0;
  const state=securitySubject({revoke:async()=>{calls++;throw new Error('Session service unavailable');}});
  try {
    await state.revoke('missing');
    state.sessions.set([{id:'revoked-session',createdAt:'2026-10-01T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z',revokedAt:'2026-10-10T00:00:00Z'}]); state.sessionsLoaded.set(true);
    await state.revoke('revoked-session');
    assert.equal(calls,0);
    const active={id:'active-session',createdAt:'2026-10-01T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z',revokedAt:null};
    state.sessions.set([active]); state.sessionsLoaded.set(true);
    await state.revoke(active.id);
    await state.revoke(active.id);
    assert.equal(calls,1);
    assert.equal(state.pendingSessionRevocation(),active.id,'The user can retry or cancel after the endpoint rejects the change.');
    assert.match(state.error(),/Session service unavailable/);
  } finally {TestBed.resetTestingModule();}
});

test('a failed session refresh preserves stale rows but blocks session revocation until reconfirmed',async()=>{
  let revocations=0;
  const active={id:'session-stale',createdAt:'2026-10-01T00:00:00Z',expiresAt:'2026-11-01T00:00:00Z',revokedAt:null};
  const state=securitySubject({sessions:async()=>{throw new Error('Session list unavailable');},revoke:async()=>{revocations++;}});
  try {
    state.sessions.set([active]); state.sessionsLoaded.set(true);
    await state.loadSessions();
    assert.equal(state.sessions()[0].id,active.id,'The last confirmed row remains available for reference.');
    assert.equal(state.sessionsLoaded(),false);
    await state.revoke(active.id);
    assert.equal(revocations,0,'Stale session data cannot authorize a revocation.');
    assert.equal(state.pendingSessionRevocation(),'');
    assert.match(state.sessionsError(),/Session list unavailable/);
  } finally {TestBed.resetTestingModule();}
});

test('an accepted privacy request is not reported as failed when listing is unavailable',async()=>{
  let writes=0;
  const state=securitySubject({requestPrivacy:async()=>{writes++;},privacy:async()=>{throw new Error('List unavailable');}});
  try {
    await state.requestPrivacy();
    assert.equal(writes,1);
    assert.match(state.message(),/Solicitud de exportación registrada/);
    assert.match(state.privacyError(),/List unavailable/);
    assert.equal(state.privacyLoaded(),false);
    assert.equal(state.error(),'');
  } finally {TestBed.resetTestingModule();}
});

test('only pending export requests can prepare a partial contribution and completion never implies global purge',()=>{
  const state=securitySubject({});
  try {
    state.privacy.set([
      {id:'export-pending',kind:'export',state:'requested',createdAt:'2026-01-01T00:00:00Z'},
      {id:'export-processing',kind:'export',state:'processing',createdAt:'2026-01-01T00:00:00Z'},
      {id:'delete-pending',kind:'deletion',state:'requested',createdAt:'2026-01-01T00:00:00Z'},
      {id:'export-completed',kind:'export',state:'completed',createdAt:'2026-01-01T00:00:00Z'},
    ]);
    assert.deepEqual(state.exportablePrivacyRequests().map(item=>item.id),['export-pending','export-processing']);
    assert.match(state.privacyStateLabel('completed'),/purga global no verificada/);
    assert.equal(state.privacyKindLabel('deletion'),'Eliminación de datos');
  } finally {TestBed.resetTestingModule();}
});

test('Twitch link state comes from Identity and an unavailable configuration never enables OAuth',async()=>{
  let writes=0;
  const state=securitySubject({twitchLinkStatus:async()=>({configured:false,linked:false,account:null}),linkTwitch:async()=>{writes++;}});
  try {
    state.design=false;
    await state.loadTwitchLinkStatus();
    assert.equal(state.twitchStatusConfirmed(),true);
    assert.deepEqual(state.twitchStatus(),{configured:false,linked:false,account:null});
    await state.connectTwitch();
    assert.equal(writes,0);
  } finally { TestBed.resetTestingModule(); }
});

test('a failed Twitch status refresh is explicitly stale and cannot authorize a disconnect',async()=>{
  let fail=true,revocations=0;
  const state=securitySubject({twitchLinkStatus:async()=>{if(fail)throw new Error('Identity unavailable');return{configured:true,linked:true,account:{login:'creator'}};},unlinkTwitch:async()=>{revocations++;return{unlinked:true};}});
  try {
    state.design=false;
    state.twitchStatus.set({configured:true,linked:true,account:{login:'creator'}});
    state.twitchStatusConfirmed.set(true);
    await state.loadTwitchLinkStatus();
    assert.equal(state.twitchStatusConfirmed(),false);
    assert.match(state.twitchStatusError(),/Identity unavailable/);
    await state.disconnectTwitch();
    await state.disconnectTwitch();
    assert.equal(revocations,0);
    fail=false;
    await state.loadTwitchLinkStatus();
    assert.equal(state.twitchStatusConfirmed(),true);
    assert.equal(state.twitchStatus()?.linked,true);
  } finally { TestBed.resetTestingModule(); }
});

test('Twitch disconnect requires a second confirmation and reports only the provider result',async()=>{
  const calls=[];
  const state=securitySubject({twitchLinkStatus:async()=>({configured:true,linked:false,account:null}),unlinkTwitch:async()=>{calls.push('unlink');return{unlinked:true};}});
  try {
    state.design=false;
    state.twitchStatus.set({configured:true,linked:true,account:{login:'creator'}});
    state.twitchStatusConfirmed.set(true);
    await state.disconnectTwitch();
    assert.equal(state.twitchDisconnectConfirmation(),true);
    assert.deepEqual(calls,[]);
    await state.disconnectTwitch();
    assert.deepEqual(calls,['unlink']);
    assert.equal(state.twitchDisconnectConfirmation(),false);
    assert.equal(state.twitchStatusConfirmed(),true);
    assert.deepEqual(state.twitchStatus(),{configured:true,linked:false,account:null});
    assert.match(state.message(),/revocación del token en Twitch depende de la confirmación/);
  } finally { TestBed.resetTestingModule(); }
});

test('a rejected Twitch disconnect remains visible and retryable after status is reconfirmed',async()=>{
  let fail=true,calls=0,linked=true;
  const state=securitySubject({twitchLinkStatus:async()=>({configured:true,linked,account:linked?{login:'creator'}:null}),unlinkTwitch:async()=>{calls++;if(fail)throw new Error('Twitch unlink unavailable');linked=false;return{unlinked:true};}});
  try {
    state.design=false;
    state.twitchStatus.set({configured:true,linked:true,account:{login:'creator'}});
    state.twitchStatusConfirmed.set(true);
    await state.disconnectTwitch();
    await state.disconnectTwitch();
    assert.match(state.twitchStatusError(),/Twitch unlink unavailable/);
    assert.equal(state.twitchStatusConfirmed(),false);
    assert.equal(state.twitchStatus()?.linked,true,'The rejected write does not fabricate a disconnected state.');
    fail=false;
    await state.loadTwitchLinkStatus();
    await state.disconnectTwitch();
    await state.disconnectTwitch();
    assert.equal(calls,2);
    assert.equal(state.twitchStatus()?.linked,false);
  } finally { TestBed.resetTestingModule(); }
});

test('settings state that retention is undecided and describe only the confirmed failed-import cleanup bounds',()=>{
  const template=readFileSync(new URL('../../src/app/features/settings/pages/settings.component.html',import.meta.url),'utf8');
  assert.match(template,/no hay una política global aprobada/);
  assert.match(template,/al cumplir 30 días: hasta 50 filas por ejecución, cada minuto/);
  assert.match(template,/Importaciones exitosas o con un efecto de Twitch iniciado pueden permanecer sin plazo definido/);
  assert.match(template,/La limpieza operativa de cargas vencidas no elimina la cuenta ni constituye una purga global/);
  assert.match(template,/requerido y está disponible/);
  assert.match(template,/no hay\s+un ensamblado ni una descarga global disponibles/);
});

test('privacy refresh keeps an available export selection and resets a stale one to the first available request',async()=>{
  const request=(id,state='requested')=>({id,kind:'export',state,createdAt:'2026-01-01T00:00:00Z'});
  let items=[request('export-a'),request('export-b')];
  const state=securitySubject({privacy:async()=>({items})});
  try {
    await state.loadPrivacy();
    assert.equal(state.privacyExportRequestId(),'export-a','The first eligible request becomes the initial selection.');
    state.privacyExportRequestId.set('export-b');
    await state.loadPrivacy();
    assert.equal(state.privacyExportRequestId(),'export-b','A still eligible selection is preserved.');
    items=[request('export-a'),request('export-b','completed')];
    await state.loadPrivacy();
    assert.equal(state.privacyExportRequestId(),'export-a','A completed selection is replaced by an eligible request.');
    items=[request('export-b','completed')];
    await state.loadPrivacy();
    assert.equal(state.privacyExportRequestId(),'','No eligible request leaves the selection empty.');
  } finally {TestBed.resetTestingModule();}
});

test('privacy manifest is request-bound and exposes only required supported contribution scopes',async()=>{
  const manifest=(requestId,scopes)=>({requestId,kind:'export',requestState:'processing',globalFulfillment:'pending',requiredScopes:scopes.filter(item=>item.required).length,preparedScopes:0,scopes});
  const identity={scope:'identity-profile-v1',required:true,supported:true,status:'pending',receiptId:null,sha256:null,capturedAt:null,lastErrorCode:null,attempts:0};
  const billing={...identity,scope:'consumption-attribution-v1'};
  const optional={...identity,scope:'workspace-memberships-v1',required:false};
  const unavailable={...identity,scope:'analysis-attribution-v1',supported:false,status:'not_implemented'};
  const state=securitySubject({privacyManifest:async id=>manifest(id,id==='export-a'?[identity,billing,optional,unavailable]:[{...identity,scope:'media-task-attribution-v1'}])});
  try {
    state.privacy.set([
      {id:'export-a',kind:'export',state:'requested',createdAt:'2026-01-01T00:00:00Z'},
      {id:'export-b',kind:'export',state:'processing',createdAt:'2026-01-02T00:00:00Z'},
    ]);
    state.privacyExportRequestId.set('export-a');
    await state.loadPrivacyManifest();
    assert.deepEqual(state.availablePrivacyExportScopes().map(item=>state.privacyScopeKey(item.scope)),['identity','billing']);
    state.selectPrivacyExportScope('analysis');
    assert.equal(state.privacyExportScope(),'identity','Unsupported scopes cannot be selected.');
    state.selectPrivacyExportRequest('export-b');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.privacyManifest().requestId,'export-b');
    assert.equal(state.privacyExportScope(),'media','Changing requests selects only a scope in the new server manifest.');
  } finally {TestBed.resetTestingModule();}
});

test('privacy contribution client maps each supported scope to its published gateway route',async()=>{
  const calls=[];
  const api=Object.create(SettingsApi.prototype);
  Object.assign(api,{api:{post:async(...args)=>{calls.push(['post',...args]);return {requestId:'fixture'};},get:async(...args)=>{calls.push(['get',...args]);return {requestId:'fixture'};}}});
  for(const scope of ['identity','workspace','project','billing','media','analysis']) await api.privacyContribution('request/id',scope,{password:'proof'},'key');
  await api.privacyManifest('request/id');
  assert.deepEqual(calls.map(([method,path])=>[method,path]),[
    ['post','/auth/privacy-requests/request%2Fid/identity-export'],
    ['post','/auth/privacy-requests/request%2Fid/workspace-export'],
    ['post','/auth/privacy-requests/request%2Fid/project-export'],
    ['post','/auth/privacy-requests/request%2Fid/billing-export'],
    ['post','/auth/privacy-requests/request%2Fid/media-export'],
    ['post','/auth/privacy-requests/request%2Fid/analysis-export'],
    ['get','/auth/privacy-requests/request%2Fid/manifest'],
  ]);
});

test('privacy contribution prompt never suggests a duplicate request while the existing list is unconfirmed',()=>{
  const state=securitySubject({});
  try {
    assert.equal(state.privacyExportPrompt(),'unconfirmed');
    state.busy.set(true);
    assert.equal(state.privacyExportPrompt(),'loading');
    state.busy.set(false);
    state.privacyLoaded.set(true);
    state.privacyError.set('List unavailable');
    assert.equal(state.privacyExportPrompt(),'unconfirmed');
    state.privacyError.set('');
    assert.equal(state.privacyExportPrompt(),'empty');
  } finally {TestBed.resetTestingModule();}
});

test('partial privacy download keeps its object URL alive after the browser click',async()=>{
  const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalTimeout=globalThis.setTimeout,originalDocument=globalThis.document;
  const revocations=[];let clickRecord=null;let release=null;
  URL.createObjectURL=()=> 'blob:privacy-contribution';
  URL.revokeObjectURL=url=>revocations.push(url);
  globalThis.setTimeout=(callback,delay)=>{assert.equal(delay,60_000);release=callback;return 1;};
  const anchor={href:'',download:'',hidden:false,isConnected:false,click(){clickRecord={href:this.href,download:this.download,isConnected:this.isConnected};},remove(){this.isConnected=false;}};
  globalThis.document={createElement:tag=>{assert.equal(tag,'a');return anchor;},body:{appendChild(element){element.isConnected=true;}}};
  try {
    const result={requestId:'export-pending',state:'prepared',scope:'identity-profile-v1',fulfillment:'partial',globalFulfillment:'pending',receiptId:'receipt-fixture'};
    const state=securitySubject({privacyContribution:async()=>result});
    state.privacy.set([{id:'export-pending',kind:'export',state:'requested',createdAt:'2026-01-01T00:00:00Z'}]);
    await state.downloadPrivacyContribution();
    assert.equal(clickRecord.href,'blob:privacy-contribution');
    assert.equal(clickRecord.download,'autoclipper-identity-receipt-fixture.json');
    assert.equal(clickRecord.isConnected,true,'The download link is attached while clicked.');
    assert.deepEqual(revocations,[],'The browser gets time to begin the download.');
    assert.match(state.privacyContributionMessage(),/aporte parcial descargado/i);
    release();
    assert.deepEqual(revocations,['blob:privacy-contribution']);
  } finally {
    URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;globalThis.setTimeout=originalTimeout;
    if(originalDocument===undefined) delete globalThis.document; else globalThis.document=originalDocument;
    TestBed.resetTestingModule();
  }
});

test('privacy contribution cannot start in design mode or overlap another protected operation',async()=>{
  let writes=0, rejectRequest;
  const state=securitySubject({privacyContribution:()=>{writes++;return new Promise((_resolve,reject)=>rejectRequest=reject);}});
  try {
    state.privacy.set([{id:'export-pending',kind:'export',state:'requested',createdAt:'2026-01-01T00:00:00Z'}]);
    state.design=true;
    await state.downloadPrivacyContribution();
    assert.equal(writes,0);
    state.design=false;
    state.busy.set(true);
    await state.downloadPrivacyContribution();
    assert.equal(writes,0);
    state.busy.set(false);

    const first=state.downloadPrivacyContribution();
    assert.equal(state.privacyContributionBusy(),true);
    assert.equal(state.busy(),true,'The contribution also locks other protected account operations.');
    let competingWrites=0;
    await state.run(async()=>{competingWrites++;});
    assert.equal(competingWrites,0,'A profile or security mutation cannot overlap the contribution proof.');
    await state.downloadPrivacyContribution();
    assert.equal(writes,1,'A repeated invocation must not start a second contribution request.');
    rejectRequest(new Error('temporary provider failure'));
    await first;
    assert.equal(state.privacyContributionBusy(),false);
    assert.equal(state.busy(),false);
  } finally { TestBed.resetTestingModule(); }
});

test('a late privacy contribution response does not start a download after leaving Settings',async()=>{
  const originalCreate=URL.createObjectURL,originalDocument=globalThis.document;
  let resolve,clicks=0,objectUrls=0;
  URL.createObjectURL=()=>{objectUrls++;return 'blob:late-contribution';};
  globalThis.document={createElement:()=>({click(){clicks++;},remove(){}}),body:{appendChild(){}}};
  try {
    const result={requestId:'export-pending',state:'prepared',scope:'identity-profile-v1',fulfillment:'partial',globalFulfillment:'pending',receiptId:'late'};
    const state=securitySubject({privacyContribution:()=>new Promise(done=>resolve=done)});
    state.privacy.set([{id:'export-pending',kind:'export',state:'requested',createdAt:'2026-01-01T00:00:00Z'}]);
    const request=state.downloadPrivacyContribution();
    state.alive=false;
    resolve(result);
    await request;
    assert.equal(objectUrls,0);
    assert.equal(clicks,0);
  } finally {
    URL.createObjectURL=originalCreate;
    if(originalDocument===undefined) delete globalThis.document; else globalThis.document=originalDocument;
    TestBed.resetTestingModule();
  }
});

test('unknown MFA status blocks setup and privacy proof until explicitly refreshed',async()=>{
  let writes=0;
  const state=securitySubject({setupMfa:async()=>{writes++;},requestPrivacy:async()=>{writes++;}});
  try {
    state.mfa.set(null);
    await state.setupMfa(); await state.requestPrivacy();
    assert.equal(writes,0);
  } finally {TestBed.resetTestingModule();}
});


test('leaving Security discards late recovery codes without repeating a completed MFA mutation',async()=>{
  for(const method of ['enableMfa','rotateCodes']) {
    let resolve; let calls=0;
    const api={mfa:async()=>({enabled:true,recoveryCodesRemaining:8})};
    api[method]=()=>{calls++;return new Promise(done=>resolve=done);};
    const state=securitySubject(api);
    try {
      state.setupUri.set(method==='enableMfa'?'test-only-uri':'');
      if(method==='rotateCodes') state.mfa.set({enabled:true,recoveryCodesRemaining:2});
      const request=state[method]();
      state.selectTab('Perfil');
      resolve({enabled:true,recoveryCodes:['synthetic-late-code']}); await request;
      assert.equal(calls,1);
      assert.deepEqual(state.recoveryCodes(),[]);
      assert.equal(state.setupUri(),'');
      assert.equal(state.password,'');
    } finally {TestBed.resetTestingModule();}
  }
});


test('account rail accepts vertical arrows and clears sensitive proof when leaving Security',()=>{
  const state=securitySubject({});
  const previous=globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame=()=>1;
  try {
    state.recoveryCodes.set(['synthetic-visible-code']);
    let prevented=0;
    state.onTabKeydown({key:'ArrowDown',preventDefault(){prevented++;}},2);
    assert.equal(state.tab(),'Privacidad'); assert.equal(state.password,''); assert.equal(state.factor,''); assert.deepEqual(state.recoveryCodes(),[]);
    state.onTabKeydown({key:'ArrowDown',preventDefault(){prevented++;}},3);
    assert.equal(state.tab(),'Perfil');
    state.onTabKeydown({key:'ArrowUp',preventDefault(){prevented++;}},0);
    assert.equal(state.tab(),'Privacidad'); assert.equal(prevented,3);
  } finally {
    if(previous)globalThis.requestAnimationFrame=previous;else delete globalThis.requestAnimationFrame;
    TestBed.resetTestingModule();
  }
});
