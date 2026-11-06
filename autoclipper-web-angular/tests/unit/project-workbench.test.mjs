import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { ProjectComponent } from '../../.local/tests/client.mjs';

function subject() {
  const state=Object.create(ProjectComponent.prototype);
  state.selectedFile=signal(null);
  state.confirmedFile=signal(null);
  state.creatorCloseRequested=signal(false);
  state.resultKind=signal('pipeline');
  const navigation=[];
  Object.assign(state,{design:false,disposed:false,project:signal({id:'project'}),busy:signal(false),createdDraft:signal(null),edits:signal([]),workbench:signal('source'),creatorStep:signal('source'),creatorWizardOpen:signal(false),sourceMode:signal('file'),linkPreviewOpened:signal(false),linkPreviewAvailable:signal(false),resumeCreatorStep:signal(null),inspected:()=>false,intervalReady:signal(false),reviewReady:()=>false,pipelineInProgress:()=>false,manualProcessingBusy:signal(false),router:{navigateByUrl:async path=>navigation.push(path)}});
  state.processingSourceReady=()=>state.intervalReady();
  return {state,navigation};
}

test('continue opens an existing authorized draft without creating or processing anything',async()=>{
  const {state,navigation}=subject();
  state.edits.set([{id:'saved-draft'}]);
  await state.continueProject();
  assert.deepEqual(navigation,['/app/edits/saved-draft']);
  assert.equal(state.continueLabel(),'Abrir un borrador');
  let reopened=0;
  state.createdDraft.set({id:'created'});
  state.openCreatedDraft=async()=>reopened++;
  await state.continueProject();
  assert.equal(reopened,1);
  assert.equal(navigation.length,1);
});

test('continue directs an unprepared source or inspected source to its appropriate workbench',async()=>{
  const {state,navigation}=subject();
  state.workbench.set('drafts');
  await state.continueProject();
  assert.equal(state.creatorWizardOpen(),true,'Starting a new clip flow opens the floating step-by-step assistant.');
  assert.equal(state.workbench(),'source');
  state.inspected=()=>true;
  state.intervalReady.set(true);
  await state.continueProject();
  assert.equal(state.workbench(),'processing');
  assert.deepEqual(navigation,[]);
});

test('the explicit Crear clips action opens a fresh modal flow even when the project already has drafts',()=>{
  const {state,navigation}=subject();
  state.edits.set([{id:'saved-draft'}]);
  state.openCreatorWizard();
  assert.equal(state.creatorWizardOpen(),true);
  assert.equal(state.creatorStep(),'source');
  assert.equal(state.workbench(),'source');
  assert.deepEqual(navigation,[],'A new run never silently opens an older draft.');
});

test('the project launchpad opens the floating flow directly on the chosen MP4 or link source',()=>{
  const {state}=subject();
  state.openCreatorWizard('link');
  assert.equal(state.creatorWizardOpen(),true);
  assert.equal(state.creatorStep(),'source');
  assert.equal(state.sourceMode(),'link');
  assert.equal(state.linkPreviewOpened(),true,'The link pane opens immediately so validation and preview are in view.');
  state.closeCreatorWizard();
  state.openCreatorWizard('file');
  assert.equal(state.creatorStep(),'source');
  assert.equal(state.sourceMode(),'file');
});

test('the blocked-source action returns to the MP4 picker instead of a disabled generation button',()=>{
  const {state}=subject();
  state.sourceMode.set('link');
  state.creatorStep.set('configuration');
  state.workbench.set('processing');
  state.chooseFileSource(false);
  assert.equal(state.sourceMode(),'file');
  assert.equal(state.creatorStep(),'source');
  assert.equal(state.workbench(),'source');
});

