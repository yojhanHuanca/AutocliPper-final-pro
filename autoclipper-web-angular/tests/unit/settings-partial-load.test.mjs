import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute } from '@angular/router';
import { SettingsComponent, SettingsApi, DESIGN_MODE, SessionStore } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('settings keeps successful account sections and localizes session and privacy states', async () => {
  const profile={id:'user-1',email:'qa@example.test',name:'QA',version:2,preferences:{timezone:'America/Lima',emailNotifications:false,locale:'es',theme:'light'}};
  const mfa={enabled:false,recoveryCodesRemaining:0};
  const api={profile:async()=>profile,mfa:async()=>mfa,privacy:async()=>{throw new Error('Privacy endpoint unavailable');},sessions:async()=>{throw new Error('Session endpoint unavailable');}};
  TestBed.configureTestingModule({providers:[
    SettingsComponent,
    {provide:SettingsApi,useValue:api},{provide:DESIGN_MODE,useValue:false},
    {provide:SessionStore,useValue:{user:{set(){},}}},
    {provide:ActivatedRoute,useValue:{snapshot:{}}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  try {
    const state=TestBed.inject(SettingsComponent);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(state.profile(),profile);
    assert.deepEqual(state.mfa(),mfa);
    assert.equal(state.sessions().length,0);
    assert.equal(state.emailNotifications,false);
    assert.match(state.sessionsError(),/Session endpoint unavailable/);
    assert.equal(state.privacyKindLabel('export'),'Exportación de datos');
    assert.equal(state.privacyStateLabel('requested'),'Registrada · ejecución pendiente');
    assert.deepEqual(state.privacy(),[]);
    assert.match(state.error(),/privacidad/);
    assert.equal(state.busy(),false);
  } finally { TestBed.resetTestingModule(); }
});

function securitySubject(api) {
  TestBed.configureTestingModule({providers:[
    SettingsComponent,{provide:SettingsApi,useValue:api},{provide:DESIGN_MODE,useValue:true},
    {provide:SessionStore,useValue:{user:signal(null)}},
    {provide:ActivatedRoute,useValue:{snapshot:{}}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  const state=TestBed.inject(SettingsComponent);
  state.design=false; state.tab.set('Seguridad'); state.mfa.set({enabled:false,recoveryCodesRemaining:0});
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

test('an accepted privacy request is not reported as failed when listing is unavailable',async()=>{
  let writes=0;
  const state=securitySubject({requestPrivacy:async()=>{writes++;},privacy:async()=>{throw new Error('List unavailable');}});
  try {
    await state.requestPrivacy();
    assert.equal(writes,1);
    assert.match(state.message(),/Solicitud registrada/);
    assert.match(state.privacyError(),/List unavailable/);
    assert.equal(state.privacyLoaded(),false);
    assert.equal(state.error(),'');
  } finally {TestBed.resetTestingModule();}
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
    state.onTabKeydown({key:'ArrowDown',preventDefault(){prevented++;}},1);
    assert.equal(state.tab(),'Privacidad'); assert.equal(state.password,''); assert.equal(state.factor,''); assert.deepEqual(state.recoveryCodes(),[]);
    state.onTabKeydown({key:'ArrowDown',preventDefault(){prevented++;}},2);
    assert.equal(state.tab(),'Perfil');
    state.onTabKeydown({key:'ArrowUp',preventDefault(){prevented++;}},0);
    assert.equal(state.tab(),'Privacidad'); assert.equal(prevented,3);
  } finally {
    if(previous)globalThis.requestAnimationFrame=previous;else delete globalThis.requestAnimationFrame;
    TestBed.resetTestingModule();
  }
});
