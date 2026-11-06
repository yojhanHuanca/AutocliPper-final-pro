import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { downloadTwitchClipAsset, isPublicAddress, resolveSourceLink } from '../apps/autoclipper-project-service/dist/application/source-link.js';

test('source-link resolver accepts only canonical Twitch clip URL shapes and does no network I/O', () => {
  assert.deepEqual(resolveSourceLink('https://clips.twitch.tv/CleverClip_123'), {
    provider: 'twitch', kind: 'clip', clipId: 'CleverClip_123',
  });
  assert.equal(resolveSourceLink('https://www.twitch.tv/channel_name/clip/AnotherClip').clipId, 'AnotherClip');
  assert.equal(resolveSourceLink('https://www.twitch.tv/clip/ShortRoute').clipId, 'ShortRoute');
  assert.deepEqual(resolveSourceLink('https://www.twitch.tv/videos/2916449488'),{provider:'twitch',kind:'vod',vodId:'2916449488'});
  const youtube=resolveSourceLink('https://youtu.be/abcdefghijk');
  assert.deepEqual(youtube, {
    provider: 'youtube', kind: 'video',
    videoId:'abcdefghijk',previewUrl:'https://www.youtube.com/embed/abcdefghijk',
  });
  for(const url of [
    'https://www.youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com/watch?v=abcdefghijk&feature=shared&t=30',
    'https://www.youtube.com/shorts/abcdefghijk',
    'https://www.youtube.com/embed/abcdefghijk',
    'https://www.youtube.com/live/abcdefghijk',
    'https://www.youtube.com/shorts/abcdefghijk?feature=share',
    'https://youtu.be/abcdefghijk?si=fixtureShareToken&t=30',
  ]) assert.equal(resolveSourceLink(url).videoId,'abcdefghijk');
  assert.deepEqual(resolveSourceLink('https://kick.com/channel'), {
    provider: 'kick', state: 'unsupported', reasonCode: 'KICK_MEDIA_API_UNAVAILABLE',
  });
});

