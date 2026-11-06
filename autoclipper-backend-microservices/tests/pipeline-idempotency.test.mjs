import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { cookieName, digest } from '@autoclipper/http-security';
import { pipelineSpec } from '@autoclipper/api-contracts';
import { PipelineManager } from '../apps/autoclipper-project-service/dist/application/pipeline.manager.js';

const userId='6e6f7950-9412-4b6e-975b-7d2a17bfa086';
const uploadId='c9bc46f1-c1d5-4a2d-86a3-7cb36d240303';
const projectId='8d8fc58a-c587-4aaa-94b4-48cde70e1d9f';
const pipelineId='20a8eae9-5c6c-41b8-a3ef-81b814be5582';
const spec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'},startSeconds:0,endSeconds:12,aspect:'vertical'};

function requestWithCsrf(config,key){
  const payload=`${Date.now()}.pipeline-idempotency-fixture`;
  const signature=createHmac('sha256',config.CSRF_SIGNING_KEY).update(payload).digest('base64url');
  const token=`${payload}.${signature}`;
  return {headers:{origin:config.CORS_ORIGIN,cookie:`${cookieName('csrf')}=${token}; ${cookieName('access')}=fixture-access-token`,'x-csrf-token':token,'idempotency-key':key}};
}

function makeManager(prior,idempotencyKey){
  const config={CORS_ORIGIN:'http://localhost:4200',CSRF_SIGNING_KEY:'fixture-csrf-key',IDENTITY_URL:'http://identity.fixture',INTERNAL_TOKEN:'fixture-internal'};
  let authorizedUpload,sourceChecks=0,presented=0;
  const derivatives={
    authorizeUpload:async(_req,id,minimum)=>{authorizedUpload={id,minimum};return{id,project_id:projectId,workspace_id:'03045326-e574-43d5-88dd-8f5a07de1e72',state:'confirmed'};},
    sourceForEditor:async()=>{sourceChecks++;throw new Error('inspection service is unavailable');},
  };
  const pool={query:async(sql,values)=>{
    assert.match(sql,/SELECT \* FROM pipelines WHERE creator_id=\$1 AND idempotency_key=\$2/u);
    assert.deepEqual(values,[userId,idempotencyKey]);
    return{rows:[prior]};
  }};
  const manager=new PipelineManager(pool,config,'http://analysis.fixture',derivatives,{});
  manager.present=async row=>{presented++;return{id:row.id,status:row.status};};
  return{manager,config,getState:()=>({authorizedUpload,sourceChecks,presented})};
}

test('pipeline replay reauthorizes the stored upload and survives an inspection outage',async()=>{
  const key=randomUUID();
  const parsed=pipelineSpec.parse(spec),requestHash=digest(JSON.stringify({uploadId,spec:parsed}));
  const prior={id:pipelineId,upload_id:uploadId,project_id:projectId,request_hash:requestHash,status:'analysis'};
  const fixture=makeManager(prior,key),request=requestWithCsrf(fixture.config,key),originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input);calls.push(url.href);
    assert.equal(url.href,'http://identity.fixture/v1/internal/authenticate');
    assert.deepEqual(JSON.parse(init.body),{token:'fixture-access-token'});
    return globalThis.Response.json({id:userId,email:'fixture@example.test'});
  };
  try{
    const result=await fixture.manager.begin(request,uploadId,spec,'fixture-correlation');
    assert.deepEqual(result,{id:pipelineId,status:'analysis'});
    assert.deepEqual(calls,['http://identity.fixture/v1/internal/authenticate']);
    assert.deepEqual(fixture.getState(),{authorizedUpload:{id:uploadId,minimum:'editor'},sourceChecks:0,presented:1});
  }finally{globalThis.fetch=originalFetch;}
});

test('pipeline replay rejects a changed request before rechecking inspection or Analysis',async()=>{
  const key=randomUUID();
  const fixture=makeManager({id:pipelineId,upload_id:uploadId,project_id:projectId,request_hash:'f'.repeat(64),status:'analysis'},key);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async input=>{
    assert.equal(new URL(input).href,'http://identity.fixture/v1/internal/authenticate');
    return globalThis.Response.json({id:userId,email:'fixture@example.test'});
  };
  try{
    await assert.rejects(fixture.manager.begin(requestWithCsrf(fixture.config,key),uploadId,spec,'fixture-correlation'),error=>error.getStatus?.()===409);
    assert.deepEqual(fixture.getState(),{authorizedUpload:{id:uploadId,minimum:'editor'},sourceChecks:0,presented:0});
  }finally{globalThis.fetch=originalFetch;}
});

test('YouTube metadata cannot be submitted as a pipeline source or affect the inspected upload contract',()=>{
  assert.equal(pipelineSpec.safeParse({...spec,youtubeMetadata:{videoId:'abcdefghijk',title:'Untrusted title',durationSeconds:120}}).success,false);
});
