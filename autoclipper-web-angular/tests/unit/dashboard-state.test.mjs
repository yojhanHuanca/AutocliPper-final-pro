import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { DashboardState, ProjectsApi, ConsumptionApi, WorkspaceStore } from '../../.local/tests/client.mjs';
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
const project=(id,workspaceId='alpha',day=1)=>({id,workspaceId,name:id,version:1,createdAt:`2026-10-${String(day).padStart(2,'0')}T00:00:00.000Z`});
const usage=id=>({workspaceId:id,consumedSeconds:40,reservedSeconds:0,availableSeconds:3560});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{resolve,promise};};
function setup(api,billing={overview:async id=>usage(id)}) {
 const workspace={workspaceId:signal('alpha')};
 TestBed.configureTestingModule({providers:[DashboardState,{provide:ProjectsApi,useValue:api},{provide:ConsumptionApi,useValue:billing},{provide:WorkspaceStore,useValue:workspace},{provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}}]});
 return {state:TestBed.inject(DashboardState),workspace};
}

test('home bounds reads to four recent projects and three distinct draft sources, keeping real links and dates',async()=>{
 const calls=[];
 const projects=Array.from({length:7},(_,i)=>project('project-'+i,'alpha',i+1));
 const api={list:async()=>({items:projects}),edits:async id=>{calls.push(['edits',id]);return {items:[{id:'draft-'+id,uploadId:'source-'+id,name:id,version:2,updatedAt:projects.find(p=>p.id===id).createdAt}]};},upload:async id=>{calls.push(['upload',id]);return {id,projectId:id.replace('source-',''),state:'confirmed',bytes:123,inspection:{status:'succeeded',result:{durationSeconds:8}}};}};
 const {state}=setup(api);
 try {
  await state.load('alpha');
  assert.deepEqual(calls.filter(c=>c[0]==='edits').map(c=>c[1]),['project-6','project-5','project-4','project-3']);
  assert.equal(calls.filter(c=>c[0]==='upload').length,3);
  assert.equal(state.drafts()[0].projectId,'project-6');
  assert.equal(state.drafts()[0].version,2);
  assert.equal(state.sources().length,3);
  assert.equal(state.projects().length,7);
  assert.equal(state.usage().consumedSeconds,40);
  assert.equal(state.loading(),false);
 } finally {TestBed.resetTestingModule();}
});

test('an unavailable consumption route preserves projects and successful draft reads without inventing totals',async()=>{
 const api={list:async()=>({items:[project('a'),project('b')]}),edits:async id=>{if(id==='b')throw {status:503};return {items:[]};}};
 const {state}=setup(api,{overview:async()=>{throw {status:404};}});
 try {
  await state.load('alpha');
  assert.equal(state.projects().length,2); assert.equal(state.usage(),null);
  assert.notEqual(state.usageError(),''); assert.notEqual(state.draftsError(),'');
  assert.deepEqual(state.sources(),[]); assert.equal(state.detailsLoaded(),true);
 } finally {TestBed.resetTestingModule();}
});

test('denied draft or source access clears every project, draft and consumption from the home',async()=>{
 for(const phase of ['drafts','source']) {
  const api={list:async()=>({items:[project('a')]}),edits:async()=>{if(phase==='drafts')throw {status:403};return {items:[{id:'d',uploadId:'u',name:'d',version:1,updatedAt:'2026-10-18T00:00:00.000Z'}]};},upload:async()=>{throw {status:401};}};
  const {state}=setup(api);
  try {await state.load('alpha');assert.deepEqual(state.projects(),[]);assert.deepEqual(state.drafts(),[]);assert.equal(state.usage(),null);assert.notEqual(state.error(),'');assert.equal(state.denied(),true);}
  finally {TestBed.resetTestingModule();}
 }
});

test('late workspace responses cannot repopulate another workspace and empty selection makes no reads',async()=>{
 const pending=deferred(); const calls=[];
 const api={list:async id=>{calls.push(id);return id==='alpha'?pending.promise:{items:[]};},edits:async()=>({items:[]})};
 const {state,workspace}=setup(api);
 try {
  const first=state.load('alpha'); workspace.workspaceId.set('beta'); await state.load('beta');
  pending.resolve({items:[project('old')]}); await first;
  assert.deepEqual(state.projects(),[]);assert.equal(state.usage().workspaceId,'beta');
  workspace.workspaceId.set(''); await state.load('');
  assert.deepEqual(calls,['alpha','beta']);assert.equal(state.usage(),null);
 } finally {TestBed.resetTestingModule();}
});

test('a source with the wrong project provenance is excluded rather than shown as owned material',async()=>{
 const api={list:async()=>({items:[project('a')]}),edits:async()=>({items:[{id:'d',uploadId:'u',name:'d',version:1,updatedAt:'2026-10-18T00:00:00.000Z'}]}),upload:async()=>({id:'u',projectId:'other-project',state:'confirmed',bytes:999})};
 const {state}=setup(api);
 try {await state.load('alpha');assert.deepEqual(state.sources(),[]);assert.notEqual(state.sourcesError(),'');assert.equal(state.drafts().length,1);}
 finally {TestBed.resetTestingModule();}
});
