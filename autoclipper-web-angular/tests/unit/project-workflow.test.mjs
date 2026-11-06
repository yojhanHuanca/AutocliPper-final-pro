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

async function handoffSetup({role='editor',design=false,userId=null,seedUpload=true}={}) {
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
    {provide:SessionStore,useValue:{user:()=>userId ? {id:userId} : null}},{provide:DESIGN_MODE,useValue:design},
    {provide:ActivatedRoute,useValue:{snapshot:{paramMap:new Map([['id','project-fixture']])},paramMap:params}},
    {provide:Router,useValue:{navigate:async route=>{calls.navigations.push(route);if(control.navigationError)throw new Error('Fixture de navegación');return control.navigate;}}},
    {provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}},
  ]});
  const state=TestBed.runInInjectionContext(()=>new ProjectComponent());
  state.providerStatus.set({transcription:{whisper_cpp:{configured:true,maxSeconds:3600}},selection:{provider:'openai',readiness:{status:'ready',blockers:[]}},automaticPipeline:{ready:true,selectionMode:'local',blockers:[]}});
  for(let n=0;n<40&&state.busy();n++)await new Promise(resolve=>setImmediate(resolve));
  if(!design && seedUpload){state.selectUpload('upload-fixture');await state.inspect();}
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
    state.creatorWizardOpen.set(true);
    state.pipelineError.set('Error de un procesamiento anterior');
    if(method==='reload')control.projectError=new HttpErrorResponse({status:403});else control.listError=new HttpErrorResponse({status:403});
    await state[method]();
    assert.equal(state.project(),null);assert.deepEqual(state.edits(),[]);assert.equal(state.createdDraft(),null);
    assert.equal(state.uploadStatus(),null);assert.equal(state.uploadId,'');assert.equal(state.canEdit(),false);assert.equal(state.editsLoaded(),false);
    assert.equal(state.creatorWizardOpen(),false,'A revoked project returns to the visible recovery screen.');
    assert.match(state.projectLoadError(),/permiso/,'An old processing error cannot hide the project access failure.');
    control.projectError=null;control.listError=null;
    await state.reload();
    assert.equal(state.projectLoadError(),'');assert.equal(state.project().id,'project-fixture');assert.equal(state.editsLoaded(),true);
  } finally {TestBed.resetTestingModule();}
  }
});

