// Explicit DTO fixtures exercise local editor state only; they are never injected into the app.
import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '@angular/core';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { EditorState, EditorApi, ProjectsApi, CollaborationApi, DESIGN_MODE, EDITOR_DISCARD_CONFIRMATION, WorkspaceStore, SessionStore, HttpErrorResponse, editorChangesGuard } from '../../.local/tests/client.mjs';
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

const userSpec=()=>({version:1,kind:'clip',startSeconds:10,endSeconds:16,aspect:'vertical',subtitles:{source:'user',cues:[{startSeconds:10,endSeconds:12,text:'Primera frase del fixture.'},{startSeconds:12,endSeconds:14,text:'Segunda frase del fixture.'}]}});
const transcriptSpec=analysisId=>({...userSpec(),subtitles:{source:'transcript',analysisId}});
async function setup({role='editor',spec=userSpec()}={}) {
  const route=new BehaviorSubject(new Map([['id','edit-fixture']]));
  const memberships=signal([{id:'workspace-fixture',role}]);
  let saved={id:'edit-fixture',uploadId:'upload-fixture',projectId:'project-fixture',name:'Fixture de prueba',version:1,revision:{id:'revision-fixture',version:1,spec:structuredClone(spec)}};
  const revisions=new Map([[1,structuredClone(spec)]]);
  const calls={writes:[],restores:[],reads:0,analyses:[]};
  const control={discard:false,failSave:false,failAnalysis:false,deferredAnalysis:null,pendingSave:null};
  const segments=[
    {startSeconds:9,endSeconds:11,text:'Cruza el inicio.'},
    {startSeconds:11,endSeconds:13,text:'Texto de la transcripción.'},
    {startSeconds:15,endSeconds:17,text:'Cruza el final.'},
    {startSeconds:18,endSeconds:19,text:'Fuera del intervalo.'},
  ];
  const api={
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
      saved={...saved,version:saved.version+1,revision:{...saved.revision,version:saved.version+1,spec:structuredClone(body.spec)}};
      revisions.set(saved.version,structuredClone(body.spec));
      return{draft:structuredClone(saved),etag:'"'+saved.version+'"'};
    },
    restore:async(id,body,etag)=>{
      calls.restores.push({id,body,etag});
      saved={...saved,version:saved.version+1,revision:{...saved.revision,version:saved.version+1,spec:structuredClone(revisions.get(body.revisionVersion))}};
      return{draft:structuredClone(saved),etag:'"'+saved.version+'"'};
    },
    history:async()=>({items:[],nextBeforeVersion:null}),exports:async()=>({items:[]}),
  };
  TestBed.configureTestingModule({providers:[
    EditorState,{provide:EditorApi,useValue:api},{provide:ProjectsApi,useValue:{upload:async()=>({projectId:'project-fixture',state:'confirmed',inspection:{status:'succeeded',result:{durationSeconds:21.735}}})}},
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
