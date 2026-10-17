import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestBed, TestComponentRenderer } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ApiTransport, CollaborationApi } from '../../.local/tests/client.mjs';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

test('collaboration client maps review, comments, links, audit and public grants to contract routes', async () => {
  const calls=[];
  const transport={
    get:async(path)=>{calls.push(['get',path]);return {};},
    getPublic:async(path)=>{calls.push(['public',path]);return {};},
    post:async(path,body,key)=>{calls.push(['post',path,body,key]);return {};},
    delete:async(path)=>{calls.push(['delete',path]);return {};},
    deleteWithBody:async(path,body)=>{calls.push(['delete-body',path,body]);return {};},
  };
  TestBed.configureTestingModule({providers:[CollaborationApi,{provide:ApiTransport,useValue:transport},{provide:TestComponentRenderer,useValue:{insertRootElement(){},removeAllRootElements(){}}}]});
  try {
    const api=TestBed.inject(CollaborationApi);
    const version={version:3,reviewVersion:2};
    await api.review('edit-1');
    await api.requestReview('edit-1',version);
    await api.returnReview('edit-1',version);
    await api.approve('edit-1',version);
    await api.comments('edit-1',{beforeId:'cursor-1',revisionVersion:3});
    await api.createComment('edit-1',{revisionVersion:3,timeSeconds:4,text:'Nota'},'key-1');
    await api.deleteComment('edit-1','comment-1',{version:1});
    await api.links('edit-1');
    await api.createLink('edit-1',{revisionVersion:3,expiresInSeconds:3600});
    await api.revokeLink('edit-1','link-1');
    await api.audit('edit-1','audit-cursor');
    await api.publicReview('one-time-token','comment-cursor');
    await api.publicVideo('one-time-token');
    assert.deepEqual(calls.map(call=>call.slice(0,2)),[
      ['get','/edits/edit-1/review'],
      ['post','/edits/edit-1/review'],
      ['delete-body','/edits/edit-1/review'],
      ['post','/edits/edit-1/approvals'],
      ['get','/edits/edit-1/comments?beforeId=cursor-1&revisionVersion=3'],
      ['post','/edits/edit-1/comments'],
      ['delete-body','/edits/edit-1/comments/comment-1'],
      ['get','/edits/edit-1/review-links'],
      ['post','/edits/edit-1/review-links'],
      ['delete','/edits/edit-1/review-links/link-1'],
      ['get','/edits/edit-1/audit?beforeId=audit-cursor'],
      ['public','/review-links/one-time-token?beforeId=comment-cursor'],
      ['public','/review-links/one-time-token/video'],
    ]);
    assert.deepEqual(calls[1][2],version);
    assert.equal(calls[5][3],'key-1');
  } finally { TestBed.resetTestingModule(); }
});
