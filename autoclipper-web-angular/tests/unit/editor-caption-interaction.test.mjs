// Explicit DTO fixtures exercise local editor state only; they are never injected into the app.
import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { EditorState, EditorApi, ProjectsApi, CollaborationApi, DESIGN_MODE, EDITOR_DISCARD_CONFIRMATION, EDITOR_ARTIFACT_DOWNLOAD, WorkspaceStore, SessionStore, HttpErrorResponse, editorChangesGuard, EditorNavigationService } from '../../.local/tests/client.mjs';
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

const userSpec=()=>({version:1,kind:'clip',startSeconds:10,endSeconds:16,aspect:'vertical',subtitles:{source:'user',cues:[{startSeconds:10,endSeconds:12,text:'Primera frase del fixture.'},{startSeconds:12,endSeconds:14,text:'Segunda frase del fixture.'}]}});
const transcriptSpec=analysisId=>({...userSpec(),subtitles:{source:'transcript',analysisId}});
const videoExport=(overrides={})=>({id:'export-fixture',status:'succeeded',editorRevisionId:'revision-fixture',artifacts:[{kind:'video',bytes:100,sha256:'fixture',contentType:'video/mp4'}],...overrides});
async function setup({role='editor',spec=userSpec()}={}) {
  const route=new BehaviorSubject(new Map([['id','edit-fixture']]));
  const memberships=signal([{id:'workspace-fixture',role}]);
  let saved={id:'edit-fixture',uploadId:'upload-fixture',projectId:'project-fixture',name:'Fixture de prueba',version:1,revision:{id:'revision-fixture',version:1,spec:structuredClone(spec)}};
  const revisions=new Map([[1,structuredClone(spec)]]);
  const calls={writes:[],restores:[],reads:0,analyses:[],downloads:[],renders:[],files:[]};
  const control={discard:false,failSave:false,failAnalysis:false,deferredAnalysis:null,pendingSave:null,downloadUrl:'https://media.example.test/render.mp4?grant=fixture',pendingDownload:null,renderError:null,pendingRender:null,exportsItems:[],failExports:false};
  const segments=[
    {startSeconds:9,endSeconds:11,text:'Cruza el inicio.'},
    {startSeconds:11,endSeconds:13,text:'Texto de la transcripción.'},
    {startSeconds:15,endSeconds:17,text:'Cruza el final.'},
    {startSeconds:18,endSeconds:19,text:'Fuera del intervalo.'},
  ];
  const renderSpec=spec=>({...spec,subtitles:spec.subtitles?.source==='user'?{provenance:'user',cues:structuredClone(spec.subtitles.cues)}:spec.subtitles?.source==='transcript'?{provenance:'transcript',cues:segments.filter(cue=>cue.startSeconds<spec.endSeconds&&cue.endSeconds>spec.startSeconds).map(cue=>({...cue,startSeconds:Math.max(spec.startSeconds,cue.startSeconds),endSeconds:Math.min(spec.endSeconds,cue.endSeconds)}))}:undefined});
  saved.revision.renderSpec=renderSpec(spec);
  const api={
    render:async(id,version,key)=>{calls.renders.push({id,version,key});if(control.pendingRender)await control.pendingRender;if(control.renderError)throw control.renderError;return{id:'requested-export',status:'queued'};},
    download:async(id,kind)=>{calls.downloads.push({id,kind});if(control.pendingDownload)await control.pendingDownload;return{url:control.downloadUrl};},
    edit:async id=>{calls.reads++;return{draft:{...structuredClone(saved),id},etag:'"'+saved.version+'"'};},
    project:async()=>({id:'project-fixture',name:'Proyecto unitario',workspaceId:'workspace-fixture'}),
    analysis:async id=>{
      calls.analyses.push(id);
      if(control.deferredAnalysis)return control.deferredAnalysis(id);
      if(control.failAnalysis)throw new Error('Transcripción no disponible.');
      return{status:'succeeded',transcript:{segments:structuredClone(segments)}};
    },
    save:async(id,body,etag)=>{
      calls.writes.push({id,body:structuredClone(body),etag});
      if(control.pendingSave)await control.pendingSave;
      if(control.failSave)throw new HttpErrorResponse({status:412,statusText:'Precondition Failed'});
      saved={...saved,version:saved.version+1,revision:{...saved.revision,id:'revision-fixture-'+(saved.version+1),version:saved.version+1,spec:structuredClone(body.spec),renderSpec:renderSpec(body.spec)}};
      revisions.set(saved.version,structuredClone(body.spec));
      return{draft:structuredClone(saved),etag:'"'+saved.version+'"'};
    },
    restore:async(id,body,etag)=>{
      calls.restores.push({id,body,etag});
      const spec=structuredClone(revisions.get(body.revisionVersion));
      saved={...saved,version:saved.version+1,revision:{...saved.revision,id:'revision-fixture-'+(saved.version+1),version:saved.version+1,spec,renderSpec:renderSpec(spec)}};
      return{draft:structuredClone(saved),etag:'"'+saved.version+'"'};
    },
    history:async()=>({items:[],nextBeforeVersion:null}),exports:async()=>{if(control.failExports)throw new HttpErrorResponse({status:0});return{items:structuredClone(control.exportsItems)};},
  };
  TestBed.configureTestingModule({providers:[
    EditorState,{provide:EditorApi,useValue:api},{provide:ProjectsApi,useValue:{upload:async()=>({projectId:'project-fixture',state:'confirmed',inspection:{status:'succeeded',result:{durationSeconds:21.735}}})}},
    {provide:EDITOR_ARTIFACT_DOWNLOAD,useValue:async(url,filename)=>{calls.files.push({url,filename});}},
    {provide:CollaborationApi,useValue:{review:async()=>({status:'draft',version:1,reviewVersion:1}),comments:async()=>({items:[],nextBeforeId:null})}},
    {provide:DESIGN_MODE,useValue:false},{provide:EDITOR_DISCARD_CONFIRMATION,useValue:()=>control.discard},
    {provide:ActivatedRoute,useValue:{paramMap:route.asObservable(),snapshot:{paramMap:new Map([['id','edit-fixture']])}}},
    {provide:Router,useValue:{navigateByUrl:async()=>true}},{provide:WorkspaceStore,useValue:{loaded:()=>true,workspaces:memberships}},
    {provide:SessionStore,useValue:{user:()=>({id:'account-fixture'})}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  const state=TestBed.inject(EditorState);
  for(let n=0;n<40&&(!state.draft()||state.busy());n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.busy(),false);
  return{state,control,calls,memberships,segments,route,api};
}

test('save and export persists the caption revision with If-Match before requesting that exact saved version',async()=>{
  try {
    const {state,control,calls}=await setup();state.selectCue(1);state.updateCue(1,'text','Texto listo para el render.');
    let finish;control.pendingSave=new Promise(resolve=>finish=resolve);
    const saving=state.saveAndRender();
    assert.equal(state.exportPhase(),'saving');assert.equal(calls.renders.length,0);assert.equal(state.busy(),true);
    await state.saveAndRender();await state.render();assert.equal(calls.writes.length,1);
    let finishRender;control.pendingRender=new Promise(resolve=>finishRender=resolve);
    finish();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.exportPhase(),'requesting');assert.equal(calls.renders.length,1);
    await state.render();state.updateCue(1,'text','No debe cambiar durante el render');
    assert.equal(calls.renders.length,1);assert.equal(state.selectedCue().text,'Texto listo para el render.');
    finishRender();await saving;
    assert.equal(calls.writes[0].etag,'"1"');assert.equal(calls.writes[0].body.version,1);
    assert.equal(calls.writes[0].body.spec.subtitles.cues[1].text,'Texto listo para el render.');
    assert.equal(calls.renders.length,1);assert.equal(calls.renders[0].version,2);assert.ok(calls.renders[0].key);
    assert.equal(state.draft().version,2);assert.equal(state.dirty(),false);assert.equal(state.selectedCue().index,1);
    assert.deepEqual(state.renderReceipt(),{id:'requested-export',revisionId:'revision-fixture-2',version:2});
    assert.equal(state.currentRenderPending(),true);assert.equal(state.tab(),'exports');assert.equal(state.exportPhase(),'idle');
    assert.match(state.message(),/guardada y exportación solicitada/);
  } finally {TestBed.resetTestingModule();}
});

test('invalid subtitle settings and a save conflict cannot submit a render or lose the local text',async()=>{
  try {
    const {state,control,calls}=await setup();state.selectCue(0);state.updateCue(0,'text','Cambios locales.');
    for(const size of [null,NaN,12.5,11,41]) {
      state.fontSize=size;state.touchForm();assert.equal(state.canSaveRevision(),false);
      await state.saveAndRender();await state.save();
    }
    assert.equal(calls.writes.length,0);assert.equal(calls.renders.length,0);
    state.fontSize=24;state.touchForm();control.failSave=true;await state.saveAndRender();
    assert.equal(state.conflict(),true);assert.equal(state.dirty(),true);assert.equal(state.selectedCue().text,'Cambios locales.');
    assert.equal(state.draft().version,1);assert.equal(calls.renders.length,0);assert.equal(state.exportPhase(),'idle');
  } finally {TestBed.resetTestingModule();}
});

test('a rejected export retains the saved revision; retry reuses its request key without saving twice',async()=>{
  try {
    const {state,control,calls}=await setup();state.selectCue(0);state.updateCue(0,'text','Revisión conservada.');
    control.renderError=new HttpErrorResponse({status:403,error:{code:'MANUAL_PROCESSING_NOT_ADMITTED'}});
    await state.saveAndRender();
    assert.equal(state.draft().version,2);assert.equal(state.dirty(),false);assert.match(state.message(),/2 guardada/);
    assert.match(state.error(),/no admite nuevas exportaciones/);assert.equal(state.renderReceipt(),null);
    assert.equal(calls.writes.length,1);assert.equal(calls.renders.length,1);
    control.renderError=null;await state.render();
    assert.equal(calls.writes.length,1);assert.equal(calls.renders[1].key,calls.renders[0].key);assert.equal(calls.renders[1].version,2);
    state.updateCue(0,'text','Otra revisión.');await state.saveAndRender();
    assert.equal(calls.renders[2].version,3);assert.notEqual(calls.renders[2].key,calls.renders[1].key);
  } finally {TestBed.resetTestingModule();}
});

test('restoring after an uncertain render response uses a new key for the new immutable revision',async()=>{
  try {
    const {state,control,calls}=await setup();control.renderError=new HttpErrorResponse({status:0});
    await state.render();await state.restore(1);control.renderError=null;await state.render();
    assert.equal(calls.renders[0].version,1);assert.equal(calls.renders[1].version,2);
    assert.notEqual(calls.renders[0].key,calls.renders[1].key);
  } finally {TestBed.resetTestingModule();}
});

test('an accepted request survives a failed status lookup and prevents duplicate submits until its real terminal state is known',async()=>{
  try {
    const {state,control,calls}=await setup();control.failExports=true;await state.render();
    assert.equal(state.renderReceipt().id,'requested-export');assert.equal(state.currentRenderPending(),true);
    assert.match(state.exportsError(),/No se pudieron cargar/);assert.equal(state.exportPhase(),'idle');
    await state.render();assert.equal(calls.renders.length,1);
    control.failExports=false;control.exportsItems=[videoExport({id:'requested-export',status:'running',artifacts:[]})];
    await state.loadExports();assert.equal(state.receiptExport().status,'running');assert.equal(state.currentRenderPending(),true);
    await state.render();assert.equal(calls.renders.length,1);
    control.exportsItems=[videoExport({id:'requested-export',status:'failed',artifacts:[],errorCode:'FIXTURE_FAILURE'})];
    await state.loadExports();assert.equal(state.currentRenderPending(),false);
    await state.render();assert.equal(calls.renders.length,2);assert.notEqual(calls.renders[1].key,calls.renders[0].key);
  } finally {TestBed.resetTestingModule();}
});

test('only the newest export lookup can publish rows, errors or loading state',async()=>{
  try {
    const {state,api}=await setup();let reject;
    api.exports=()=>new Promise((resolve,rejectRequest)=>reject=rejectRequest);
    const oldLookup=state.loadExports();assert.equal(state.exportsLoading(),true);
    api.exports=async()=>({items:[videoExport()]});await state.loadExports();
    assert.equal(state.exportsLoading(),false);reject(new HttpErrorResponse({status:0}));await oldLookup;
    assert.equal(state.exportsError(),'');assert.equal(state.exports()[0].id,'export-fixture');
  } finally {TestBed.resetTestingModule();}
});

test('a role revoked while saving preserves the revision without submitting a render; readers cannot save and export',async()=>{
  try {
    const {state,control,calls,memberships}=await setup();state.selectCue(0);state.updateCue(0,'text','Se conserva al guardar.');
    let finish;control.pendingSave=new Promise(resolve=>finish=resolve);const saving=state.saveAndRender();
    memberships.set([{id:'workspace-fixture',role:'reader'}]);finish();await saving;
    assert.equal(state.draft().version,2);assert.equal(calls.renders.length,0);assert.match(state.loadNotice(),/rol actual/);
    await state.saveAndRender();await state.render();assert.equal(calls.writes.length,1);assert.equal(calls.renders.length,0);
  } finally {TestBed.resetTestingModule();}
});

test('downloads use only actual artifacts and identify their revision while current captions remain dirty',async()=>{
  try {
    const {state,calls,control,memberships}=await setup();
    const item=videoExport({artifacts:[{kind:'video',contentType:'video/mp4'},{kind:'srt',contentType:'application/x-subrip'}]});
    state.exports.set([item]);state.selectCue(0);state.updateCue(0,'text','Cambio que no forma parte de estos archivos.');
    memberships.set([{id:'workspace-fixture',role:'reader'}]);
    await state.download(item.id,'vtt');await state.download('unknown','video');assert.equal(calls.downloads.length,0);
    await state.download(item.id,'srt');await state.download(item.id,'video');
    assert.equal(calls.files.length,2);assert.equal(calls.files[0].filename,'autoclipper-revision-1-export-fixture.srt');
    assert.equal(calls.files[1].filename,'autoclipper-revision-1-export-fixture.mp4');assert.equal(calls.files[0].url,control.downloadUrl);
    assert.equal(state.dirty(),true);assert.equal(calls.writes.length,0);assert.match(state.message(),/revisión 1 descargado/);
  } finally {TestBed.resetTestingModule();}
});

test('a late download grant cannot start a native download after an approved edit change',async()=>{
  try {
    const {state,calls,control,route}=await setup();const item=videoExport();state.exports.set([item]);
    assert.equal(TestBed.inject(EditorNavigationService).allowEdit('another-edit'),true);
    let finish;control.pendingDownload=new Promise(resolve=>finish=resolve);
    const pending=state.download(item.id,'video');route.next(new Map([['id','another-edit']]));finish();await pending;
    assert.equal(calls.files.length,0);assert.equal(state.renderReceipt(),null);
  } finally {TestBed.resetTestingModule();}
});

test('a reader can seek in the authorized current render; playback highlights overlaps without changing selection or dirty state',async()=>{
  try {
    const {state,calls}=await setup({role:'reader'});
    const item=videoExport();state.exports.set([item]);state.selectCue(1);
    await state.preview(item);
    const token=state.previewSession().token;
    assert.equal(state.previewSyncReady(),false);assert.equal(state.selectedCueSeekTime(),null);
    state.previewMetadata(token,6);state.previewTimeChanged(token,0);
    assert.equal(state.previewSyncReady(),true);assert.equal(state.selectedCueSeekTime(),2);
    state.seekSelectedCue();assert.deepEqual(state.previewSeek(),{token,sequence:1,seconds:2});
    state.previewTimeChanged(token,0.5);assert.deepEqual(state.playingCueIndices(),[0]);
    assert.equal(state.selectedCue().index,1);assert.equal(state.dirty(),false);
    state.previewTimeChanged(token,2);assert.deepEqual(state.playingCueIndices(),[1],'Cue boundaries are half-open.');
    assert.equal(state.playbackPosition().sourceSeconds,12);
    state.previewTimeChanged(token,6);assert.deepEqual(state.playingCueIndices(),[]);
    assert.equal(state.playbackPosition().percent,100);
    assert.deepEqual(calls.downloads,[{id:item.id,kind:'video'}]);assert.equal(calls.writes.length,0);
  } finally {TestBed.resetTestingModule();}
});

test('old or unidentified revisions and dirty forms never seek or highlight the current cues; save does not relabel an older render',async()=>{
  try {
    const {state}=await setup();state.selectCue(0);
    for(const revisionId of ['older-revision',undefined]) {
      const item=videoExport({editorRevisionId:revisionId});state.exports.set([item]);await state.preview(item);
      const token=state.previewSession().token;state.previewMetadata(token,6);state.previewTimeChanged(token,1);
      assert.equal(state.previewSyncReady(),false);assert.match(state.previewSyncNotice(),/otra revisión/);
      state.seekSelectedCue();assert.equal(state.previewSeek(),null);assert.deepEqual(state.playingCueIndices(),[]);
    }
    const item=videoExport();state.exports.set([item]);await state.preview(item);
    state.previewMetadata(state.previewSession().token,6);assert.equal(state.previewSyncReady(),true);
    state.updateCue(0,'text','Cambio sin guardar');
    assert.equal(state.previewSyncReady(),false);assert.match(state.previewSyncNotice(),/sin guardar/);
    state.seekSelectedCue();assert.equal(state.previewSeek(),null);
    await state.save();assert.equal(state.dirty(),false);assert.equal(state.previewSyncReady(),false);
    assert.equal(state.previewSession().revisionId,'revision-fixture');assert.match(state.previewSyncNotice(),/otra revisión/);
  } finally {TestBed.resetTestingModule();}
});

test('transcript seeks use the immutable resolved render, including cues crossing the clip and overlapping speech',async()=>{
  try {
    const spec=userSpec();spec.subtitles.cues[1].startSeconds=11;
    const {state}=await setup({spec});const item=videoExport();state.exports.set([item]);await state.preview(item);
    const token=state.previewSession().token;state.previewMetadata(token,6);state.previewTimeChanged(token,1.5);
    assert.deepEqual(state.playingCueIndices(),[0,1]);
  } finally {TestBed.resetTestingModule();}
  try {
    const {state}=await setup({spec:transcriptSpec('analysis-fixture')});const item=videoExport();state.exports.set([item]);await state.preview(item);
    const token=state.previewSession().token;state.previewMetadata(token,6);
    state.selectCue(0);assert.equal(state.selectedCueSeekTime(),0);
    state.selectCue(2);assert.equal(state.selectedCueSeekTime(),5);
    assert.equal(state.dirty(),false);assert.equal(state.captionSource,'transcript');
    state.previewMetadata(token,9);assert.equal(state.previewSyncReady(),false);assert.equal(state.selectedCueSeekTime(),null);
  } finally {TestBed.resetTestingModule();}
});

test('refresh obtains a new authorized URL; late events and nonfinite times cannot affect the new player',async()=>{
  try {
    const {state,control,calls}=await setup();const item=videoExport();state.exports.set([item]);await state.preview(item);
    const oldToken=state.previewSession().token;state.previewMetadata(oldToken,6);state.previewTimeChanged(oldToken,1);
    state.previewFailed(oldToken);assert.equal(state.previewSyncReady(),false);assert.equal(state.previewTime(),null);
    control.downloadUrl='https://media.example.test/render.mp4?grant=renewed';await state.refreshPreview();
    const token=state.previewSession().token;assert.notEqual(token,oldToken);assert.equal(state.previewError(),'');
    state.previewFailed(oldToken);state.previewMetadata(oldToken,99);state.previewTimeChanged(oldToken,2);
    assert.equal(state.previewDuration(),null);assert.equal(state.previewError(),'');
    state.previewMetadata(token,6);state.previewTimeChanged(token,2);
    for(const value of [NaN,Infinity,-1,7])state.previewTimeChanged(token,value);
    assert.equal(state.previewTime(),2);assert.equal(calls.downloads.length,2);
    assert.equal(state.previewUrl(),control.downloadUrl);
    state.exports.set([]);await state.refreshPreview();
    assert.equal(calls.downloads.length,2);assert.match(state.previewError(),/Actualiza Exportaciones/);
  } finally {TestBed.resetTestingModule();}
});

test('only listed completed video exports can obtain a player URL; invalid media URLs are rejected',async()=>{
  try {
    const {state,control,calls}=await setup();
    await state.preview(videoExport());assert.equal(calls.downloads.length,0);
    for(const item of [videoExport({status:'running'}),videoExport({artifacts:[{kind:'srt'}]})]) {
      state.exports.set([item]);await state.preview(item);
    }
    assert.equal(calls.downloads.length,0);
    const item=videoExport();state.exports.set([item]);
    for(const url of ['javascript:alert(1)','https://user:password@media.example.test/render.mp4']) {
      control.downloadUrl=url;await state.preview(item);assert.equal(state.previewSession(),null);assert.match(state.error(),/inválida/);
    }
  } finally {TestBed.resetTestingModule();}
});

test('changing edit invalidates pending playback downloads and media events',async()=>{
  try {
    const {state,control,route}=await setup();const item=videoExport();state.exports.set([item]);await state.preview(item);
    const token=state.previewSession().token;
    // The navigation guard approved this destination before the download began.
    assert.equal(TestBed.inject(EditorNavigationService).allowEdit('next-edit'),true);
    let finish;control.pendingDownload=new Promise(resolve=>finish=resolve);
    const pending=state.preview(item);route.next(new Map([['id','next-edit']]));finish();await pending;
    for(let n=0;n<40&&state.busy();n++)await new Promise(resolve=>setImmediate(resolve));
    state.previewMetadata(token,6);state.previewTimeChanged(token,2);state.previewFailed(token);
    assert.equal(state.previewSession(),null);assert.equal(state.previewUrl(),'');assert.equal(state.previewError(),'');assert.equal(state.previewDuration(),null);
  } finally {TestBed.resetTestingModule();}
});

test('selection is not dirty, text/times synchronize, save keeps ETag and restore replaces selected cues',async()=>{
  try {
    const {state,calls}=await setup();
    state.selectCue(1);
    assert.equal(state.tab(),'captions');assert.equal(state.dirty(),false);
    state.updateCue(1,'text','Texto corregido.');
    state.updateCue(1,'startSeconds',11);
    assert.equal(state.selectedCue().text,'Texto corregido.');
    assert.equal(state.timelineCues().find(cue=>cue.index===1).text,'Texto corregido.');
    assert.equal(state.timelineCues().find(cue=>cue.index===1).row,1);
    assert.equal(state.invalidCaptions(),true,'Overlaps stay visible for correction but cannot be persisted.');
    state.updateCue(1,'startSeconds',12);
    assert.equal(state.dirty(),true);
    assert.equal(editorChangesGuard({vm:state}),false);
    const reads=calls.reads;await state.reload();assert.equal(calls.reads,reads,'Cancelled discard must retain local cue edits.');
    await state.save();
    assert.equal(calls.writes[0].etag,'"1"');assert.equal(calls.writes[0].body.version,1);
    assert.equal(calls.writes[0].body.spec.subtitles.source,'user');
    assert.equal(calls.writes[0].body.spec.subtitles.cues[1].text,'Texto corregido.');
    assert.equal(state.draft().version,2);assert.equal(state.dirty(),false);assert.equal(state.selectedCue().index,1);
    await state.restore(1);
    assert.equal(calls.restores[0].etag,'"2"');assert.equal(state.draft().version,3);
    assert.equal(state.cues[1].text,'Segunda frase del fixture.');assert.equal(state.selectedCue(),null);
  } finally {TestBed.resetTestingModule();}
});

test('invalid cues do not call save; 412 and pending writes preserve the local edit and prohibit concurrent mutations',async()=>{
  try {
    const {state,control,calls}=await setup();
    state.selectCue(0);state.updateCue(0,'endSeconds',22);
    assert.equal(state.invalidCaptions(),true);await state.save();assert.equal(calls.writes.length,0);
    state.updateCue(0,'endSeconds',12);state.updateCue(0,'text','Edición pendiente.');
    control.failSave=true;await state.save();
    assert.equal(state.conflict(),true);assert.equal(state.dirty(),true);assert.equal(state.selectedCue().text,'Edición pendiente.');
    control.failSave=false;let finish;control.pendingSave=new Promise(resolve=>finish=resolve);
    const saving=state.save();assert.equal(state.busy(),true);
    state.updateCue(0,'text','No debe reemplazar');state.removeCue(0);state.setCaptionSource('none');
    assert.equal(state.selectedCue().text,'Edición pendiente.');assert.equal(state.cues.length,2);assert.equal(state.captionSource,'user');
    finish();await saving;assert.equal(state.dirty(),false);assert.equal(state.cues[0].text,'Edición pendiente.');
  } finally {TestBed.resetTestingModule();}
});

test('reader and unavailable roles can select cues but cannot change local captions, ranges or persist a revision',async()=>{
  try {
    const {state,calls,memberships}=await setup({role:'reader'});
    state.selectCue(0);assert.equal(state.selectedCue().index,0);
    const before=structuredClone(state.cues);
    state.updateCue(0,'text','Bloqueado');state.removeCue(0);state.addCue();state.setCaptionSource('none');
    state.startManualCaptions();state.copyTranscriptToEditable();state.setTimelineStart(11);state.setTimelineEnd(15);state.setClipField('startSeconds',11);
    await state.save();await state.restore(1);
    assert.deepEqual(state.cues,before);assert.equal(state.captionSource,'user');assert.equal(state.spec.startSeconds,10);assert.equal(state.spec.endSeconds,16);
    assert.equal(calls.writes.length,0);assert.equal(calls.restores.length,0);assert.equal(state.dirty(),false);
    memberships.set([{id:'workspace-fixture',role:'editor'}]);state.updateCue(0,'text','Permitido');
    assert.equal(state.cues[0].text,'Permitido');
    memberships.set([]);state.updateCue(0,'text','Bloqueado otra vez');await state.save();
    assert.equal(state.cues[0].text,'Permitido');assert.equal(calls.writes.length,0);
  } finally {TestBed.resetTestingModule();}
});

test('transcript selection remains read-only until an explicit bounded copy; restoring reloads its real segments and errors remain recoverable',async()=>{
  try {
    const {state,control,calls,segments}=await setup({spec:transcriptSpec('analysis-fixture')});
    state.selectCue(1);assert.equal(state.dirty(),false);assert.equal(state.captionEntries().length,3);
    state.updateCue(1,'text','No mutar el análisis');state.addCue();
    assert.deepEqual(state.transcriptSegments(),segments);assert.equal(state.captionSource,'transcript');
    state.copyTranscriptToEditable();
    assert.equal(state.captionSource,'user');assert.equal(state.selectedCue().text,segments[1].text);
    assert.equal(state.cues[0].startSeconds,10);assert.equal(state.cues[2].endSeconds,16);
    assert.deepEqual(state.transcriptSegments(),segments);await state.save();
    assert.equal(calls.writes[0].body.spec.subtitles.source,'user');assert.equal('analysisId' in calls.writes[0].body.spec.subtitles,false);
    control.failAnalysis=true;await state.restore(1);
    assert.equal(state.captionSource,'transcript');assert.equal(state.selectedCue(),null);
    assert.deepEqual(state.transcriptSegments(),[]);assert.match(state.transcriptError(),/no disponible/);
    assert.doesNotMatch(state.loadNotice(),/transcripción/,'The transcript has a dedicated recoverable state, not a stale global warning.');
    assert.equal(state.draft().version,3,'A transcript error must not hide a restored revision.');
    control.failAnalysis=false;await state.retryTranscript();
    assert.deepEqual(state.transcriptSegments(),segments);assert.equal(state.transcriptError(),'');assert.equal(state.dirty(),false);
  } finally {TestBed.resetTestingModule();}
});

test('late transcript responses cannot overwrite another edit; measured fractional limits stay exact',async()=>{
  try {
    const {state,control,route,segments}=await setup({spec:transcriptSpec('analysis-fixture')});
    let finish;control.deferredAnalysis=()=>new Promise(resolve=>finish=resolve);
    const pending=state.retryTranscript();assert.equal(state.transcriptLoading(),true);
    control.deferredAnalysis=null;route.next(new Map([['id','another-edit']]));
    for(let n=0;n<40&&state.busy();n++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.draft().id,'another-edit');assert.deepEqual(state.transcriptSegments(),segments);
    finish({status:'succeeded',transcript:{segments:[{startSeconds:0,endSeconds:1,text:'Respuesta obsoleta'}]}});await pending;
    assert.deepEqual(state.transcriptSegments(),segments);
    state.setTimelineEnd(99);
    assert.equal(state.spec.endSeconds,21.735,'Snapping must not round a real measured limit beyond the source.');
    assert.equal(state.sourceRangeInvalid(),false);
  } finally {TestBed.resetTestingModule();}
});

test('removal keeps the same surviving phrase selected and invalid clip bounds never create timeline geometry',async()=>{
  try {
    const {state,calls}=await setup();
    state.selectCue(1);state.removeCue(0);
    assert.equal(state.selectedCue().index,0);assert.equal(state.selectedCue().text,'Segunda frase del fixture.');
    state.removeCue(0);assert.equal(state.selectedCue(),null);assert.deepEqual(state.timelineCues(),[]);
    state.addCue();assert.equal(state.selectedCue().index,0);assert.equal(state.cues[0].startSeconds,10);assert.equal(state.invalidCaptions(),true);
    state.updateCue(0,'text','Nueva frase manual.');
    state.setClipField('startSeconds',null);
    assert.equal(state.clipRangeUsable(),false);assert.deepEqual(state.timelineCues(),[]);assert.equal(state.invalidCaptions(),true);
    await state.save();assert.equal(calls.writes.length,0);
    state.setClipField('startSeconds',10);assert.equal(state.clipRangeUsable(),true);assert.equal(state.invalidCaptions(),false);
  } finally {TestBed.resetTestingModule();}
});

test('original aspect omits manual framing and invalid split/composition values cannot bypass the shared save gate',async()=>{
  try {
    const {state,calls}=await setup();state.spec.aspect='source';state.touchForm();await state.save();
    assert.equal(calls.writes.length,1);assert.equal('framing' in calls.writes[0].body.spec,false);
    state.splitEnabled=true;state.touchForm();assert.equal(state.canSaveRevision(),false);
    await state.save();assert.equal(calls.writes.length,1);assert.match(state.error(),/pantalla dividida/);
    state.spec.aspect='vertical';state.secondaryUploadId='invalid';state.touchForm();assert.equal(state.canSaveRevision(),false);
    state.secondaryUploadId='a559d6bd-3198-4306-ba6c-56a2caac1b4d';state.primaryRatio=0.9;state.touchForm();
    await state.save();assert.equal(calls.writes.length,1);assert.match(state.error(),/proporción/);
    state.primaryRatio=0.5;state.secondaryStart=null;state.touchForm();assert.equal(state.canSaveRevision(),false);
    state.secondaryStart=0;state.cropX=NaN;state.touchForm();assert.equal(state.canSaveRevision(),false);
    state.cropX=0.5;state.touchForm();assert.equal(state.canSaveRevision(),true);
  } finally {TestBed.resetTestingModule();}
});

test('the UTF-8 revision size limit is checked before saving or requesting any render',async()=>{
  try {
    const {state,calls}=await setup();
    state.cues=Array.from({length:100},(_,index)=>({startSeconds:10+index*.05,endSeconds:10+index*.05+.04,text:'界'.repeat(500)}));
    state.touchForm();assert.equal(state.invalidCaptions(),false);await state.saveAndRender();
    assert.match(state.error(),/65 000 bytes/);assert.equal(state.dirty(),true);assert.equal(calls.writes.length,0);assert.equal(calls.renders.length,0);
  } finally {TestBed.resetTestingModule();}
});
