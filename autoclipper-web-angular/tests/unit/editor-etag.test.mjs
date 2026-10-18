import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { EditorApi, ApiTransport } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('editor save and restore keep If-Match and derive the version ETag when responses omit it', async () => {
  const writes=[];
  const transport={
    patchResponse:async(path,body,etag)=>{writes.push({method:'patch',path,body,etag});return {body:{id:'edit-1',version:2},headers:{get:()=>null}};},
    postResponse:async(path,body,etag)=>{writes.push({method:'post',path,body,etag});return {body:{id:'edit-1',version:3},headers:{get:()=> '"3"'}};},
  };
  TestBed.configureTestingModule({providers:[EditorApi,{provide:ApiTransport,useValue:transport},{provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}}]});
  try {
    const api=TestBed.inject(EditorApi);
    const saved=await api.save('edit-1',{version:1,spec:{}},'"1"');
    assert.equal(saved.etag,'"2"');
    const restored=await api.restore('edit-1',{version:2,revisionVersion:1},saved.etag);
    assert.equal(restored.etag,'"3"','An explicit response ETag takes precedence over the version fallback.');
    assert.deepEqual(writes.map(write=>[write.method,write.path,write.etag]),[
      ['patch','/edits/edit-1','"1"'],
      ['post','/edits/edit-1/restore','"2"'],
    ]);
  } finally { TestBed.resetTestingModule(); }
});

test('revision exports and artifact grants use the documented routes, versions and idempotency key',async()=>{
  const calls=[];
  const transport={post:async(path,body,key)=>{calls.push({path,body,key});return{id:'processing-fixture',status:'queued'};},get:async(path)=>{calls.push({path});return{url:'https://media.example.test/fixture'};}};
  TestBed.configureTestingModule({providers:[EditorApi,{provide:ApiTransport,useValue:transport},{provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}}]});
  try {
    const api=TestBed.inject(EditorApi);assert.equal((await api.render('edit-fixture',3,'request-key')).id,'processing-fixture');
    await api.exports('edit-fixture');await api.download('processing-fixture','srt');
    assert.deepEqual(calls,[{path:'/edits/edit-fixture/renders',body:{revisionVersion:3},key:'request-key'},{path:'/edits/edit-fixture/exports'},{path:'/processing/processing-fixture/download?kind=srt'}]);
  } finally {TestBed.resetTestingModule();}
});
