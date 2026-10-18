import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { signal } from '@angular/core';
import { ProjectComponent, ProjectsApi, WorkspaceStore, SessionStore, uploadContentType, HttpErrorResponse, DESIGN_MODE } from '../../.local/tests/client.mjs';
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

async function handoffSetup({role='editor',design=false}={}) {
  const params=new BehaviorSubject(new Map([['id','project-fixture']]));
  const memberships=signal([{id:'workspace-fixture',role}]);
  const calls={writes:[],navigations:[],reads:[],aborts:[],pipelines:[]};
  const control={navigate:false,navigationError:false,projectError:null,listError:null,pendingDraft:null,createError:null};
  const api={
    get:async id=>{calls.reads.push(['project',id]);if(control.projectError)throw control.projectError;return{id,name:'Proyecto de prueba',workspaceId:'workspace-fixture'};},
    edits:async id=>{calls.reads.push(['edits',id]);if(control.listError)throw control.listError;return{items:[]};},
    upload:async id=>({id,projectId:'project-fixture',state:'confirmed',inspection:{status:'succeeded',result:{durationSeconds:20}}}),
    createEdit:async(uploadId,body,key)=>{calls.writes.push({uploadId,body:structuredClone(body),key});if(control.pendingDraft)await control.pendingDraft;if(control.createError)throw control.createError;return{id:'draft-fixture',projectId:'project-fixture',uploadId,name:body.name,version:1,revision:{id:'revision-fixture',version:1,spec:structuredClone(body.spec)}};},
    abortUpload:async id=>{calls.aborts.push(id);},cancelPipeline:async id=>{calls.aborts.push(id);},
    createPipeline:async(...args)=>{calls.pipelines.push(args);},uploadFile:async()=>{calls.writes.push('upload');},
  };
  TestBed.configureTestingModule({providers:[
    {provide:ProjectsApi,useValue:api},{provide:WorkspaceStore,useValue:{loaded:()=>true,workspaces:memberships}},
    {provide:SessionStore,useValue:{user:()=>null}},{provide:DESIGN_MODE,useValue:design},
    {provide:ActivatedRoute,useValue:{snapshot:{paramMap:new Map([['id','project-fixture']])},paramMap:params}},
    {provide:Router,useValue:{navigate:async route=>{calls.navigations.push(route);if(control.navigationError)throw new Error('Fixture de navegación');return control.navigate;}}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  const state=TestBed.runInInjectionContext(()=>new ProjectComponent());
  for(let n=0;n<40&&state.busy();n++)await new Promise(resolve=>setImmediate(resolve));
  if(!design){state.selectUpload('upload-fixture');await state.inspect();}
  return{state,api,calls,control,params,memberships};
}

test('a created draft survives cancelled or failed navigation and reopens without creating another draft',async()=>{
  try {
    const {state,calls,control}=await handoffSetup();await state.createEdit();
    assert.equal(calls.writes.length,1);assert.equal(state.createdDraft().id,'draft-fixture');assert.match(state.handoffNotice(),/no se abrió/);
    assert.equal(state.hasReusableDraft(),true);await state.createEdit();assert.equal(calls.writes.length,1);assert.equal(calls.navigations.length,2);
    control.navigationError=true;await state.openCreatedDraft();assert.match(state.handoffNotice(),/vuelve a intentarlo/);assert.equal(calls.writes.length,1);
    control.navigationError=false;control.navigate=true;await state.openCreatedDraft();assert.equal(state.handoffNotice(),'');
    state.endSeconds=15;assert.equal(state.hasReusableDraft(),false);await state.createEdit();
    assert.equal(calls.writes.length,2);assert.notEqual(calls.writes[0].key,calls.writes[1].key);
  } finally {TestBed.resetTestingModule();}
});

test('an uncertain draft creation reuses its key and a response from a previous source never navigates automatically',async()=>{
  try {
    const {state,calls,control}=await handoffSetup();control.createError=new HttpErrorResponse({status:0});await state.createEdit();
    control.createError=null;let finish;control.pendingDraft=new Promise(resolve=>finish=resolve);
    const pending=state.createEdit();state.selectUpload('other-upload');finish();await pending;
    assert.equal(calls.writes[0].key,calls.writes[1].key);assert.equal(calls.navigations.length,0);
    assert.equal(state.createdDraft().uploadId,'upload-fixture');assert.match(state.handoffNotice(),/carga anterior/);
  } finally {TestBed.resetTestingModule();}
});

test('failed draft-list reads preserve known rows and source state; retry is independent of the upload and pipeline',async()=>{
  try {
    const {state,calls,control}=await handoffSetup();state.edits.set([{id:'known-draft'}]);
    control.listError=new HttpErrorResponse({status:0});await state.reloadEdits();
    assert.match(state.editsError(),/No se pudieron cargar/);assert.equal(state.edits()[0].id,'known-draft');
    assert.equal(state.uploadId,'upload-fixture');assert.equal(state.inspected(),true);
    control.listError=null;const projectReads=calls.reads.filter(([kind])=>kind==='project').length;await state.reloadEdits();
    assert.equal(state.editsError(),'');assert.equal(state.editsLoaded(),true);assert.deepEqual(state.edits(),[]);
    assert.equal(calls.reads.filter(([kind])=>kind==='project').length,projectReads);assert.equal(state.uploadId,'upload-fixture');
  } finally {TestBed.resetTestingModule();}
});

test('project access denial clears stale project content, draft receipt and source references',async()=>{
  for(const method of ['reload','reloadEdits']) {
  try {
    const {state,control}=await handoffSetup();await state.createEdit();state.edits.set([{id:'known-draft'}]);
    if(method==='reload')control.projectError=new HttpErrorResponse({status:403});else control.listError=new HttpErrorResponse({status:403});
    await state[method]();
    assert.equal(state.project(),null);assert.deepEqual(state.edits(),[]);assert.equal(state.createdDraft(),null);
    assert.equal(state.uploadStatus(),null);assert.equal(state.uploadId,'');assert.equal(state.canEdit(),false);assert.equal(state.editsLoaded(),false);
  } finally {TestBed.resetTestingModule();}
  }
});

test('reader and public design mode cannot invoke project mutations even when methods are called directly',async()=>{
  try {
    const {state,calls}=await handoffSetup({role:'reader'});state.file={name:'fixture.mp4'};
    state.setIntervalField('startSeconds',5);assert.equal(state.startSeconds,0);
    await state.upload();await state.startPipeline();await state.createEdit();await state.abortUpload();await state.cancelPipeline();
    assert.equal(calls.writes.length,0);assert.equal(calls.pipelines.length,0);assert.equal(calls.aborts.length,0);
    await state.reloadEdits();assert.equal(state.editsLoaded(),true);
  } finally {TestBed.resetTestingModule();}
  try {
    const {state,calls}=await handoffSetup({design:true});state.uploadId='fixture';state.pipelineId='fixture';
    await state.inspect();await state.pollPipeline();await state.reloadEdits();await state.createEdit();
    assert.deepEqual(calls.reads,[]);assert.deepEqual(calls.writes,[]);assert.equal(state.canEdit(),false);
  } finally {TestBed.resetTestingModule();}
});

test('a draft response for a previous project cannot publish a handoff or navigate in the new project',async()=>{
  try {
    const {state,calls,control,params}=await handoffSetup();let finish;control.pendingDraft=new Promise(resolve=>finish=resolve);
    const pending=state.createEdit();params.next(new Map([['id','next-project']]));finish();await pending;
    assert.equal(state.createdDraft(),null);assert.equal(calls.navigations.length,0);
  } finally {TestBed.resetTestingModule();}
});

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

test('cancellation before or during hashing never allocates a server upload intent',async()=>{
  const api=Object.create(ProjectsApi.prototype);let calls=0;api.api={post:async()=>{calls++;}};
  const file=Object.assign(new Blob(['x'],{type:'video/mp4'}),{name:'fixture.mp4'});
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(api.uploadFile('project',file,()=>{},()=>{},cancelled.signal),error=>error.name==='AbortError');
  let finishRead;const readingFile={name:'fixture.mp4',type:'video/mp4',size:1,arrayBuffer:()=>new Promise(resolve=>finishRead=resolve)};
  const controller=new AbortController();const pending=api.uploadFile('project',readingFile,()=>{},()=>{},controller.signal);
  controller.abort();finishRead(new Uint8Array([1]).buffer);
  await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls,0);
});

test('an intent accepted after cancellation is released before PUT or confirmation; failed release is explicit',async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{assert.fail('No storage request may start after cancellation.');};
  try {
    for(const failRelease of [false,true]) {
      let finishIntent,notifyIntent;const started=new Promise(resolve=>notifyIntent=resolve);const calls=[];
      const api=Object.create(ProjectsApi.prototype);
      api.api={post:async path=>{calls.push(path);notifyIntent();return new Promise(resolve=>finishIntent=resolve);},delete:async path=>{calls.push(path);if(failRelease)throw new Error('Fixture cleanup failure');}};
      const file=Object.assign(new Blob(['x'],{type:'video/mp4'}),{name:'fixture.mp4'});const controller=new AbortController();
      const remembered=[];const pending=api.uploadFile('project',file,()=>{},id=>remembered.push(id),controller.signal);
      await started;controller.abort();finishIntent({id:'late-upload',url:'https://media.example.test/put',headers:{}});
      if(failRelease)await assert.rejects(pending,/no pudimos liberar la carga late-upload/);
      else await assert.rejects(pending,error=>error.name==='AbortError');
      assert.deepEqual(calls,['/projects/project/uploads','/uploads/late-upload']);assert.deepEqual(remembered,['late-upload']);
    }
  } finally {globalThis.fetch=originalFetch;}
});

test('changing upload or pipeline ignores stale requests and only links transcripts created for the selected upload', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = new Map();
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
  let resolveUpload, resolvePipeline, creates=0, failPipeline=false;
  const params = new BehaviorSubject(new Map([['id','project']]));
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
    {provide:ProjectsApi,useValue:api},{provide:WorkspaceStore,useValue:{workspaces:()=>[{id:'workspace',role:'owner'}],loaded:()=>true}},
    {provide:SessionStore,useValue:{user:()=>({id:'qa'})}},
    {provide:ActivatedRoute,useValue:{snapshot:{paramMap:new Map([['id','project']])},paramMap:params}},
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
    assert.equal(state.workflowStatus('render'),'Vínculo no confirmado','a pipeline ID from storage cannot be presented as the selected source output');
    await state.startPipeline(); assert.equal(state.hasLinkedTranscript(),true);
    assert.equal(state.workflowStatus('render'),'MP4 disponible');
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

test('reused project detail resets its ID and ignores responses from the previous project', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem:()=>null, setItem(){} } });
  const params = new BehaviorSubject(new Map([['id','project-a']]));
  let resolveOldProject, resolveOldEdits;
  const api = {
    get:id=>id==='project-a'?new Promise(resolve=>resolveOldProject=resolve):Promise.resolve({id,workspaceId:'workspace'}),
    edits:id=>id==='project-a'?new Promise(resolve=>resolveOldEdits=resolve):Promise.resolve({items:[{id:'edit-b'}]}),
  };
  TestBed.configureTestingModule({providers:[
    {provide:ProjectsApi,useValue:api},
    {provide:WorkspaceStore,useValue:{workspaces:()=>[{id:'workspace',role:'owner'}],loaded:()=>true}},
    {provide:SessionStore,useValue:{user:()=>({id:'qa'})}},
    {provide:ActivatedRoute,useValue:{snapshot:{paramMap:new Map([['id','project-a']])},paramMap:params}},
    {provide:Router,useValue:{navigate:async()=>true}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  try {
    const state=TestBed.runInInjectionContext(()=>new ProjectComponent());
    params.next(new Map([['id','project-b']]));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.id,'project-b');
    assert.equal(state.project()?.id,'project-b');
    assert.deepEqual(state.edits().map(edit=>edit.id),['edit-b']);
    state.selectUpload('upload-b');
    resolveOldProject({id:'project-a',workspaceId:'workspace'});
    resolveOldEdits({items:[{id:'edit-a'}]});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.id,'project-b');
    assert.equal(state.project()?.id,'project-b');
    assert.deepEqual(state.edits().map(edit=>edit.id),['edit-b']);
    assert.equal(state.uploadId,'upload-b');
  } finally {
    TestBed.resetTestingModule();
    if(originalStorage) Object.defineProperty(globalThis,'sessionStorage',originalStorage);
    else delete globalThis.sessionStorage;
  }
});

test('manual pipeline interval is constrained to the inspected source duration', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>null,setItem(){}}});
  const params=new BehaviorSubject(new Map([['id','project']]));
  let submitted=0;
  const api={
    get:async()=>({id:'project',workspaceId:'workspace'}),edits:async()=>({items:[]}),
    upload:async id=>({id,projectId:'project',state:'confirmed',bytes:100,inspection:{status:'succeeded',result:{durationSeconds:14}}}),
    createPipeline:async()=>{submitted++;return{id:'pipeline',status:'queued'};},
  };
  TestBed.configureTestingModule({providers:[
    {provide:ProjectsApi,useValue:api},
    {provide:WorkspaceStore,useValue:{workspaces:()=>[{id:'workspace',role:'owner'}],loaded:()=>true}},
    {provide:SessionStore,useValue:{user:()=>({id:'qa'})}},
    {provide:ActivatedRoute,useValue:{snapshot:{paramMap:new Map([['id','project']])},paramMap:params}},
    {provide:Router,useValue:{navigate:async()=>true}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  try {
    const state=TestBed.runInInjectionContext(()=>new ProjectComponent());
    await new Promise(resolve=>setImmediate(resolve));
    state.selectUpload('upload-short');
    assert.equal(state.sourceDurationSeconds(),null,'uninspected files have no measured duration');
    await state.inspect();
    assert.equal(state.sourceDurationSeconds(),14);
    assert.equal(state.workflowStatus('source'),'Listo');
    assert.equal(state.workflowStatus('render'),'Disponible');
    assert.equal(state.endSeconds,14);
    state.pipeline.set({id:'pipeline-active',status:'analysis',events:[]});
    state.pipelineId='pipeline-active';
    await state.startPipeline();
    assert.equal(submitted,0,'an active task cannot be duplicated from the primary action');
    assert.match(state.error(),/procesamiento activo/);
    state.pipeline.set(null);
    state.pipelineId='';
    state.endSeconds=14.1;
    await state.startPipeline();
    assert.equal(submitted,0);
    assert.match(state.error(),/límite procesable/);
  } finally {
    TestBed.resetTestingModule();
    if(originalStorage) Object.defineProperty(globalThis,'sessionStorage',originalStorage);
    else delete globalThis.sessionStorage;
  }
});

test('stored upload IDs are revalidated and stored pipeline links never establish transcript provenance', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = new Map([['ac:resume:qa:project', JSON.stringify({uploadId:'upload-owned',pipelineId:'pipeline-owned',pipelineUploadId:'upload-owned'})]]);
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
  const params = new BehaviorSubject(new Map([['id','project']]));
  const api = {
    get:async()=>({id:'project',workspaceId:'workspace'}), edits:async()=>({items:[]}),
    upload:async id=>({id,projectId:'project',state:'confirmed',bytes:12,inspection:{status:'succeeded',result:{durationSeconds:10}}}),
    pipeline:async id=>({id,status:'succeeded',analysisId:'analysis',events:[]}),
  };
  TestBed.configureTestingModule({providers:[
    {provide:ProjectsApi,useValue:api},
    {provide:WorkspaceStore,useValue:{workspaces:()=>[{id:'workspace',role:'owner'}],loaded:()=>true}},
    {provide:SessionStore,useValue:{user:()=>({id:'qa'})}},
    {provide:ActivatedRoute,useValue:{snapshot:{paramMap:new Map([['id','project']])},paramMap:params}},
    {provide:Router,useValue:{navigate:async()=>true}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  try {
    const state=TestBed.runInInjectionContext(()=>new ProjectComponent());
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(state.uploadStatus()?.projectId,'project','restored upload ID is checked against its project');
    assert.equal(state.pipeline()?.id,'pipeline-owned');
    assert.equal(state.hasLinkedTranscript(),false,'browser storage cannot prove which upload produced the pipeline');
  } finally {
    TestBed.resetTestingModule();
    if(originalStorage) Object.defineProperty(globalThis,'sessionStorage',originalStorage);
    else delete globalThis.sessionStorage;
  }
});

test('upload transfer forwards AbortSignal to private storage and stops before confirmation when cancelled', async () => {
  const originalFetch = globalThis.fetch;
  let startFetch;
  let resolveFetchStarted;
  const fetchStarted = new Promise(resolve=>resolveFetchStarted=resolve);
  let confirmed = false;
  const calls=[];
  const transport = {
    post:async(path)=>{
      calls.push(path);
      if(path.endsWith('/uploads')) return {id:'upload-cancel',url:'https://storage.example/put',headers:{'Content-Type':'video/mp4'}};
      if(path.endsWith('/confirm')) confirmed=true;
      return {};
    },
    get:async()=>({id:'upload-cancel',projectId:'project',state:'confirmed',bytes:1,inspection:{status:'queued'}}),
  };
  globalThis.fetch=(url,init)=>new Promise((resolve,reject)=>{
    startFetch={url,init};
    resolveFetchStarted();
    init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  });
  try {
    const api=Object.create(ProjectsApi.prototype);
    api.api=transport;
    const file=Object.assign(new Blob(['x'],{type:'video/mp4'}),{name:'clip.mp4'});
    const controller=new AbortController();
    const remembered=[];
    const transfer=api.uploadFile('project',file,()=>{},id=>remembered.push(id),controller.signal);
    await fetchStarted;
    assert.equal(startFetch.url,'https://storage.example/put');
    assert.equal(startFetch.init.credentials,'omit');
    assert.equal(startFetch.init.signal,controller.signal);
    assert.deepEqual(remembered,['upload-cancel']);
    controller.abort();
    await assert.rejects(transfer,error=>error.name==='AbortError');
    assert.equal(confirmed,false);
    assert.equal(calls.some(path=>path.endsWith('/confirm')),false);
  } finally {
    globalThis.fetch=originalFetch;
  }
});
