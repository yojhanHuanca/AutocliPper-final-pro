import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { YoutubeMetadataClient } from '../apps/autoclipper-project-service/dist/application/youtube-metadata.js';

const videoId='abcdefghijk';
const key='fixture-secret-do-not-return';
function payload(overrides={}){
  return {
    items:[{
      id:videoId,
      snippet:{title:'Fixture title',channelTitle:'Fixture channel',thumbnails:{high:{url:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'}}},
      contentDetails:{duration:'PT1H2M3S'},
      status:{uploadStatus:'processed',privacyStatus:'unlisted',embeddable:true},
      ...overrides,
    }],
  };
}
const jsonResponse=(body,status=200,headers={})=>new globalThis.Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});

test('YouTube metadata uses only videos.list with a canonical ID and returns bounded safe fields',async()=>{
  let call;
  const client=new YoutubeMetadataClient({apiKey:key,fetcher:async(url,options)=>{call={url:new URL(url),options};return jsonResponse(payload());}});
  const result=await client.lookup(videoId,'user-1');
  assert.deepEqual(result,{state:'available',title:'Fixture title',channelTitle:'Fixture channel',durationSeconds:3723,thumbnailUrl:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',uploadStatus:'processed',privacyStatus:'unlisted',embeddable:true});
  assert.equal(call.url.origin,'https://www.googleapis.com');
  assert.equal(call.url.pathname,'/youtube/v3/videos');
  assert.equal(call.url.searchParams.get('part'),'snippet,contentDetails,status');
  assert.equal(call.url.searchParams.get('id'),videoId);
  assert.equal(call.url.searchParams.get('maxResults'),'1');
  assert.equal(call.url.searchParams.get('key'),key);
  assert.equal(call.options.redirect,'error');
  assert.equal(call.options.method,'GET');
  assert.ok(call.options.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(result).includes(key),false);
});

test('missing key and invalid IDs never call Google',async()=>{
  let calls=0;
  const client=new YoutubeMetadataClient({apiKey:'',fetcher:async()=>{calls++;throw new Error('must not call');}});
  assert.deepEqual(await client.lookup(videoId,'user-1'),{state:'unavailable',reasonCode:'YOUTUBE_METADATA_NOT_CONFIGURED'});
  assert.deepEqual(await client.lookup('../bad','user-1'),{state:'unavailable',reasonCode:'YOUTUBE_METADATA_UNAVAILABLE'});
  assert.equal(calls,0);
});

test('not-found metadata is safe and cached without making media/import claims',async()=>{
  let calls=0;
  const client=new YoutubeMetadataClient({apiKey:key,fetcher:async()=>{calls++;return jsonResponse({items:[]});}});
  const first=await client.lookup(videoId,'user-1');
  const second=await client.lookup(videoId,'user-2');
  assert.deepEqual(first,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_NOT_FOUND'});
  assert.deepEqual(second,first);
  assert.equal(calls,1);
});

test('provider failures and timeout exceptions never leak provider response or secret',async()=>{
  const forbidden=await new YoutubeMetadataClient({apiKey:key,fetcher:async()=>jsonResponse({error:{message:`credential ${key}`}},403)}).lookup(videoId,'user-1');
  const rateLimited=await new YoutubeMetadataClient({apiKey:key,fetcher:async()=>jsonResponse({error:{message:`credential ${key}`}},429)}).lookup(videoId,'user-1');
  const timeout=await new YoutubeMetadataClient({apiKey:key,fetcher:async()=>{throw new Error(`timeout ${key}`);}}).lookup(videoId,'user-1');
  assert.deepEqual(forbidden,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_UNAVAILABLE'});
  assert.deepEqual(rateLimited,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_RATE_LIMITED'});
  assert.deepEqual(timeout,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_UNAVAILABLE'});
  assert.equal(JSON.stringify(forbidden).includes(key),false);
  assert.equal(JSON.stringify(rateLimited).includes(key),false);
  assert.equal(JSON.stringify(timeout).includes(key),false);
});

test('invalid, oversized and untrusted thumbnail metadata fail closed',async()=>{
  const malformed=payload();malformed.items[0].contentDetails.duration='not-a-duration';
  const invalid=await new YoutubeMetadataClient({apiKey:key,fetcher:async()=>jsonResponse(malformed)}).lookup(videoId,'user-1');
  assert.deepEqual(invalid,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_UNAVAILABLE'});
  const oversized=await new YoutubeMetadataClient({apiKey:key,fetcher:async()=>jsonResponse({},200,{'content-length':'65537'})}).lookup(videoId,'user-1');
  assert.deepEqual(oversized,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_UNAVAILABLE'});
  const oversizedStream=await new YoutubeMetadataClient({apiKey:key,fetcher:async()=>new globalThis.Response(new globalThis.ReadableStream({start(controller){controller.enqueue(new Uint8Array(65_537));controller.close();}}))}).lookup(videoId,'user-1');
  assert.deepEqual(oversizedStream,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_UNAVAILABLE'});
  const unsafe=payload();unsafe.items[0].snippet.thumbnails.high.url='https://attacker.example/image.jpg';
  const safe=await new YoutubeMetadataClient({apiKey:key,fetcher:async()=>jsonResponse(unsafe)}).lookup(videoId,'user-1');
  assert.equal(safe.state,'available');assert.equal(safe.thumbnailUrl,null);
  const wrongId=payload();wrongId.items[0].id='zzzzzzzzzzz';
  const mismatched=await new YoutubeMetadataClient({apiKey:key,fetcher:async()=>jsonResponse(wrongId)}).lookup(videoId,'user-1');
  assert.deepEqual(mismatched,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_UNAVAILABLE'});
});

test('public OpenAPI exposes metadata and Twitch interval input without enabling YouTube URL imports',async()=>{
  const openapi=JSON.parse(await readFile(new URL('../apps/autoclipper-api-gateway/contracts/public.openapi.json',import.meta.url),'utf8'));
  const operation=openapi.paths['/v1/projects/{id}/source-links/resolve']?.post;
  assert.ok(operation);
  const schema=openapi.components.schemas.SourceLinkResolutionDto;
  assert.equal(schema.properties.youtubeMetadata.allOf[0].$ref,'#/components/schemas/YoutubeVideoMetadataDto');
  assert.deepEqual(schema.properties.state.enum,['available','unavailable','unsupported','input_required']);
  assert.ok(schema.properties.reasonCode.enum.includes('YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED'));
  assert.ok(openapi.components.schemas.YoutubeVideoMetadataDto.properties.reasonCode.enum.includes('YOUTUBE_METADATA_NOT_CONFIGURED'));
  const sdk=await readFile(new URL('../packages/autoclipper-api-contracts/src/generated.ts',import.meta.url),'utf8');
  assert.match(sdk,/youtubeMetadata\?: components\["schemas"\]\["YoutubeVideoMetadataDto"\]/u);
});

test('metadata cache and per-user request limit bound API calls',async()=>{
  let calls=0,now=1_000;
  const client=new YoutubeMetadataClient({apiKey:key,now:()=>now,maxUserRequestsPerMinute:1,fetcher:async(url)=>{calls++;const result=payload();result.items[0].id=new URL(url).searchParams.get('id');return jsonResponse(result);}});
  await client.lookup(videoId,'user-1');
  await client.lookup(videoId,'user-1'); // Cache hit is free.
  const limited=await client.lookup('zyxwvutsrqp','user-1');
  assert.deepEqual(limited,{state:'unavailable',reasonCode:'YOUTUBE_METADATA_RATE_LIMITED'});
  assert.equal(calls,1);
  now+=60_001;
  const nextWindow=await client.lookup('zyxwvutsrqp','user-1');
  assert.equal(nextWindow.state,'available');
  assert.equal(calls,2);
});
