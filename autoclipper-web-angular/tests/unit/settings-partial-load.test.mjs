import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