test('a confirmed Twitch import becomes the selected inspected source before clip settings can run',async()=>{
  const {state}=subject();
  state.canEdit=()=>true;
  state.sourceFileName=signal('');
  state.sourceOriginProvider=signal(null);
  state.file={name:'old-local.mp4'};
  let inspected=0,selected='';
  state.releaseLocalPreview=()=>{};
  state.selectUpload=id=>{selected=id;};
  state.showWorkbench=section=>state.workbench.set(section);
  state.inspect=async()=>{inspected++;};
  state.onSourceImported({uploadId:'confirmed-upload',title:'Twitch clip'});
  await Promise.resolve();
  assert.equal(selected,'confirmed-upload');
  assert.equal(state.sourceOriginProvider(),'twitch');
  assert.equal(state.generationMode,'automatic','An imported Twitch clip enters the multi-clip automatic workflow, never manual trimming.');
  assert.equal(state.sourceFileName(),'Twitch clip');
  assert.equal(state.file,null);
  assert.equal(state.workbench(),'source');
  assert.equal(inspected,1);
});

test('manual fallback is offered for analysis failures but not for failed rendering',()=>{
  const state=Object.create(ProjectComponent.prototype);
  state.sourceOriginProvider=signal(null);
  state.processingSourceReady=()=>true;
  state.intervalReady=()=>true;
  state.pipelineMatchesSelectedUpload=()=>true;
  const task=errorCode=>({status:'failed',spec:{version:2,mode:'automatic'},errorCode});
  assert.equal(state.canOfferManualFallback(task('PIPELINE_ANALYSIS_STAGE_FAILED')),true);
  assert.equal(state.canOfferManualFallback(task('PIPELINE_MEDIA_STAGE_FAILED')),false);
});

test('design, missing access, busy or disposed projects cannot resume a draft',async()=>{
  for(const blocked of ['design','access','busy','disposed']) {
    const {state,navigation}=subject();
    state.edits.set([{id:'saved-draft'}]);
    if(blocked==='access') state.project.set(null);
    else if(blocked==='busy') state.busy.set(true);
    else state[blocked]=true;
    await state.continueProject();
    assert.deepEqual(navigation,[]);
  }
});

test('source choices distinguish YouTube imports, authorized Twitch clips and Kick previews',()=>{
  const template=readFileSync(new URL('../../src/app/features/projects/pages/project-detail.component.html',import.meta.url),'utf8');
  assert.match(template,/YouTube: importar video · Twitch: clips autorizados · Kick: vista previa/);
  assert.match(template,/importa un video de YouTube o un clip de Twitch autorizado/);
  assert.doesNotMatch(template,/Twitch admite clips y fragmentos de VOD/);
  assert.match(template,/@if \(sourceOriginProvider\(\) === 'twitch'\)[\s\S]*?@else \{\s*<fieldset class="generation-route-picker"/);
});

test('Twitch imported sources cannot fall back to asking the user for a manual interval',()=>{
  const state=Object.create(ProjectComponent.prototype);
  state.sourceOriginProvider=signal('twitch');
  state.canEdit=()=>true;
  state.processingSourceReady=()=>true;
  state.busy=()=>false;
  state.pipelineMatchesSelectedUpload=()=>true;
  state.automaticPipeline=()=>true;
  state.pipelineManualFallbackAvailable=signal(false);
  state.pipelineError=signal('');
  state.useManualFallback();
  state.useManualAfterPipelineFailure();
  assert.equal(state.generationMode,undefined);
  assert.equal(state.canOfferManualFallback({status:'failed',spec:{mode:'automatic'},errorCode:'PIPELINE_ANALYSIS_STAGE_FAILED'}),false);
});

test('manual pipeline downloads expose busy state to keyboard and pointer users',()=>{
  const template=readFileSync(new URL('../../src/app/features/projects/pages/project-detail.component.html',import.meta.url),'utf8');
  for(const artifact of ['video','srt','vtt']) {
    const click=`(click)="downloadPipeline('${artifact}')"`;
    const at=template.indexOf(click);
    assert.notEqual(at,-1,`The ${artifact} download control exists.`);
    const start=template.lastIndexOf('<button',at),end=template.indexOf('>',at);
    assert.ok(start>=0 && end>at,`The ${artifact} download button has a complete opening tag.`);
    assert.match(template.slice(start,end+1),/\[disabled\]="busy\(\)"/);
  }
});