test('Twitch asset DNS policy accepts public addresses and rejects private, reserved and transition ranges', () => {
  for (const address of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
  for (const address of ['127.0.0.1','10.0.0.2','172.16.0.1','192.168.1.2','169.254.1.1','100.64.0.1','192.31.196.1','192.52.193.1','192.175.48.1','224.0.0.1','::1','fc00::1','fe80::1','2001:db8::1','2001:2::1','2001:20::1','2002:7f00:1::1','2620:4f:8000::1','3fff::1','::ffff:8.8.8.8']) assert.equal(isPublicAddress(address), false, address);
});

test('Twitch download helper rejects URLs outside the exact documented CDN before DNS or HTTP', async () => {
  await assert.rejects(downloadTwitchClipAsset('https://127.0.0.1/private'), /TWITCH_DOWNLOAD_HOST_UNSUPPORTED/);
  await assert.rejects(downloadTwitchClipAsset('https://clips.twitch.tv/clip-id'), /TWITCH_DOWNLOAD_HOST_UNSUPPORTED/);
});

test('source-link resolver rejects malformed and dangerous URL shapes before any network call', () => {
  for (const value of [
    'http://clips.twitch.tv/Clip',
    'https://user:pass@clips.twitch.tv/Clip',
    'https://clips.twitch.tv:444/Clip',
    'https://clips.twitch.tv/Clip?redirect=https://127.0.0.1',
    'https://clips.twitch.tv/Clip#fragment',
    'https://clips.twitch.tv/a/extra',
    'https://127.0.0.1/Clip',
    'https://clips.twitch.tv/%2F%2F127.0.0.1',
    'https://clips.twitch.tv/Clip.evil.example',
    'https://www.twitch.tv/videos/not-numeric',
    'https://www.twitch.tv/videos/2916449488?t=30s',
    'https://twitch.tv.evil.example/videos/2916449488',
    'https://clips.twitch.tv/' + 'a'.repeat(129),
    'https://youtu.be/abcdefghijk?redirect=https://127.0.0.1',
    'https://www.youtube.com/watch?v=abcdefghijk&v=abcdefghijk',
    'https://www.youtube.com/watch?v=abcdefghijk&redirect=https://127.0.0.1',
    'https://youtu.be/abcdefghijk?t=10&t=20',
    'https://www.youtube.com/watch?v=too-short',
    'https://www.youtube.com.evil.example/watch?v=abcdefghijk',
    'https://www.youtube.com/shorts/abcdefghijk?v=abcdefghijk',
    'https://kick.com/channel/clips/clip-id?redirect=https://127.0.0.1',
    'x'.repeat(2049),
    null,
  ]) assert.throws(() => resolveSourceLink(value));
});

function fixtureRequest({status=200,headers={},bytes=Buffer.alloc(12)}={}) {
  let count=0,requestOptions;
  const request=(options,callback)=>{
    count++;requestOptions=options;
    const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>process.nextTick(()=>{const response=new PassThrough();response.statusCode=status;response.headers=headers;response.once('end',()=>req.emit('close'));callback(response);response.end(bytes);});req.destroy=error=>req.emit('error',error);return req;
  };
  return {request,get count(){return count;},get requestOptions(){return requestOptions;}};
}

test('Twitch clip downloader pins public DNS, refuses mixed/private answers and redirects, and stores bounded MP4 bytes',async()=>{
  const bytes=Buffer.alloc(12);bytes.write('ftyp',4,'ascii');const fixture=fixtureRequest({headers:{'content-type':'video/mp4','content-length':String(bytes.length)},bytes});
  const result=await downloadTwitchClipAsset('https://production.assets.clips.twitchcdn.net/signed/clip.mp4?signature=fixture',{resolveDns:async(host,options)=>{assert.equal(host,'production.assets.clips.twitchcdn.net');assert.equal(options.all,true);return[{address:'8.8.8.8',family:4}];},request:fixture.request});
  try {assert.equal(result.bytes,12);assert.equal(result.sha256.length,64);assert.equal(result.contentType,'video/mp4');assert.deepEqual(await readFile(result.path),bytes);assert.equal(fixture.count,1);assert.equal(fixture.requestOptions.hostname,'production.assets.clips.twitchcdn.net');fixture.requestOptions.lookup(fixture.requestOptions.hostname,{},(_error,address)=>assert.equal(address,'8.8.8.8'));}
  finally {await result.cleanup();}

  const mixed=fixtureRequest();let requestCount=0;await assert.rejects(downloadTwitchClipAsset('https://production.assets.clips.twitchcdn.net/signed/object',{resolveDns:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.5',family:4}],request:(...args)=>{requestCount++;return mixed.request(...args);}}),/TWITCH_CDN_DNS_REJECTED/);assert.equal(requestCount,0);
  const redirect=fixtureRequest({status:302,headers:{location:'http://127.0.0.1/private'}});await assert.rejects(downloadTwitchClipAsset('https://production.assets.clips.twitchcdn.net/signed/object',{resolveDns:async()=>[{address:'8.8.8.8',family:4}],request:redirect.request}),/TWITCH_DOWNLOAD_REDIRECT/);assert.equal(redirect.count,1);
  const oversized=fixtureRequest({headers:{'content-type':'video/mp4','content-length':String(100*1024*1024+1)}});await assert.rejects(downloadTwitchClipAsset('https://production.assets.clips.twitchcdn.net/signed/object',{resolveDns:async()=>[{address:'8.8.8.8',family:4}],request:oversized.request}),/TWITCH_DOWNLOAD_TOO_LARGE/);assert.equal(oversized.count,1);
});

test('Twitch clip downloader bounds DNS resolution and opens no socket after a resolver stall',async()=>{
  let requestCount=0;
  await assert.rejects(downloadTwitchClipAsset('https://production.assets.clips.twitchcdn.net/signed/object',{
    resolveDns:()=>new Promise(()=>{}),dnsTimeoutMs:10,request:()=>{requestCount++;throw new Error('network must not start');},
  }),/TWITCH_CDN_DNS_TIMEOUT/);
  assert.equal(requestCount,0);
});

test('Twitch clip downloader enforces the workspace byte budget from headers and streamed bytes',async()=>{
  for(const fixture of [
    fixtureRequest({headers:{'content-type':'video/mp4','content-length':'13'},bytes:Buffer.alloc(13)}),
    fixtureRequest({headers:{'content-type':'video/mp4'},bytes:Buffer.alloc(13)}),
  ]) {
    await assert.rejects(downloadTwitchClipAsset('https://production.assets.clips.twitchcdn.net/signed/object',{
      maxBytes:12,
      limitExceededCode:'PROJECT_STORAGE_QUOTA_EXCEEDED',
      resolveDns:async()=>[{address:'8.8.8.8',family:4}],
      request:fixture.request,
    }),/PROJECT_STORAGE_QUOTA_EXCEEDED/);
    assert.equal(fixture.count,1);
  }
  const malformed=fixtureRequest({headers:{'content-type':'video/mp4','content-length':'invalid'},bytes:Buffer.alloc(13)});
  await assert.rejects(downloadTwitchClipAsset('https://production.assets.clips.twitchcdn.net/signed/object',{
    maxBytes:12,limitExceededCode:'PROJECT_STORAGE_QUOTA_EXCEEDED',
    resolveDns:async()=>[{address:'8.8.8.8',family:4}],request:malformed.request,
  }),/TWITCH_DOWNLOAD_LENGTH_INVALID/);
});