test('a transient project refresh error preserves known work and clears after a successful retry',async()=>{
  try {
    const {state,control}=await handoffSetup();
    state.edits.set([{id:'known-draft'}]);
    state.pipelineError.set('Error anterior');
    control.projectError=new HttpErrorResponse({status:0});
    await state.reload();
    assert.match(state.projectLoadError(),/conectar con el servidor/);
    assert.equal(state.project().id,'project-fixture');
    assert.equal(state.edits()[0].id,'known-draft');
    assert.equal(state.uploadId,'upload-fixture');
    control.projectError=null;
    await state.reload();
    assert.equal(state.projectLoadError(),'');assert.equal(state.editsLoading(),false);
  } finally {TestBed.resetTestingModule();}
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

test('a project opens at Fuente and inspection unlocks Configuración as the next step',async()=>{
  try{
    const{state}=await handoffSetup();
    assert.deepEqual(state.creatorSteps.map(step=>step.id),['source','configuration','generation','review']);
    assert.equal(state.creatorStep(),'source');
    assert.equal(state.intervalReady(),true,'The fixture is a confirmed and inspected MP4 source.');
    assert.equal(state.creatorStepAvailable('configuration'),true);
    assert.equal(state.creatorStepAvailable('generation'),false);
    state.goToCreatorStep('configuration');
    assert.equal(state.creatorStep(),'configuration');
    assert.equal(state.workbench(),'processing');
  }finally{TestBed.resetTestingModule();}
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

test('local selection validates before upload, releases previews and keeps confirmed source metadata separate', async () => {
  const originalCreate=URL.createObjectURL, originalRevoke=URL.revokeObjectURL;
  const revoked=[]; let preview=0;
  URL.createObjectURL=()=>`blob:fixture-${++preview}`;
  URL.revokeObjectURL=url=>revoked.push(url);
  try {
    const {state,calls}=await handoffSetup();
    const first=new File(['video'],'first.mp4',{type:'video/mp4'});
    state.choose({target:{files:[first]}});
    assert.equal(state.selectionError(),''); assert.equal(state.localPreview(),'blob:fixture-1');
    assert.equal(state.inspected(),true); assert.equal(state.sourceFileName(),'');
    assert.equal(state.hasUnuploadedSelection(),true);
    state.choose({target:{files:[]}}); assert.equal(state.file,first);
    state.choose({target:{files:[new File(['x'],'bad.exe',{type:'application/octet-stream'})]}});
    assert.match(state.selectionError(),/Formato no admitido/); assert.equal(state.localPreview(),'');
    assert.deepEqual(revoked,['blob:fixture-1']); await state.upload(); assert.equal(calls.writes.length,0);
    const input={value:'bad.exe',focus(){this.focused=true;}};
    state.clearSelectedFile(input); assert.equal(input.value,''); assert.equal(input.focused,true);
    assert.equal(state.file,null); assert.equal(state.selectionError(),''); assert.equal(state.inspected(),true);
    state.choose({target:{files:[first]}});
    state.switchProject('next-project'); assert.equal(state.localPreview(),'');
    assert.deepEqual(revoked,['blob:fixture-1','blob:fixture-2']);
  } finally { URL.createObjectURL=originalCreate; URL.revokeObjectURL=originalRevoke; TestBed.resetTestingModule(); }
});

test('a replacement stays local until inspected, then source and options survive back/forward navigation',async()=>{
  try {
    const {state,api}=await handoffSetup();
    assert.equal(state.processingSourceReady(),true);
    const replacement=new File(['new-source'],'replacement.mp4',{type:'video/mp4'});
    state.choose({target:{files:[replacement]}});
    assert.equal(state.inspected(),true,'The previous server source remains available, but is not the selected candidate.');
    assert.equal(state.processingSourceReady(),false,'Selecting a different local file immediately disables configuration.');
    state.continueToConfiguration();
    assert.equal(state.creatorStep(),'source');
    assert.equal(state.sourceActionLabel(),'Cargar e inspeccionar video');
    api.uploadFile=async(project,file,progress,remember)=>{remember('replacement-upload');return{id:'replacement-upload',projectId:project,state:'confirmed',inspection:{status:'running'}};};
    await state.advanceSource();
    assert.equal(state.sourceActionLabel(),'Continuar a configuración');
    assert.equal(state.sourceFileName(),'replacement.mp4');
    await state.advanceSource();
    assert.equal(state.creatorStep(),'configuration');
    state.clipCount=2;state.limitClipDuration=true;state.maxDurationSeconds=60;state.aspect='square';state.includeSubtitles=false;
    state.goToCreatorStep('source');state.continueToConfiguration();
    assert.equal(state.uploadId,'replacement-upload');
    assert.equal(state.sourceFileName(),'replacement.mp4');
    assert.equal(state.processingSourceReady(),true);
    assert.deepEqual([state.clipCount,state.limitClipDuration,state.maxDurationSeconds,state.aspect,state.includeSubtitles],[2,true,60,'square',false]);
    state.releaseLocalPreview();
  } finally {TestBed.resetTestingModule();}
});

test('reopening a preview with an older inspected video returns to Fuente without promoting the link',async()=>{
  try {
    const {state,calls}=await handoffSetup();
    state.showSource('link');state.onLinkPreviewAvailable(true);
    state.openCreatorWizard();
    assert.equal(state.creatorStep(),'source');
    assert.equal(state.workbench(),'source');
    assert.equal(state.canConfigureGeneration(),false);
    await state.generateConfiguredClips();
    assert.equal(calls.pipelines.length,0);
    state.continueWithCurrentUpload(false);
    assert.equal(state.creatorStep(),'configuration');
    assert.equal(state.uploadId,'upload-fixture');
  } finally {TestBed.resetTestingModule();}
});

test('server diagnostics block automatic submission while the supported manual path stays available',async()=>{
  try {
    const {state,api,calls}=await handoffSetup();
    assert.equal(state.generationMode,'automatic','The default workflow requests real AI selection.');
    state.generationMode='automatic';
    api.analysisProviders=async()=>({transcription:{whisper_cpp:{configured:false}},selection:{provider:'openai'},automaticPipeline:{ready:false,selectionMode:'local',blockers:['TRANSCRIPTION_NOT_CONFIGURED']}});
    await state.refreshGenerationReadiness();
    assert.match(state.generationReadinessMessage(),/Whisper local no está configurado/);
    assert.equal(state.generationActionDisabled(),true);
    await state.generateConfiguredClips();
    assert.equal(calls.pipelines.length,0,'The UI never submits an automatic job after a blocked preflight.');
    state.generationMode='manual';
    assert.equal(state.generationActionDisabled(),false);
  } finally {TestBed.resetTestingModule();}
});

test('only server-confirmed ASR and LLM readiness enables automatic generation',async()=>{
  try {
    const {state,api,calls}=await handoffSetup();
    state.generationMode='automatic';
    api.analysisProviders=async()=>({transcription:{whisper_cpp:{configured:true}},selection:{provider:'openai',readiness:{status:'missing_credentials'}},automaticPipeline:{ready:true,selectionMode:'local',blockers:[]}});
    await state.refreshGenerationReadiness();
    assert.equal(state.generationActionDisabled(),true);
    await state.generateConfiguredClips(); assert.equal(calls.pipelines.length,0);
    api.analysisProviders=async()=>({transcription:{whisper_cpp:{configured:true}},selection:{provider:'gemini',readiness:{status:'ready'}},automaticPipeline:{ready:true,selectionMode:'local',blockers:[]}});
    await state.refreshGenerationReadiness();
    assert.match(state.generationReadinessMessage(),/IA selecciona momentos/);
    assert.equal(state.generationActionDisabled(),false);
  } finally {TestBed.resetTestingModule();}
});

test('closing asks before discarding a local candidate and preserves the confirmed server source',async()=>{
  try {
    const {state}=await handoffSetup();
    state.file=new File(['candidate'],'not-uploaded.mp4',{type:'video/mp4'});
    state.creatorWizardOpen.set(true);
    state.requestCloseCreatorWizard();
    assert.equal(state.creatorCloseRequested(),true);
    assert.equal(state.creatorWizardOpen(),true);
    assert.equal(state.file.name,'not-uploaded.mp4');
    state.discardCreatorSelection();
    assert.equal(state.creatorWizardOpen(),false);
    assert.equal(state.file,null);
    assert.equal(state.uploadId,'upload-fixture');
    assert.equal(state.inspected(),true);
  } finally {TestBed.resetTestingModule();}
});

test('selection cannot change while busy or with read-only access',async()=>{
  try {
    const {state,memberships}=await handoffSetup(); const file=new File(['x'],'clip.mp4',{type:'video/mp4'});
    state.busy.set(true); state.choose({target:{files:[file]}}); assert.equal(state.file,null);
    state.busy.set(false); memberships.set([{id:'workspace-fixture',role:'reader'}]);
    state.choose({target:{files:[file]}}); assert.equal(state.file,null);
  } finally {TestBed.resetTestingModule();}
});

test('drag and drop selects one video with the same validation and respects read-only access',async()=>{
  try {
    const {state,memberships}=await handoffSetup();
    const video=new File(['video'],'dropped.mp4',{type:'video/mp4'});
    const input={value:'previous.mp4'};
    let prevented=0;
    state.onFileDragOver({dataTransfer:{types:['Files']},preventDefault(){prevented++;}});
    assert.equal(state.draggingFile(),true);
    state.onFileDrop({dataTransfer:{files:[video]},preventDefault(){prevented++;}},input);
    assert.equal(prevented,2);
    assert.equal(state.draggingFile(),false);
    assert.equal(state.file,video);
    assert.equal(state.selectionError(),'');
    assert.equal(input.value,'');
    state.onFileDrop({dataTransfer:{files:[video,video]},preventDefault(){}},input);
    assert.equal(state.file,video);
    assert.match(state.selectionError(),/un solo video/);
    memberships.set([{id:'workspace-fixture',role:'reader'}]);
    state.onFileDrop({dataTransfer:{files:[new File(['other'],'other.mp4',{type:'video/mp4'})]},preventDefault(){}},input);
    assert.equal(state.file,video);
  } finally {TestBed.resetTestingModule();}
});

test('public design may preview a local file but cannot transfer it or invoke processing',async()=>{
  try {
    const {state,calls}=await handoffSetup({design:true});
    assert.equal(state.creatorWizardOpen(),true,'The design route opens directly into the clip creator.');
    assert.equal(state.creatorStep(),'source');
    state.choose({target:{files:[new File(['x'],'clip.mp4',{type:'video/mp4'})]}});
    assert.equal(state.file.name,'clip.mp4'); assert.ok(state.localPreview().startsWith('blob:'));
    await state.upload(); await state.startPipeline(); await state.createEdit();
    assert.deepEqual(calls.writes,[]); assert.deepEqual(calls.pipelines,[]); assert.deepEqual(calls.reads,[]);
    state.releaseLocalPreview();
  } finally {TestBed.resetTestingModule();}
});

test('confirmed filename follows the upload reference, never an untransferred replacement',async()=>{
  try {
    const {state,api}=await handoffSetup();
    state.file=new File(['x'],'accepted.mp4',{type:'video/mp4'});
    api.uploadFile=async(project,file,progress,remember)=>{ progress('Transfiriendo','transferring'); assert.equal(state.sourceStageIndex(),1); remember('new-upload'); assert.equal(state.sourceFileName(),''); assert.equal(state.hasUnuploadedSelection(),true); return {id:'new-upload',projectId:'project-fixture',state:'confirmed',inspection:{status:'succeeded'}}; };
    await state.upload(); assert.equal(state.sourceFileName(),'accepted.mp4'); assert.equal(state.hasUnuploadedSelection(),false); assert.equal(state.sourceStageIndex(),3);
    state.choose({target:{files:[new File(['y'],'replacement.mp4',{type:'video/mp4'})]}});
    assert.equal(state.sourceFileName(),'accepted.mp4'); assert.equal(state.hasUnuploadedSelection(),true);
    api.uploadFile=async()=>{throw new Error('Transferencia no iniciada');}; await state.upload();
    assert.equal(state.sourceFileName(),'accepted.mp4'); assert.equal(state.uploadId,'new-upload');
    state.selectUpload('other-upload'); assert.equal(state.sourceFileName(),'');
    state.releaseLocalPreview();
  } finally {TestBed.resetTestingModule();}
});

test('a failed transfer is inspected before retry, blocks duplicate pending intents and requires explicit release',async()=>{
  try {
    const {state,api}=await handoffSetup();
    state.choose({target:{files:[new File(['video'],'retry.mp4',{type:'video/mp4'})]}});
    api.uploadFile=async(_project,_file,_progress,remember)=>{remember('pending-upload');throw new Error('storage unavailable');};
    api.upload=async id=>({id,projectId:'project-fixture',state:'pending',inspection:null});
    await state.upload();
    assert.equal(state.uploadId,'pending-upload');
    assert.equal(state.uploadStatus().state,'pending');
    assert.equal(state.sourceFileName(),'');
    assert.equal(state.hasUnuploadedSelection(),true);
    assert.equal(state.uploadBlocked(),true);
    assert.match(state.uploadFailure(),/storage unavailable/);
    assert.match(state.uploadRecoveryLabel(),/Abórtala/);
    api.uploadFile=async()=>{throw new Error('No debe crear una segunda intención');};
    await state.upload();
    assert.match(state.uploadError(),/Abórtala para liberar su reserva/);
    await state.abortUpload();
    assert.equal(state.uploadStatus().state,'aborted');
    assert.equal(state.uploadBlocked(),false);
    api.uploadFile=async(_project,file,_progress,remember)=>{remember('retry-upload');return{id:'retry-upload',projectId:'project-fixture',state:'confirmed',bytes:file.size,inspection:{status:'queued'}};};
    api.upload=async id=>({id,projectId:'project-fixture',state:'confirmed',inspection:{status:'succeeded',result:{durationSeconds:20}}});
    await state.upload();
    assert.equal(state.uploadFailure(),'');
    assert.equal(state.sourceFileName(),'retry.mp4');
    assert.equal(state.intervalReady(),true);
  } finally {TestBed.resetTestingModule();}
});

test('failed inspection recovery asks for a new file selection before creating a fresh upload',async()=>{
  const originalCreate=URL.createObjectURL, originalRevoke=URL.revokeObjectURL;
  URL.createObjectURL=()=> 'blob:inspection-retry'; URL.revokeObjectURL=()=>{};
  try {
    const {state,api}=await handoffSetup();
    const previous=new File(['bad video'],'same.mp4',{type:'video/mp4'});
    state.file=previous; state.uploadedFile=previous; state.uploadStatus.set({id:'failed-upload',projectId:'project-fixture',state:'confirmed',bytes:10,inspection:{status:'failed',errorCode:'INSPECTION_FAILED'}});
    state.uploadId='failed-upload';
    const input={value:'same.mp4',focus(){this.focused=true;}};
    state.prepareInspectionRetry(input);
    assert.equal(state.file,null); assert.equal(input.value,''); assert.equal(input.focused,true);
    assert.equal(state.uploadStatus().inspection.status,'failed');
    const replacement=new File(['good video'],'same.mp4',{type:'video/mp4'});
    state.choose({target:{files:[replacement]}});
    assert.equal(state.hasUnuploadedSelection(),true);
    api.uploadFile=async(_project,_file,_progress,remember)=>{remember('fresh-upload');return{id:'fresh-upload',projectId:'project-fixture',state:'confirmed',inspection:{status:'queued'}};};
    api.upload=async id=>({id,projectId:'project-fixture',state:'confirmed',bytes:10,inspection:{status:'succeeded',result:{durationSeconds:12}}});
    await state.upload();
    assert.equal(state.uploadId,'fresh-upload'); assert.equal(state.sourceFileName(),'same.mp4'); assert.equal(state.intervalReady(),true);
  } finally {URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;TestBed.resetTestingModule();}
});

test('clip review fetches the real private artifact on demand and releases it when the result changes',async()=>{
  const originalFetch=globalThis.fetch, originalCreate=URL.createObjectURL, originalRevoke=URL.revokeObjectURL;
  const revoked=[]; const fetched=[];
  globalThis.fetch=async(url,options)=>{fetched.push([url,options]);return{ok:true,blob:async()=>new Blob(['mp4'],{type:'video/mp4'})};};
  URL.createObjectURL=()=> 'blob:clip-review';
  URL.revokeObjectURL=url=>revoked.push(url);
  try {
    const {state,api}=await handoffSetup();
    state.selectPipeline('clip-pipeline');
    state.pipeline.set({id:'clip-pipeline',status:'succeeded'});
    api.pipelineDownload=async(id,kind)=>{assert.equal(id,'clip-pipeline');assert.equal(kind,'video');return{url:'https://media.example.test/private.mp4?token=fixture'};};
    assert.deepEqual(fetched,[]);
    await state.previewPipeline();
    assert.equal(state.clipPreviewUrl(),'blob:clip-review');
    assert.equal(fetched.length,1);
    assert.equal(fetched[0][1].credentials,'omit');
    assert.equal(fetched[0][1].redirect,'error');
    state.clipPreviewPlaybackFailed();
    assert.equal(state.clipPreviewUrl(),'');
    assert.match(state.clipPreviewError(),/no se pudo reproducir/);
    await state.previewPipeline();
    assert.equal(state.clipPreviewUrl(),'blob:clip-review');
    state.selectPipeline('another-pipeline');
    assert.equal(state.clipPreviewUrl(),'');
    assert.deepEqual(revoked,['blob:clip-review','blob:clip-review']);
  } finally {globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;TestBed.resetTestingModule();}
});

test('retrying a failed pipeline creates a fresh request with the failed interval and selected upload',async()=>{
  try {
    const {state,api}=await handoffSetup();
    const failedSpec={version:1,provider:'whisper_cpp',language:'es',selection:{mode:'none'},startSeconds:3.2,endSeconds:12.4,aspect:'vertical'};
    state.pipelineId='failed-pipeline'; state.pipelineUploadId='upload-fixture';
    state.pipeline.set({id:'failed-pipeline',status:'failed',spec:failedSpec,events:[],errorCode:'ASR_FAILED'});
    state.startSeconds=0; state.endSeconds=10; state.aspect='square'; state.language='auto';
    let request;
    api.createPipeline=async(uploadId,body)=>{request={uploadId,body:structuredClone(body)};return{id:'retry-pipeline',status:'queued',spec:body,events:[]};};
    api.pipeline=async id=>({id,status:'queued',spec:request.body,events:[]});
    await state.retryPipelineResult();
    assert.equal(request.uploadId,'upload-fixture');
    assert.equal(request.body.startSeconds,3.2);
    assert.equal(request.body.endSeconds,12.4);
    assert.equal(request.body.aspect,'vertical');
    assert.equal(request.body.language,'es');
    assert.equal(state.pipelineId,'retry-pipeline');
    assert.equal(state.pipelineUploadId,'upload-fixture');
  } finally {TestBed.resetTestingModule();}
});

test('manual MP4 processing uses the real clip contract without ASR subtitles and can continue to the editor',async()=>{
  try {
    const {state,api,calls}=await handoffSetup();
    state.startSeconds=2.5; state.endSeconds=18; state.aspect='square';
    let request;
    api.createProcessing=async(uploadId,body,key)=>{request={uploadId,body:structuredClone(body),key};return{id:'manual-processing',status:'queued'};};
    api.processing=async id=>({id,status:'succeeded',attempts:1,errorCode:null,startedAt:null,finishedAt:null,cleanupPending:false,spec:{...request.body},artifacts:[{kind:'video',bytes:100,sha256:'digest',contentType:'video/mp4'}],durationSeconds:15.5});
    api.createEdit=async(uploadId,body,key)=>{calls.writes.push({uploadId,body:structuredClone(body),key});return{id:'manual-draft',projectId:'project-fixture',uploadId,name:body.name,version:1,revision:{id:'manual-revision',version:1,spec:body.spec}};};
    await state.startManualProcessing();
    assert.equal(request.uploadId,'upload-fixture');
    assert.deepEqual(request.body,{version:1,kind:'clip',startSeconds:2.5,endSeconds:18,aspect:'square'});
    assert.ok(request.key);
    assert.equal(state.manualProcessing().status,'succeeded');
    assert.equal(state.workflowStatus('render'),'MP4 manual listo');
    state.pipelineId='previous-auto';state.pipelineUploadId='upload-fixture';
    state.pipeline.set({id:'previous-auto',status:'succeeded',analysisId:'old-transcript',spec:{version:2,mode:'automatic',subtitles:{source:'transcript'}}});
    await state.editManualProcessingResult();
    assert.equal(calls.writes.at(-1).body.spec.subtitles.source,'none');
  } finally {TestBed.resetTestingModule();}
});

test('retrying a failed manual render restores its original interval and submits a new processing request',async()=>{
  try {
    const {state,api}=await handoffSetup();
    state.manualProcessingId='failed-render';state.manualProcessingUploadId='upload-fixture';state.resultKind.set('manual');
    state.manualProcessing.set({id:'failed-render',status:'failed',errorCode:'RENDER_FAILED',spec:{startSeconds:3.5,endSeconds:14,aspect:'square'}});
    state.startSeconds=0;state.endSeconds=10;state.aspect='vertical';
    let request;
    api.createProcessing=async(uploadId,body,key)=>{request={uploadId,body:structuredClone(body),key};return{id:'retried-render'};};
    api.processing=async id=>({id,status:'queued',spec:request.body});
    await state.retryManualProcessingResult();
    assert.equal(state.creatorStep(),'generation');
    assert.equal(state.manualProcessingId,'retried-render');
    assert.deepEqual(request.body,{version:1,kind:'clip',startSeconds:3.5,endSeconds:14,aspect:'square'});
    assert.ok(request.key);
  } finally {TestBed.resetTestingModule();}
});

test('transcription preflight failure explains the issue in Spanish and points to manual processing',async()=>{
  try {
    const {state,api}=await handoffSetup();
    api.createPipeline=async()=>{throw new HttpErrorResponse({status:503,error:{code:'TRANSCRIPTION_NOT_CONFIGURED',message:'ASR is unavailable',correlationId:'correlation-fixture'}});};
    api.analysisProviders=async()=>({transcription:{whisper_cpp:{maxSeconds:300,diagnostic:{missingSettings:['WHISPER_PATH','WHISPER_MODEL_PATH'],nextSteps:['Mount the verified local Whisper model.']}}},selection:{ollama:{diagnostic:{missingSettings:['OLLAMA_URL'],nextSteps:['Start Ollama.']}}}});
    await state.startPipeline();
    assert.match(state.pipelineError(),/transcripción local no está disponible/);
    assert.match(state.pipelineError(),/intervalo manual/);
    assert.doesNotMatch(state.pipelineError(),/WHISPER_PATH|OLLAMA_URL|TRANSCRIPTION_NOT_CONFIGURED/);
    assert.equal(state.pipelineManualFallbackAvailable(),true);
    assert.equal(state.pipeline(),null);
  } finally {TestBed.resetTestingModule();}
});

test('an incompatible old selection response does not ask the user to enable paid OpenAI',async()=>{
  try {
    const {state,api}=await handoffSetup();
    api.createPipeline=async()=>{throw new HttpErrorResponse({status:503,error:{code:'OPENAI_API_KEY_MISSING',message:'selector unavailable',correlationId:'selector-fixture'}});};
    api.analysisProviders=async()=>({transcription:{whisper_cpp:{maxSeconds:300,diagnostic:{missingSettings:[],nextSteps:[]}}},selection:{provider:'openai',openai:{configured:false,diagnostic:{configured:false,status:'missing_configuration',code:'OPENAI_API_KEY_MISSING',missingSettings:['OPENAI_API_KEY','PAID_AI_ENABLED','AI_MAX_ESTIMATED_USD_PER_JOB'],nextSteps:[]}},ollama:{configured:false,diagnostic:{configured:false,status:'missing_configuration',code:'SELECTION_NOT_CONFIGURED',missingSettings:[],nextSteps:[]}}}});
    await state.startAutomaticPipeline();
    assert.match(state.pipelineError(),/OpenAI/i);
    assert.match(state.pipelineError(),/IA|OpenAI/);
    assert.match(state.pipelineError(),/clave de OpenAI/);
    assert.match(state.pipelineError(),/recorte manual/);
    assert.equal(state.pipelineManualFallbackAvailable(),true);
    assert.equal(state.pipeline(),null);
  } finally {TestBed.resetTestingModule();}
});

test('a stale paid-selector budget error never starts a paid retry from local automatic mode',async()=>{
  try {
    const {state,api}=await handoffSetup();
    api.createPipeline=async()=>{throw new HttpErrorResponse({status:503,error:{code:'AI_BUDGET_NOT_AUTHORIZED',message:'budget closed',correlationId:'budget-fixture'}});};
    api.analysisProviders=async()=>({transcription:{whisper_cpp:{maxSeconds:300,diagnostic:{missingSettings:[],nextSteps:[]}}},selection:{provider:'openai',openai:{configured:false,diagnostic:{configured:false,status:'missing_configuration',code:'AI_BUDGET_NOT_AUTHORIZED',missingSettings:['PAID_AI_ENABLED','AI_MAX_ESTIMATED_USD_PER_JOB'],nextSteps:[]}},ollama:{configured:false,diagnostic:{configured:false,status:'missing_configuration',code:'SELECTION_NOT_CONFIGURED',missingSettings:[],nextSteps:[]}}}});
    await state.startAutomaticPipeline();
    assert.match(state.pipelineError(),/IA|OpenAI/);
    assert.match(state.pipelineError(),/No se generaron clips/);
    assert.match(state.pipelineError(),/recorte manual/);
    assert.doesNotMatch(state.pipelineError(),/AI_BUDGET_NOT_AUTHORIZED|PAID_AI_ENABLED|AI_MAX_ESTIMATED_USD_PER_JOB/);
    assert.equal(state.pipelineManualFallbackAvailable(),true);
    assert.equal(state.pipeline(),null);
  } finally {TestBed.resetTestingModule();}
});

test('legacy server selector errors explain local selection is unavailable and offer manual intervals',async()=>{
  try {
    const {state,api}=await handoffSetup();
    api.createPipeline=async()=>{throw new HttpErrorResponse({status:503,error:{code:'SELECTION_PROVIDER_UNAVAILABLE',message:'selector unavailable',correlationId:'selector-provider-fixture'}});};
    api.analysisProviders=async()=>({transcription:{whisper_cpp:{maxSeconds:300,diagnostic:{missingSettings:[],nextSteps:[]}}},selection:{provider:'ollama',ollama:{configured:false,diagnostic:{configured:false,status:'missing_configuration',code:'SELECTION_PROVIDER_UNAVAILABLE',missingSettings:[],nextSteps:['Start Ollama and confirm its local API.']}},openai:{configured:false,diagnostic:{configured:false,status:'missing_configuration',code:null,missingSettings:[],nextSteps:[]}}}});
    await state.startAutomaticPipeline();
    assert.match(state.pipelineError(),/proveedor de IA/);
    assert.match(state.pipelineError(),/recorte manual/);
    assert.doesNotMatch(state.pipelineError(),/SELECTION_PROVIDER_UNAVAILABLE|Ollama/);
    assert.equal(state.pipelineManualFallbackAvailable(),true);
    assert.equal(state.pipeline(),null);
  } finally {TestBed.resetTestingModule();}
});

test('local Whisper duration preflight explains the actual limit and offers manual or shorter-source actions',async()=>{
  try {
    const {state,api}=await handoffSetup();
    api.createPipeline=async()=>{throw new HttpErrorResponse({status:400,error:{code:'LOCAL_TRANSCRIPTION_DURATION_LIMIT',message:'Local transcription duration limit'}});};
    api.analysisProviders=async()=>({transcription:{whisper_cpp:{maxSeconds:300,diagnostic:{missingSettings:[],nextSteps:[]}}},selection:{ollama:{diagnostic:{missingSettings:[],nextSteps:[]}}}});
    await state.startAutomaticPipeline();
    assert.match(state.pipelineError(),/300 segundos/);
    assert.match(state.pipelineError(),/Recorte manual/);
    assert.doesNotMatch(state.pipelineError(),/LOCAL_TRANSCRIPTION_DURATION_LIMIT/);
    assert.equal(state.error(),'');
    assert.equal(state.pipelineManualFallbackAvailable(),true);
    assert.equal(state.pipeline(),null);
  } finally {TestBed.resetTestingModule();}
});

test('automatic generation submits only the v2 configuration and preserves per-clip partial results',async()=>{
  try {
    const {state,api}=await handoffSetup();
    state.clipCount=2; state.limitClipDuration=true; state.maxDurationSeconds=45; state.contentType='gameplay'; state.aspect='vertical'; state.includeSubtitles=false; state.language='es';
    let submitted;
    const response={id:'auto-pipeline',status:'partial_failed',spec:{version:2,mode:'automatic',provider:'whisper_cpp',language:'es',clipCount:2,maxDurationSeconds:45,contentType:'gameplay',aspect:'vertical',subtitles:{source:'none'}},version:2,cancellationRequested:false,usageState:'accepted',errorCode:null,createdAt:'2026-10-20T10:00:00Z',deadlineAt:'2026-10-20T11:00:00Z',finishedAt:'2026-10-20T10:10:00Z',audioProcessingId:'audio-fixture',analysisId:'analysis-fixture',renderProcessingId:null,reservedBytes:0,requestedClips:2,completedClips:1,settledClips:2,events:[],clips:[{index:0,status:'succeeded',title:'Mejor jugada',startSeconds:5,endSeconds:22,processingId:'render-one',errorCode:null},{index:1,status:'failed',title:'Otra jugada',startSeconds:31,endSeconds:48,processingId:null,errorCode:'RENDER_FAILED'}]};
    api.createPipeline=async(uploadId,body,key)=>{submitted={uploadId,body:structuredClone(body),key};return response;};
    api.pipeline=async()=>response;
    await state.startAutomaticPipeline();
    assert.equal(submitted.uploadId,'upload-fixture');
    assert.deepEqual(submitted.body,{version:2,mode:'automatic',provider:'whisper_cpp',selectionMode:'llm',language:'es',clipCount:2,maxDurationSeconds:45,contentType:'gameplay',instructions:'',aspect:'vertical',subtitles:{source:'none'}});
    assert.equal(submitted.body.instructions,'','Local selection sends no user prompt; the empty value satisfies the v2 contract.');
    assert.ok(submitted.key);
    assert.equal(state.pipeline().status,'partial_failed');
    assert.equal(state.pipelineClips().length,2);
    assert.equal(state.pipelineStateLabel('partial_failed'),'Completado con errores parciales');
    assert.match(state.pipelineFailureMessage('PIPELINE_SOME_CLIPS_FAILED'),/clips fallaron/);
    assert.equal(state.hasLinkedTranscript(),true);
    assert.equal(state.pipelineInProgress(),false);
    state.includeSubtitles=true; await state.startAutomaticPipeline();
    assert.deepEqual(submitted.body.subtitles,{source:'transcript',style:{template:'clean',fontSize:24,position:'bottom'}});
  } finally {TestBed.resetTestingModule();}
});

test('automatic clip editor handoff uses the selected clip interval and real pipeline transcript',async()=>{
  try {
    const {state,api,calls}=await handoffSetup();
    state.pipelineId='auto-pipeline';state.pipelineUploadId='upload-fixture';
    state.pipeline.set({id:'auto-pipeline',status:'succeeded',spec:{version:2,mode:'automatic',provider:'whisper_cpp',language:'es',clipCount:2,contentType:'tutorial',aspect:'square',subtitles:{source:'transcript',style:{template:'boxed',fontSize:32,position:'top'}}},analysisId:'analysis-fixture',events:[],clips:[{index:1,status:'succeeded',title:'Consejo clave',startSeconds:4.5,endSeconds:18.5,processingId:'clip-render',errorCode:null}]});
    state.subtitleStyle={template:'clean',fontSize:16,position:'bottom'};
    api.createEdit=async(uploadId,body,key)=>{calls.writes.push({uploadId,body:structuredClone(body),key});return{id:'clip-draft',projectId:'project-fixture',uploadId,name:body.name,version:1,revision:{id:'clip-revision',version:1,spec:body.spec}};};
    await state.editPipelineClip(1);
    assert.equal(calls.writes[0].body.spec.startSeconds,4.5);
    assert.equal(calls.writes[0].body.spec.endSeconds,18.5);
    assert.deepEqual(calls.writes[0].body.spec.subtitles,{source:'transcript',analysisId:'analysis-fixture',style:{template:'boxed',fontSize:32,position:'top'}});
    assert.equal(calls.writes[0].body.name,'Proyecto de prueba · Consejo clave');
    await state.editPipelineClip(1);
    assert.equal(calls.writes.length,1,'Reopening the same returned clip reuses its saved draft.');
  } finally {TestBed.resetTestingModule();}
});

test('editor handoff honors disabled captions and refuses to lose an unconfirmed transcript',async()=>{
  try {
    const {state,calls}=await handoffSetup();
    const task={id:'auto-result',status:'partial_failed',spec:{version:2,mode:'automatic',aspect:'vertical',language:'es',subtitles:{source:'none'}},analysisId:'analysis-fixture',clips:[{index:0,status:'succeeded',title:'Sin subtítulos',startSeconds:1,endSeconds:5},{index:1,status:'failed',startSeconds:5,endSeconds:10}]};
    state.pipelineId=task.id;state.pipelineUploadId=state.uploadId;state.pipeline.set(task);
    state.includeSubtitles=true;
    await state.editPipelineClip(0);
    assert.deepEqual(calls.writes[0].body.spec.subtitles,{source:'none'});
    await state.editPipelineClip(1);
    assert.equal(calls.writes.length,1,'Failed clips cannot create editor drafts.');
    state.pipeline.set({...task,analysisId:null,spec:{...task.spec,subtitles:{source:'transcript'}}});
    await state.editPipelineClip(0);
    assert.equal(calls.writes.length,1,'Missing transcript provenance cannot silently turn subtitles off.');
    assert.match(state.error(),/falta confirmar su transcripción/);
  } finally {TestBed.resetTestingModule();}
});

test('returning to settings restores the submitted automatic options without resubmitting or losing partial results',async()=>{
  try {
    const {state,calls}=await handoffSetup();
    const task={id:'partial-result',status:'partial_failed',spec:{version:2,mode:'automatic',provider:'whisper_cpp',clipCount:2,language:'en',contentType:'interview',aspect:'square',subtitles:{source:'none'}},clips:[{index:0,status:'succeeded'},{index:1,status:'failed'}]};
    state.pipelineId=task.id;state.pipelineUploadId=state.uploadId;state.pipeline.set(task);
    state.generationMode='manual';state.limitClipDuration=true;state.maxDurationSeconds=15;state.clipCount=3;state.includeSubtitles=true;
    state.configureFromResult(false);
    assert.equal(state.creatorStep(),'configuration');
    assert.deepEqual([state.generationMode,state.clipCount,state.language,state.aspect,state.contentType,state.limitClipDuration,state.includeSubtitles],['automatic',2,'en','square','interview',false,false]);
    assert.equal(state.pipeline(),task,'Preparing another run keeps the available result intact.');
    assert.equal(state.resultReadyCount(),1);
    assert.deepEqual(calls.pipelines,[]);
    state.pipelineUploadId='another-upload';state.clipCount=1;
    state.configureFromResult(false);
    assert.equal(state.clipCount,1,'Another source cannot replace the selected upload or its options.');
  } finally {TestBed.resetTestingModule();}
});

test('a previous completed job cannot finish a newer manual run or pull navigation away from settings',async()=>{
  try {
    const {state,api}=await handoffSetup();
    state.pipelineId='older-pipeline';state.pipelineUploadId=state.uploadId;
    const old={id:'older-pipeline',status:'succeeded',spec:{version:1,startSeconds:0,endSeconds:5},events:[]};
    state.pipeline.set(old);
    state.manualProcessingId='current-manual';state.manualProcessingUploadId=state.uploadId;state.resultKind.set('manual');
    state.manualProcessing.set({id:'current-manual',status:'running'});
    assert.equal(state.reviewReady(),false);
    state.openCreatorWizard();
    assert.equal(state.creatorStep(),'generation','The real running status survives between status polls.');
    api.pipeline=async()=>old;await state.pollPipeline();
    assert.equal(state.creatorStep(),'generation','The older pipeline cannot complete the active manual view.');
    state.creatorStep.set('configuration');
    api.processing=async()=>({id:'current-manual',status:'succeeded',spec:{startSeconds:2,endSeconds:6,aspect:'vertical'}});
    await state.pollManualProcessing();
    assert.equal(state.creatorStep(),'configuration','Completion must not interrupt the screen the user selected.');
    state.showResult('manual');
    assert.equal(state.creatorStep(),'review');
    assert.equal(state.resultReadyCount(),1);
    state.configureFromResult(false);
    assert.deepEqual([state.generationMode,state.startSeconds,state.endSeconds],['manual',2,6]);
  } finally {TestBed.resetTestingModule();}
});

test('manual render stages follow only the confirmed queue and worker status',()=>{
  const state=Object.create(ProjectComponent.prototype);
  const stages=(status,startedAt=null)=>state.manualProcessingProgress({status,startedAt}).map(stage=>stage.state);
  assert.deepEqual(stages('queued'),['complete','current','pending']);
  assert.deepEqual(stages('running','2026-10-28T10:00:00.000Z'),['complete','complete','current']);
  assert.deepEqual(stages('succeeded','2026-10-28T10:00:00.000Z'),['complete','complete','complete']);
  assert.deepEqual(stages('failed'),['complete','failed','pending'],'A failure without a worker start is attributed to the queue.');
  assert.deepEqual(stages('failed','2026-10-28T10:00:00.000Z'),['complete','complete','failed']);
  assert.deepEqual(stages('cancelled'),['complete','cancelled','pending']);
  assert.deepEqual(stages('cancelled','2026-10-28T10:00:00.000Z'),['complete','complete','cancelled']);
});

test('manual preview uses its real artifact and ignores a response after switching to another result',async()=>{
  const originalFetch=globalThis.fetch,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
  let fetches=0;const revoked=[];
  globalThis.fetch=async()=>{fetches++;return{ok:true,blob:async()=>new Blob(['mp4'])};};
  URL.createObjectURL=()=> 'blob:manual-result';URL.revokeObjectURL=url=>revoked.push(url);
  try {
    const {state,api}=await handoffSetup();
    state.manualProcessingId='manual-preview';state.resultKind.set('manual');state.manualProcessing.set({id:'manual-preview',status:'succeeded'});
    state.pipelineId='other-result';state.pipeline.set({id:'other-result',status:'succeeded'});
    let finish;api.processingDownload=()=>new Promise(resolve=>{finish=resolve;});
    const pending=state.previewManualProcessing();
    state.showResult('pipeline');finish({url:'https://media.example.test/manual.mp4'});await pending;
    assert.equal(fetches,0);assert.equal(state.clipPreviewUrl(),'');
    state.showResult('manual');api.processingDownload=async()=>({url:'https://media.example.test/manual.mp4'});
    await state.previewManualProcessing();assert.equal(state.clipPreviewUrl(),'blob:manual-result');
    state.showResult('pipeline');assert.equal(state.clipPreviewUrl(),'');assert.deepEqual(revoked,['blob:manual-result']);
    state.showResult('manual');api.processingDownload=async()=>{throw new Error('Enlace temporal no disponible');};
    await state.previewManualProcessing();assert.match(state.clipPreviewError(),/Enlace temporal no disponible/);
    api.processingDownload=async()=>({url:'https://media.example.test/manual.mp4'});await state.previewManualProcessing();
    api.createProcessing=async()=>({id:'new-manual'});api.processing=async()=>({id:'new-manual',status:'queued'});
    await state.startManualProcessing();
    assert.equal(state.clipPreviewUrl(),'','A newly accepted job must not display the previous rendered clip.');
    assert.equal(state.manualProcessingId,'new-manual');
  } finally {globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;TestBed.resetTestingModule();}
});

test('a late manual download grant cannot download a result after switching jobs',async()=>{
  const originalFetch=globalThis.fetch;let fetches=0,finish;
  globalThis.fetch=async()=>{fetches++;return{ok:true,blob:async()=>new Blob(['mp4'])};};
  try {
    const {state,api}=await handoffSetup();
    state.manualProcessingId='manual-download';state.resultKind.set('manual');state.manualProcessing.set({id:'manual-download',status:'succeeded'});
    state.pipelineId='pipeline-current';state.pipeline.set({id:'pipeline-current',status:'running',events:[]});
    api.processingDownload=()=>new Promise(resolve=>{finish=resolve;});
    const pending=state.downloadManualProcessing();
    state.showResult('pipeline');finish({url:'https://media.example.test/manual.mp4'});await pending;
    assert.equal(fetches,0,'A signed download grant arriving for the hidden manual job must not start a file transfer.');
  } finally {globalThis.fetch=originalFetch;TestBed.resetTestingModule();}
});

test('a late clip download grant cannot download a clip after its pipeline is replaced',async()=>{
  const originalFetch=globalThis.fetch;let fetches=0,finish;
  globalThis.fetch=async()=>{fetches++;return{ok:true,blob:async()=>new Blob(['mp4'])};};
  try {
    const {state,api}=await handoffSetup();
    state.pipelineId='pipeline-old';state.pipeline.set({id:'pipeline-old',status:'succeeded',clips:[{index:0,status:'succeeded'}]});
    api.pipelineClipDownload=()=>new Promise(resolve=>{finish=resolve;});
    const pending=state.downloadPipelineClip(0);
    state.pipelineId='pipeline-new';state.pipeline.set({id:'pipeline-new',status:'running',clips:[]});
    finish({url:'https://media.example.test/old-clip.mp4'});await pending;
    assert.equal(fetches,0,'A grant for a replaced result must not start a stale download.');
  } finally {globalThis.fetch=originalFetch;TestBed.resetTestingModule();}
});

test('individual clip downloads use the indexed clip endpoint and encoded kind',async()=>{
  try {
    const api=Object.create(ProjectsApi.prototype);let requested;
    api.api={get:async path=>{requested=path;return{url:'https://media.example.test/clip'};}};
    await api.pipelineClipDownload('pipeline id',2,'vtt');
    assert.equal(requested,'/pipelines/pipeline%20id/clips/2/download?kind=vtt');
  } finally {TestBed.resetTestingModule();}
});

test('upload and pipeline responses must match their requested IDs before enabling the next step',async()=>{
  try {
    const {state,api}=await handoffSetup();
    state.selectUpload('requested-upload');
    api.upload=async()=>({id:'other-upload',projectId:'project-fixture',state:'confirmed',inspection:{status:'succeeded',result:{durationSeconds:20}}});
    await state.inspect();
    assert.equal(state.uploadStatus(),null);
    assert.match(state.uploadError(),/no corresponde al ID y proyecto/);
    assert.equal(state.inspected(),false);

    state.selectUpload('upload-fixture');
    state.selectPipeline('requested-pipeline');
    state.pipelineUploadId='upload-fixture';
    state.pipeline.set({id:'requested-pipeline',status:'queued',events:[]});
    api.pipeline=async()=>({id:'other-pipeline',status:'succeeded',analysisId:'untrusted-analysis',events:[]});
    await state.pollPipeline();
    assert.equal(state.pipeline().id,'requested-pipeline');
    assert.equal(state.pipeline().status,'queued');
    assert.equal(state.hasLinkedTranscript(),false);
    assert.match(state.pipelineError(),/no corresponde al pipeline consultado/);
  } finally {TestBed.resetTestingModule();}
});

test('editing a completed clip uses its returned spec and cannot claim an unknown or different source',async()=>{
  try {
    const {state,calls}=await handoffSetup();
    state.pipelineId='pipeline-fixture';
    state.pipeline.set({id:'pipeline-fixture',status:'succeeded',analysisId:'analysis-fixture',spec:{startSeconds:2,endSeconds:8,aspect:'square',language:'es'}});
    state.startSeconds=0; state.endSeconds=15;
    await state.editPipelineResult(); assert.equal(calls.writes.length,0);
    state.pipelineUploadId='other-upload'; await state.editPipelineResult(); assert.equal(calls.writes.length,0);
    state.pipelineUploadId='upload-fixture'; await state.editPipelineResult();
    assert.equal(calls.writes.length,1); assert.equal(calls.writes[0].body.spec.startSeconds,2);
    assert.equal(calls.writes[0].body.spec.endSeconds,8); assert.equal(calls.writes[0].body.spec.aspect,'square');
    assert.equal(calls.writes[0].body.spec.subtitles.analysisId,'analysis-fixture');
    assert.equal(state.workbench(),'drafts'); assert.equal(calls.navigations.length,1);
  } finally {TestBed.resetTestingModule();}
});

test('clip review filters use confirmed server statuses and editor drafts retain both requested and clip titles',async()=>{
  try {
    const {state,calls}=await handoffSetup();
    const clips=[
      {index:0,status:'succeeded',title:'Una idea clave',startSeconds:1,endSeconds:5,errorCode:null},
      {index:1,status:'failed',title:'Un clip fallido',startSeconds:8,endSeconds:12,errorCode:'RENDER_FAILED'},
      {index:2,status:'running',title:'Clip en proceso',startSeconds:13,endSeconds:17,errorCode:null},
    ];
    state.pipelineId='pipeline-fixture';state.pipelineUploadId=state.uploadId;state.clipTitle='Episodio 45';
    const task={id:'pipeline-fixture',status:'succeeded',analysisId:null,spec:{version:2,mode:'automatic',provider:'whisper_cpp',language:'es',clipCount:3,contentType:'general',aspect:'vertical',subtitles:{source:'none'}},clips};
    state.pipeline.set(task);
    assert.deepEqual(state.filteredPipelineClips(task).map(clip=>clip.index),[0,1,2]);
    assert.equal(state.pipelineClipCount('ready',task),1);
    assert.equal(state.pipelineClipCount('attention',task),1);
    assert.equal(state.pipelineClipCount('working',task),1);
    assert.equal(state.draftTitle('Una idea clave'),'Episodio 45 · Una idea clave');
    state.reviewFilter.set('ready');
    assert.deepEqual(state.filteredPipelineClips(task).map(clip=>clip.index),[0]);
    state.reviewFilter.set('attention');
    assert.deepEqual(state.filteredPipelineClips(task).map(clip=>clip.index),[1]);
    state.reviewFilter.set('working');
    assert.deepEqual(state.filteredPipelineClips(task).map(clip=>clip.index),[2]);
    await state.editPipelineClip(0);
    assert.equal(calls.writes[0].body.name,'Episodio 45 · Una idea clave');
    assert.equal(calls.writes[0].body.spec.startSeconds,1);
    assert.equal(calls.writes[0].body.spec.endSeconds,5);
    assert.equal(calls.writes[0].body.spec.aspect,'vertical');
  } finally {TestBed.resetTestingModule();}
});

test('draft handoff waits for the selected pipeline and then uses its returned interval and linked analysis',async()=>{
  try {
    const {state,calls}=await handoffSetup();
    state.startSeconds=0;state.endSeconds=15;state.pipelineId='pipeline-fixture';state.pipelineUploadId=state.uploadId;
    state.pipeline.set({id:'pipeline-fixture',status:'analysis',analysisId:null,spec:{startSeconds:2,endSeconds:8,aspect:'square',language:'es'},events:[]});
    assert.equal(state.canCreateDraft(),false);
    assert.equal(state.workflowStatus('draft'),'Esperando transcripción');
    await state.createEdit();
    assert.equal(calls.writes.length,0,'No draft can lose the transcript link by racing the same pipeline.');
    assert.match(state.error(),/Espera a que termine el procesamiento/);
    state.pipelineUploadId='';
    assert.equal(state.canCreateDraft(),false,'An active pipeline with unknown source cannot race an unverified handoff.');
    state.pipelineUploadId=state.uploadId;
    state.pipeline.set({id:'pipeline-fixture',status:'succeeded',analysisId:'analysis-fixture',spec:{startSeconds:2,endSeconds:8,aspect:'square',language:'es'},events:[]});
    state.startSeconds=10;state.endSeconds=15;
    assert.equal(state.canCreateDraft(),true);
    await state.continueToEditor();
    assert.equal(calls.writes.length,1);
    assert.equal(calls.writes[0].body.spec.startSeconds,2);
    assert.equal(calls.writes[0].body.spec.endSeconds,8);
    assert.equal(calls.writes[0].body.spec.aspect,'square');
    assert.equal(calls.writes[0].body.spec.subtitles.analysisId,'analysis-fixture');
    assert.equal(calls.navigations.length,1);
  } finally {TestBed.resetTestingModule();}
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
  const upload = {id:'upload-b',projectId:'project',state:'confirmed',bytes:100,inspection:{status:'succeeded',result:{durationSeconds:20}}};
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
    assert.equal(state.workflowStatus('render'),'Clips disponibles');
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

test('a preview-only link cannot enter configuration; an explicitly selected inspected MP4 can', async () => {
  try {
    const {state,calls}=await handoffSetup();
    assert.equal(state.sourceOriginLabel(),'Archivo cargado · upload-f');
    assert.equal(state.intervalReady(),true);
    state.showSource('link');
    assert.equal(state.sourceMode(),'link');
    assert.equal(state.sourceOriginLabel(),'Archivo cargado · upload-f');
    assert.equal(state.creatorStepAvailable('configuration'),false,'An unchecked or invalid link cannot open configuration.');
    state.onLinkPreviewAvailable(true);
    assert.equal(state.linkPreviewAvailable(),true,'Validation confirms only that an official preview is available.');
    assert.equal(state.creatorStepAvailable('configuration'),false,'A preview is not a processing source and cannot unlock configuration.');
    assert.equal(state.canConfigureGeneration(),false,'Configuration controls stay unavailable until media is imported and inspected.');
    state.goToCreatorStep('configuration');
    assert.equal(state.creatorStep(),'source','A preview-only link must keep the user at the source step.');
    assert.equal(state.processingSourceReady(),false,'The player preview is not a processing asset.');
    assert.equal(state.creatorStepAvailable('generation'),false);
    assert.equal(state.canCreateDraft(),false);
    await state.startAutomaticPipeline();
    await state.startManualProcessing();
    await state.createEdit();
    assert.equal(calls.pipelines.length,0);
    assert.equal(calls.writes.length,0);
    assert.equal(state.uploadId,'upload-fixture');
    assert.equal(state.uploadStatus().id,'upload-fixture');
    state.continueWithCurrentUpload(false);
    assert.equal(state.sourceMode(),'file');
    assert.equal(state.processingSourceReady(),true);
    assert.equal(state.creatorStep(),'configuration');
    state.showSource('link');
    state.creatorStep.set('source');
    assert.equal(state.creatorStepAvailable('configuration'),false,'A preview cannot substitute for the previously uploaded MP4.');
    assert.equal(state.processingSourceReady(),false,'The previously selected MP4 is not silently substituted for the link.');
    state.selectUpload('');
    assert.equal(state.sourceOriginLabel(),'No hay un archivo cargado seleccionado');
  } finally { TestBed.resetTestingModule(); }
});

test('a link preview can return to the MP4 source without starting a project mutation', async () => {
  try {
    const {state,calls}=await handoffSetup();
    state.showSource('link');
    assert.equal(state.sourceActionLabel(),'Usar archivo MP4');
    assert.equal(state.sourceActionDisabled(),false);
    assert.equal(state.processingSourceReady(),false);
    await state.advanceSource();
    assert.equal(state.sourceMode(),'file');
    assert.equal(state.creatorStep(),'source');
    assert.equal(calls.pipelines.length,0);
    assert.equal(calls.writes.length,0);
  } finally { TestBed.resetTestingModule(); }
});

test('reload preserves a saved reference link and the confirmed MP4 configuration step', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = new Map();
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
  try {
    let {state}=await handoffSetup({userId:'qa'});
    state.showSource('link');
    state.onSourceLinkChanged('https://youtu.be/M7lc1UVf-VE');
    state.onLinkPreviewAvailable(true);
    state.generationMode='automatic'; state.clipTitle='Episodio guardado'; state.clipCount=2;
    state.limitClipDuration=true; state.maxDurationSeconds=60; state.startSeconds=4.5; state.endSeconds=18.5;
    state.aspect='square'; state.language='es'; state.contentType='gameplay';
    state.includeSubtitles=true; state.subtitleStyle={template:'boxed',fontSize:32,position:'top'};
    state.continueWithCurrentUpload(false);
    assert.equal(state.sourceMode(),'file');
    assert.equal(state.creatorStep(),'configuration');
    const saved=JSON.parse(storage.get('ac:resume:qa:project-fixture'));
    assert.equal(saved.sourceMode,'file');
    assert.equal(saved.creatorStep,'configuration');
    assert.deepEqual(saved.configuration,{generationMode:'automatic',clipTitle:'Episodio guardado',clipCount:2,limitClipDuration:true,maxDurationSeconds:60,startSeconds:4.5,endSeconds:18.5,aspect:'square',language:'es',contentType:'gameplay',selectionInstructions:'',includeSubtitles:true,subtitleStyle:{template:'boxed',fontSize:32,position:'top'}});
    TestBed.resetTestingModule();

    ({state}=await handoffSetup({userId:'qa',seedUpload:false}));
    assert.equal(state.sourceLinkDraft(),'https://youtu.be/M7lc1UVf-VE');
    assert.equal(state.linkPreviewOpened(),true);
    assert.equal(state.sourceMode(),'file','A reference link must not replace the selected MP4 after reload.');
    assert.equal(state.processingSourceReady(),true);
    state.openCreatorWizard();
    assert.equal(state.creatorStep(),'configuration','The persisted step remains available after revalidating the upload.');
    assert.deepEqual([state.generationMode,state.clipTitle,state.clipCount,state.limitClipDuration,state.maxDurationSeconds,state.startSeconds,state.endSeconds,state.aspect,state.language,state.contentType,state.includeSubtitles,state.subtitleStyle],['automatic','Episodio guardado',2,true,60,4.5,18.5,'square','es','gameplay',true,{template:'boxed',fontSize:32,position:'top'}]);
  } finally {
    TestBed.resetTestingModule();
    if(originalStorage) Object.defineProperty(globalThis,'sessionStorage',originalStorage);
    else delete globalThis.sessionStorage;
  }
});

test('Twitch import advances only after the server confirms and inspection measures its upload', async () => {
  try {
    const {state,api}=await handoffSetup();
    api.upload=async id=>({id,projectId:'project-fixture',state:'confirmed',inspection:{status:'running'}});
    state.showSource('link');
    state.onSourceImported({uploadId:'twitch-confirmed',title:'Clip autorizado'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.creatorStep(),'source','A pending inspection must not auto-advance.');
    assert.equal(state.creatorStepAvailable('generation'),false);
    api.upload=async id=>({id,projectId:'project-fixture',state:'confirmed',inspection:{status:'succeeded',result:{durationSeconds:12}}});
    await state.inspect();
    assert.equal(state.sourceMode(),'file');
    assert.equal(state.sourceOriginProvider(),'twitch');
    assert.equal(state.processingSourceReady(),true);
    assert.equal(state.creatorStep(),'configuration');
  } finally { TestBed.resetTestingModule(); }
});

test('a running manual render for a previous upload does not block the selected source', async () => {
  try {
    const {state,api}=await handoffSetup();
    state.selectUpload('upload-next');
    await state.inspect();
    state.manualProcessingId='older-processing';
    state.manualProcessingUploadId='upload-fixture';
    state.manualProcessing.set({id:'older-processing',status:'running',spec:{startSeconds:0,endSeconds:10,aspect:'vertical'}});
    state.generationMode='manual';
    assert.equal(state.processingSourceReady(),true);
    assert.equal(state.generationActionDisabled(),false,'Only a render for the selected upload should block a new render.');
    let started=0;
    api.createProcessing=async()=>{started++;return{id:'current-processing'};};
    api.processing=async id=>({id,status:'succeeded',spec:{startSeconds:0,endSeconds:10,aspect:'vertical'}});
    await state.startManualProcessing();
    assert.equal(started,1);
    assert.equal(state.manualProcessingUploadId,'upload-next');
    assert.equal(state.manualProcessing()?.status,'succeeded');
  } finally {TestBed.resetTestingModule();}
});

test('manual pipeline interval is constrained to the inspected source duration', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>null,setItem(){}}});
  const params=new BehaviorSubject(new Map([['id','project']]));
  let submitted=0, submittedBody=null;
  const api={
    get:async()=>({id:'project',workspaceId:'workspace'}),edits:async()=>({items:[]}),
    upload:async id=>({id,projectId:'project',state:'confirmed',bytes:100,inspection:{status:'succeeded',result:{durationSeconds:14}}}),
    createPipeline:async(_uploadId,body)=>{submitted++;submittedBody=structuredClone(body);return{id:'pipeline',status:'queued',spec:body,events:[]};},
    pipeline:async id=>({id,status:'queued',spec:submittedBody,events:[]}),
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
    assert.equal(state.intervalReady(),true);
    assert.equal(state.workflowStatus('source'),'Listo');
    assert.equal(state.workflowStatus('render'),'Disponible');
    assert.equal(state.endSeconds,14);
    state.setIntervalField('endSeconds',99);
    assert.equal(state.endSeconds,14,'The selected end is clamped to the measured medium duration.');
    assert.match(state.intervalNotice(),/duración inspeccionada/);
    state.setIntervalField('startSeconds',99);
    assert.equal(state.startSeconds,13.9,'The selected start leaves the minimum valid 0.1-second range within the medium.');
    state.setIntervalField('startSeconds',0);
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
    assert.match(state.error(),/segundos inspeccionados/);
    state.uploadStatus.update(status=>({...status,inspection:{status:'succeeded',result:{}}}));
    assert.equal(state.intervalReady(),false);
    await state.startPipeline();
    assert.equal(submitted,0,'A successful inspection without measured duration cannot submit a guessed range.');
    assert.match(state.error(),/duración del medio/);
    state.uploadStatus.update(status=>({...status,inspection:{status:'succeeded',result:{durationSeconds:14}}}));
    state.startSeconds=1;state.endSeconds=4;
    await state.startPipeline();
    assert.equal(submitted,1);
    assert.equal(submittedBody.startSeconds,1);
    assert.equal(submittedBody.endSeconds,4);
    assert.deepEqual(submittedBody.selection,{mode:'none'},'Processing uses the chosen interval and never claims automatic AI segment selection.');
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
