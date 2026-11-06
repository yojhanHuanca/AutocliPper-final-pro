import test from 'node:test';
import assert from 'node:assert/strict';
import { DerivativesManager } from '../apps/autoclipper-project-service/dist/application/derivatives.manager.js';

const upload={id:'c9bc46f1-c1d5-4a2d-86a3-7cb36d240303',project_id:'8d8fc58a-c587-4aaa-94b4-48cde70e1d9f',workspace_id:'03045326-e574-43d5-88dd-8f5a07de1e72',state:'confirmed',expected_bytes:1024,object_key:'workspaces/03045326-e574-43d5-88dd-8f5a07de1e72/media/source.media',etag:'fixture-etag',sha256:'a'.repeat(64),content_type:'video/mp4'};
const metadata={durationSeconds:20.5,width:1280,height:720,audioCodec:'aac'};
const status=result=>({id:upload.id,status:'succeeded',result});

function fixture(response){
  const calls=[];
  const config={INTERNAL_TOKEN:'fixture-internal-token'};
  const manager=new DerivativesManager({},config,'http://media.fixture','private-bucket',{}, {},async(_req,id,minimum)=>{
    assert.equal(id,upload.id);assert.equal(minimum,'editor');return upload;
  });
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input);calls.push({url,init});
    return globalThis.Response.json(response);
  };
  return{manager,calls,restore:()=>{globalThis.fetch=originalFetch;}};
}

test('Project binds Media inspection metadata to the exact confirmed upload before using it',async()=>{
  const testFixture=fixture(status({...metadata,videoCodec:'h264',format:'mov,mp4'}));
  try{
    const result=await testFixture.manager.sourceForEditor({},upload.id);
    assert.equal(result.upload.id,upload.id);
    assert.deepEqual(result.metadata,metadata);
    assert.equal(testFixture.calls.length,1);
    assert.equal(testFixture.calls[0].url.href,'http://media.fixture/v1/internal/inspection-status');
    assert.equal(testFixture.calls[0].init.headers['x-service-token'],'fixture-internal-token');
    assert.deepEqual(JSON.parse(testFixture.calls[0].init.body),{id:upload.id,workspaceId:upload.workspace_id});
  }finally{testFixture.restore();}
});

test('Project fails closed on an inspection response for another upload or malformed technical metadata',async()=>{
  const wrongUpload=status(metadata);wrongUpload.id='f0bbaac0-093e-4550-9a74-47158f0cf03d';
  const malformed=status({...metadata,width:'1280'});
  for(const response of [wrongUpload,malformed,status(null)]){
    const testFixture=fixture(response);
    try{
      await assert.rejects(testFixture.manager.sourceForEditor({},upload.id),error=>error.getStatus?.()===503&&error.getResponse?.().code==='INSPECTION_METADATA_INVALID');
    }finally{testFixture.restore();}
  }
});

test('Project keeps an unfinished inspection as a conflict and rejects oversized dimensions',async()=>{
  for(const [response,expectedStatus] of [
    [{id:upload.id,status:'running',result:null},409],
    [status({...metadata,width:5000}),400],
  ]){
    const testFixture=fixture(response);
    try{await assert.rejects(testFixture.manager.sourceForEditor({},upload.id),error=>error.getStatus?.()===expectedStatus);}
    finally{testFixture.restore();}
  }
});
