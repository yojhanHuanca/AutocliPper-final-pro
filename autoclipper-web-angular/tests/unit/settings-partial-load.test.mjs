import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute } from '@angular/router';
import { SettingsComponent, SettingsApi, DESIGN_MODE, SessionStore } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('settings keeps successful account sections available when one endpoint fails', async () => {
  const profile={id:'user-1',email:'qa@example.test',name:'QA',version:2,preferences:{timezone:'America/Lima'}};
  const mfa={enabled:false,recoveryCodesRemaining:0};
  const api={profile:async()=>profile,mfa:async()=>mfa,privacy:async()=>{throw new Error('Privacy endpoint unavailable');},sessions:async()=>({items:[{id:'session-1',createdAt:'2026-01-01T00:00:00Z',expiresAt:'2026-01-02T00:00:00Z',revokedAt:null}]})};
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
    assert.equal(state.sessions().length,1);
    assert.deepEqual(state.privacy(),[]);
    assert.match(state.error(),/privacidad/);
    assert.equal(state.busy(),false);
  } finally { TestBed.resetTestingModule(); }
});
