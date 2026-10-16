// Explicit asynchronous DTO fixture. No backend or AI is simulated in the running app.
import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute } from '@angular/router';
import { EditorState, EditorApi, DESIGN_MODE } from '../../.local/tests/client.mjs';
TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
test('timeline replaces initial bounds after async load and follows local form edits', async () => {
  let resolveEdit;
  const response = new Promise(resolve => { resolveEdit = resolve; });
  const api = { edit:()=>response, history:async()=>({items:[],nextBeforeVersion:null}), comments:async()=>({items:[],nextBeforeId:null}), exports:async()=>({items:[]}), review:async()=>({version:1,reviewVersion:1,status:'draft',approvedRevisionVersion:null}) };
  TestBed.configureTestingModule({providers:[EditorState,{provide:EditorApi,useValue:api},{provide:DESIGN_MODE,useValue:false},{provide:ActivatedRoute,useValue:{snapshot:{paramMap:new Map([['id','fixture-edit']])}}},{provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}}]});
  try {
    const state=TestBed.inject(EditorState);
    assert.equal(state.timeline().endSeconds,30);
    resolveEdit({etag:'"1"',draft:{id:'fixture-edit',uploadId:'fixture-upload',projectId:'fixture-project',name:'Explicit unit fixture',version:1,revision:{id:'fixture-revision',version:1,spec:{version:1,kind:'clip',startSeconds:12,endSeconds:18,aspect:'square',subtitles:{source:'transcript',analysisId:'fixture-analysis'}}}}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(state.timeline(),{startSeconds:12,endSeconds:18,captionSource:'transcript'});
    assert.equal(state.dirty(),false);
    state.spec.endSeconds=17; state.captionSource='none'; state.touchForm();
    assert.deepEqual(state.timeline(),{startSeconds:12,endSeconds:17,captionSource:'none'});
    assert.equal(state.dirty(),true);
  } finally { TestBed.resetTestingModule(); }
});
