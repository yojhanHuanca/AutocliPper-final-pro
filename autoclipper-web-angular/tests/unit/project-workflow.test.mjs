import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectComponent, ProjectsApi, WorkspaceStore, SessionStore, uploadContentType } from '../../.local/tests/client.mjs';
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('upload validation accepts missing Windows MIME only for supported extensions and enforces byte limits', () => {
  assert.equal(uploadContentType({name:'grabacion.MKV',type:'',size:100}), 'video/x-matroska');
  assert.equal(uploadContentType({name:'clip',type:'video/mp4',size:100*1024*1024}), 'video/mp4');
  for (const file of [
    {name:'v.mp4',type:'video/mp4',size:0},
    {name:'v.mp4',type:'video/mp4',size:100*1024*1024+1},
    {name:'v.exe',type:'',size:100},
    {name:'v.mp4',type:'application/octet-stream',size:100},
  ]) assert.throws(()=>uploadContentType(file));
});

test('changing upload or pipeline ignores stale requests and only links transcripts created for the selected upload', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = new Map();
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
  let resolveUpload, resolvePipeline, creates=0, failPipeline=false;
  const pipelineKeys=[];
  const upload = {id:'upload-b',projectId:'project',state:'confirmed',bytes:100,inspection:{status:'succeeded'}};
  const pipeline = {id:'pipeline-b',status:'succeeded',analysisId:'analysis-b',events:[]};
  const api = {
    get:async()=>({id:'project',workspaceId:'workspace'}), edits:async()=>({items:[]}),
    upload:id=>id==='upload-a'?new Promise(resolve=>resolveUpload=resolve):Promise.resolve({...upload,id}),
    pipeline:id=>id==='pipeline-a'?new Promise(resolve=>resolvePipeline=resolve):Promise.resolve(pipeline),
    createPipeline:async(id,body,key)=>{ pipelineKeys.push(key); if(failPipeline) throw new Error('Explicit network failure fixture'); return pipeline; },
    createEdit:async()=>{creates++;return {id:'edit'};},
  };
  TestBed.configureTestingModule({providers:[
    {provide:ProjectsApi,useValue:api},{provide:WorkspaceStore,useValue:{workspaces:()=>[{id:'workspace',role:'owner'}]}},
    {provide:SessionStore,useValue:{user:()=>({id:'qa'})}},
    {provide:ActivatedRoute,useValue:{snapshot:{paramMap:new Map([['id','project']])}}},
    {provide:Router,useValue:{navigate:async()=>true}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  try {
    const state=TestBed.runInInjectionContext(()=>new ProjectComponent());
    await new Promise(resolve=>setImmediate(resolve));
    state.selectUpload('upload-a'); const oldUpload=state.inspect();
    state.selectUpload('upload-b');
    resolveUpload({...upload,id:'upload-a'}); await oldUpload;
    assert.equal(state.uploadStatus(),null);
    assert.equal(state.inspected(),false);
    await state.inspect(); assert.equal(state.inspected(),true);
    state.selectPipeline('pipeline-a'); const oldPipeline=state.pollPipeline();
    state.selectPipeline('pipeline-b'); resolvePipeline({...pipeline,id:'pipeline-a'}); await oldPipeline;
    assert.equal(state.pipeline(),null);
    await state.pollPipeline(); assert.equal(state.hasLinkedTranscript(),false);
    await state.startPipeline(); assert.equal(state.hasLinkedTranscript(),true);
    state.selectUpload('upload-c');
    assert.equal(state.inspected(),false); assert.equal(state.hasLinkedTranscript(),false);
    await state.createEdit(); assert.equal(creates,0);
    state.selectUpload('upload-b'); await state.inspect();
    assert.equal(state.hasLinkedTranscript(),true);
    state.selectPipeline('pipeline-b'); await state.pollPipeline();
    assert.equal(state.hasLinkedTranscript(),false,'Manual pipeline lookup cannot invent upload provenance.');
    failPipeline=true;
    await state.startPipeline(); await state.startPipeline();
    assert.equal(pipelineKeys.at(-1),pipelineKeys.at(-2),'Retrying the same upload/body preserves idempotency.');
    const previousKey=pipelineKeys.at(-1);
    state.selectUpload('upload-c'); await state.inspect(); await state.startPipeline();
    assert.notEqual(pipelineKeys.at(-1),previousKey,'A different upload must start a distinct intent.');
  } finally {
    TestBed.resetTestingModule();
    if(originalStorage) Object.defineProperty(globalThis,'sessionStorage',originalStorage);
    else delete globalThis.sessionStorage;
  }
});
