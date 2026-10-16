import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { HttpErrorResponse, SessionStore, ApiSecurity, ApiTransport, sessionGuard } from '../../.local/tests/client.mjs';
import { Router } from '@angular/router';
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const renderer = {insertRootElement(){}, removeAllRootElements(){}};

test('session restore sends only expired sessions to login and surfaces network failures separately', async () => {
  let calls=0, refreshes=0;
  TestBed.configureTestingModule({providers:[
    SessionStore,
    {provide:TestComponentRenderer,useValue:renderer},
    {provide:ApiSecurity,useValue:{refresh:async()=>{refreshes++;throw new HttpErrorResponse({status:401});},clear(){}}},
    {provide:ApiTransport,useValue:{get:async()=>{calls++;throw new HttpErrorResponse({status:503});}}},
  ]});
  try {
    const state=TestBed.inject(SessionStore);
    await assert.rejects(state.restore(), error=>error instanceof HttpErrorResponse && error.status===503);
    assert.equal(state.user(),null);
    assert.equal(refreshes,0,'A network/server failure must not be treated as session expiry.');
    await assert.rejects(state.restore(), error=>error instanceof HttpErrorResponse && error.status===503);
    assert.equal(calls,2,'Failed restores release the shared in-flight promise for a retry.');
  } finally { TestBed.resetTestingModule(); }
  TestBed.configureTestingModule({providers:[
    SessionStore,
    {provide:TestComponentRenderer,useValue:renderer},
    {provide:ApiSecurity,useValue:{refresh:async()=>{throw new HttpErrorResponse({status:401});},clear(){}}},
    {provide:ApiTransport,useValue:{get:async()=>{throw new HttpErrorResponse({status:401});}}},
  ]});
  try { assert.equal(await TestBed.inject(SessionStore).restore(),false); }
  finally { TestBed.resetTestingModule(); }
});

test('guard preserves the destination and identifies an unavailable session service', async () => {
  const destination={url:'/app/consumption?period=current'};
  TestBed.configureTestingModule({providers:[
    {provide:SessionStore,useValue:{restore:async()=>{throw new Error('unavailable');}}},
    {provide:TestComponentRenderer,useValue:renderer},
    {provide:Router,useValue:{createUrlTree:(commands,options)=>({commands,options})}},
  ]});
  try {
    const result=await TestBed.runInInjectionContext(()=>sessionGuard({},destination));
    assert.deepEqual(result,{commands:['/login'],options:{queryParams:{returnUrl:destination.url,connection:'unavailable'}}});
  } finally { TestBed.resetTestingModule(); }
});
