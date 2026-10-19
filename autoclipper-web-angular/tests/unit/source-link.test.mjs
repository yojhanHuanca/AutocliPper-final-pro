import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLinkFeedback, recognizeSourceLink, officialSourcePreview, SourceLinkPreviewComponent } from '../../.local/tests/client.mjs';
import { signal } from '@angular/core';

test('source link syntax never asserts provider support or import availability', () => {
  for (const value of ['https://example.test/video', '  https://kick.com/example  ', 'http://example.test/a']) {
    const result = sourceLinkFeedback(value);
    assert.equal(result.valid, true);
    assert.match(result.message, /todavía no está disponible/);
  }
});

test('source recognition permits exact official domains and concrete known shapes only',()=>{
  for(const url of ['https://youtube.com/watch?v=M7lc1UVf-VE','https://youtu.be/M7lc1UVf-VE?t=3','https://m.youtube.com/shorts/M7lc1UVf-VE','https://www.youtube.com/live/M7lc1UVf-VE']) {
    const result=recognizeSourceLink(url); assert.equal(result.state,'preview'); assert.equal(result.target.id,'M7lc1UVf-VE');
  }
  assert.deepEqual(recognizeSourceLink('https://www.twitch.tv/videos/12345').target,{platform:'Twitch',kind:'video',id:'12345'});
  assert.equal(recognizeSourceLink('https://clips.twitch.tv/IncredulousAbstemiousFennelImGlitch').target.kind,'clip');
  assert.equal(recognizeSourceLink('https://www.twitch.tv/twitchdev/clip/ExampleClip-123').target.kind,'clip');
  const kickLive = recognizeSourceLink('https://kick.com/example-channel');
  assert.equal(kickLive.target.kind,'live');
  assert.match(kickLive.message,/canal en directo/);
  for(const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE','https://youtube.com@evil.test/watch?v=M7lc1UVf-VE','https://evil.test/?url=https://youtube.com/watch?v=M7lc1UVf-VE','https://notkick.com/example','https://twitch.tv.evil.test/videos/123','https://www.youtube.com./watch?v=M7lc1UVf-VE','https://player.kick.com/example']) {
    assert.equal(recognizeSourceLink(url).target,undefined,url);
  }
});

test('empty, invalid and unverifiable links have explicit states without manufacturing a player',()=>{
  assert.equal(recognizeSourceLink(' ').state,'empty');
  for(const url of ['youtube.com/watch?v=M7lc1UVf-VE','javascript:alert(1)','http://youtube.com/watch?v=M7lc1UVf-VE','https://youtube.com:8443/watch?v=M7lc1UVf-VE','https://user:pass@youtube.com/watch?v=M7lc1UVf-VE','https://you\ntube.com/watch?v=M7lc1UVf-VE']) assert.equal(recognizeSourceLink(url).state,'invalid',url);
  for(const url of ['https://kick.com/video/123','https://kick.com/channel/videos/123','https://kick.com/channel?clip=clip_123','https://kick.com/channel?clip_id=123','https://kick.com/videos','https://youtube.com/playlist?list=123','https://youtube.com/watch?v=short','https://youtube.com/watch?v=M7lc1UVf-VE&v=AAAAAAAAAAA','https://twitch.tv/twitchdev']) {
    const result=recognizeSourceLink(url); assert.equal(result.state,'unverifiable',url); assert.equal(result.target,undefined);
    if (url.includes('kick.com')) assert.match(result.message,/no se convierte en ese canal.*VOD\/clips no se importan/);
  }
});

test('official player URLs discard user query strings and refuse unsafe identifiers or origins',()=>{
  const youtube=recognizeSourceLink('https://youtu.be/M7lc1UVf-VE?autoplay=1&origin=https://evil.test');
  assert.equal(officialSourcePreview(youtube.target,'localhost'),'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=0');
  const twitch=recognizeSourceLink('https://twitch.tv/videos/12345');
  assert.equal(officialSourcePreview(twitch.target,'studio.example.test'),'https://player.twitch.tv/?video=v12345&parent=studio.example.test&autoplay=false');
  assert.equal(officialSourcePreview({platform:'Kick',kind:'live',id:'example'},'localhost'),'https://player.kick.com/example?autoplay=false');
  assert.equal(officialSourcePreview({platform:'Kick',kind:'video',id:'example'},'localhost'),null);
  assert.equal(officialSourcePreview({platform:'YouTube',kind:'video',id:'x?origin=evil'},'localhost'),null);
  assert.equal(officialSourcePreview(twitch.target,'evil.test&autoplay=true'),null);
});

test('validation requires submission, clears a previous embed and never calls the trust boundary until preview is requested',()=>{
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  const trusted=[];
  Object.assign(component,{value:signal(''),result:signal(null),requestedFrame:signal(null),previewState:signal('idle'),previewError:signal(''),previewFits:()=>true,sanitizer:{bypassSecurityTrustResourceUrl:url=>{trusted.push(url);return url;}},focusPreview:()=>{}});
  component.update({target:{value:'https://youtu.be/M7lc1UVf-VE'}});
  assert.equal(component.result(),null); assert.equal(trusted.length,0);
  component.validate(); assert.equal(component.result().state,'preview'); assert.equal(component.requestedFrame(),null); assert.equal(trusted.length,0);
  const originalWindow=globalThis.window; globalThis.window={location:{hostname:'localhost'}};
  try { component.loadPreview(); assert.equal(trusted.length,1); component.update({target:{value:'https://evil.test/video'}}); assert.equal(component.requestedFrame(),null); assert.equal(component.result(),null); component.validate(); component.loadPreview(); assert.equal(trusted.length,1); }
  finally {globalThis.window=originalWindow;}
});

test('preview has explicit loading, ready and error states with retry and CSP handling',()=>{
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  const trusted=[];
  Object.assign(component,{
    value:signal('https://youtu.be/M7lc1UVf-VE'),result:signal(recognizeSourceLink('https://youtu.be/M7lc1UVf-VE')),
    requestedFrame:signal(null),previewState:signal('idle'),previewError:signal(''),width:signal(600),
    previewFits:()=>true,sanitizer:{bypassSecurityTrustResourceUrl:url=>{trusted.push(url);return url;}},
    focusPreview:()=>{},frameTimer:undefined,
  });
  const originalWindow=globalThis.window; globalThis.window={location:{hostname:'localhost'}};
  try {
    component.loadPreview(); assert.equal(component.previewState(),'loading');
    assert.equal(trusted.length,1);
    component.previewLoaded(); assert.equal(component.previewState(),'ready');
    component.failPreview('Bloqueado por CSP'); assert.equal(component.previewState(),'error');
    assert.equal(component.requestedFrame(),null); assert.match(component.previewError(),/CSP/);
    component.loadPreview(); assert.equal(component.previewState(),'loading'); assert.equal(trusted.length,2);
    component.previewFailed(); assert.equal(component.previewState(),'error'); assert.equal(component.requestedFrame(),null);
    component.closePreview(); assert.equal(component.previewState(),'idle'); assert.equal(component.previewError(),'');
  } finally { globalThis.window=originalWindow; }
});

test('source link rejects incomplete, executable, credential-bearing and oversized values', () => {
  for (const value of ['kick.com/example', 'javascript:alert(1)', 'file:///tmp/video', 'https://user:secret@example.test/video', 'https://example.test/' + 'a'.repeat(2048)]) {
    assert.equal(sourceLinkFeedback(value).valid, false);
  }
  assert.deepEqual(sourceLinkFeedback('  '), {valid:false, message:''});
});
