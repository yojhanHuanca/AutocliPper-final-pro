import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {ForbiddenException,ConflictException,BadRequestException} from '@nestjs/common';
import {HeadObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {DerivativesManager} from '../apps/autoclipper-project-service/dist/application/derivatives.manager.js';
import {ProxyController} from '../apps/autoclipper-api-gateway/dist/proxy.controller.js';

const upload={id:'11111111-1111-4111-8111-111111111111',project_id:'22222222-2222-4222-8222-222222222222',workspace_id:'33333333-3333-4333-8333-333333333333',state:'confirmed',expected_bytes:24,object_key:'workspaces/33333333-3333-4333-8333-333333333333/media/11111111-1111-4111-8111-111111111111/source.media',etag:'"fixture-etag"',sha256:'a'.repeat(64),content_type:'video/mp4'};

async function playbackFixture(t,{role='editor',state=upload.state,headOverrides={}}={}){
  const requests=[];
  const payload=Buffer.from('0123456789abcdefghijklmn');
  const server=createServer((req,res)=>{
    requests.push({method:req.method,range:req.headers.range,url:req.url});
    const match=/^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range??''));
    res.setHeader('content-type','video/mp4');res.setHeader('accept-ranges','bytes');res.setHeader('access-control-allow-origin','http://localhost:4200');
    if(match){const start=Number(match[1]),end=Math.min(Number(match[2]),payload.length-1),part=payload.subarray(start,end+1);res.statusCode=206;res.setHeader('content-range',`bytes ${start}-${end}/${payload.length}`);res.setHeader('content-length',part.length);res.end(part);return;}
    res.setHeader('content-length',payload.length);res.end(payload);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const signer=new S3Client({endpoint:`http://127.0.0.1:${address.port}`,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:'fixture-access-id',secretAccessKey:'fixture-secret-value'}});
  t.after(()=>signer.destroy());
  let headRequests=0;const s3={send:async command=>{assert.ok(command instanceof HeadObjectCommand);headRequests++;assert.equal(command.input.Bucket,'private-media');assert.equal(command.input.Key,upload.object_key);return{ContentLength:upload.expected_bytes,ETag:upload.etag,ContentType:upload.content_type,...headOverrides};}};
  const auth=[];
  const manager=new DerivativesManager({}, {}, '', 'private-media', s3, signer, async(_req,id,minimum)=>{auth.push({id,minimum});if(role!=='editor')throw new ForbiddenException();return{...upload,state};});
  return{manager,requests,auth,get headRequests(){return headRequests;},payload};
}

test('source playback is editor-authorized, short-lived, private, and supports byte-range seeking',async t=>{
  const fixture=await playbackFixture(t),result=await fixture.manager.sourcePlayback({} ,upload.id);
  assert.deepEqual(fixture.auth,[{id:upload.id,minimum:'editor'}]);
  assert.equal(fixture.headRequests,1);
  assert.deepEqual(Object.keys(result).sort(),['bytes','contentType','expiresInSeconds','sha256','url']);
  assert.equal(result.expiresInSeconds,120);assert.equal(result.contentType,'video/mp4');assert.equal(result.bytes,upload.expected_bytes);assert.equal(result.sha256,upload.sha256);
  const signed=new URL(result.url);
  assert.equal(signed.searchParams.get('X-Amz-Expires'),'120');
  assert.equal(signed.searchParams.get('response-content-disposition'),'inline; filename="source.mp4"');
  assert.equal(signed.searchParams.get('response-cache-control'),'private, no-store, max-age=0');
  assert.equal(signed.pathname,`/private-media/${upload.object_key}`);
  assert.equal(result.url.includes('fixture-secret-value'),false,'the storage secret must not be present in the signed URL');

  const ranged=await fetch(result.url,{headers:{range:'bytes=4-9',origin:'http://localhost:4200'}});
  assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),`bytes 4-9/${fixture.payload.length}`);assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),fixture.payload.subarray(4,10));
  assert.equal(fixture.requests[0]?.range,'bytes=4-9');

  const cors=await readFile(new URL('../scripts/storage-init.mjs',import.meta.url),'utf8');
  assert.match(cors,/AllowedHeaders:\[[^\]]*'range'/u);assert.match(cors,/ExposeHeaders:\[[^\]]*'Accept-Ranges'[^\]]*'Content-Range'[^\]]*'Content-Length'/u);
});

test('source playback rejects unauthorized, unconfirmed, mismatched, and non-video sources before signing',async t=>{
  const forbidden=await playbackFixture(t,{role:'reader'});
  await assert.rejects(forbidden.manager.sourcePlayback({},upload.id),ForbiddenException);assert.equal(forbidden.headRequests,0);

  const pending=await playbackFixture(t,{state:'pending'});
  await assert.rejects(pending.manager.sourcePlayback({},upload.id),ConflictException);assert.equal(pending.headRequests,0);

  const changed=await playbackFixture(t,{headOverrides:{ETag:'"changed-etag"'}});
  await assert.rejects(changed.manager.sourcePlayback({},upload.id),ConflictException);assert.equal(changed.headRequests,1);

  const invalid=await playbackFixture(t);const invalidUpload={...upload,content_type:'text/html'};invalid.manager.authorize=async()=>invalidUpload;
  await assert.rejects(invalid.manager.sourcePlayback({},upload.id),BadRequestException);assert.equal(invalid.headRequests,0);
});

test('gateway marks the signed-URL response non-cacheable and prevents referrer propagation',async t=>{
  const server=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({url:'https://storage.example.test/private/video?signature=fixture'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const old=process.env.PROJECT_URL;process.env.PROJECT_URL=`http://127.0.0.1:${address.port}`;t.after(()=>{if(old===undefined)delete process.env.PROJECT_URL;else process.env.PROJECT_URL=old;});
  const response={locals:{correlationId:'source-playback-proxy'},headers:{},statusCode:0,payload:undefined,setHeader(name,value){this.headers[name.toLowerCase()]=value;},appendHeader(){},status(value){this.statusCode=value;return this;},send(value){this.payload=value;return this;},json(value){this.payload=value;return this;},end(){return this;}};
  await new ProxyController().forward({method:'GET',originalUrl:`/v1/uploads/${upload.id}/source-playback`,headers:{},ip:'127.0.0.1'},response);
  assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['referrer-policy'],'no-referrer');assert.equal(JSON.parse(response.payload).url,'https://storage.example.test/private/video?signature=fixture');
});
