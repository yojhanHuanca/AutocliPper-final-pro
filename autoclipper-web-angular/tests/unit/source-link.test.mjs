import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceLinkFeedback, recognizeSourceLink, officialSourcePreview, canonicalTwitchClipImportUrl, canonicalYouTubeMetadataUrl, unsupportedSourceImportResolution, SourceLinkPreviewComponent, HttpErrorResponse } from '../../.local/tests/client.mjs';
import { signal } from '@angular/core';

const sourceLinkTemplate = readFileSync(new URL('../../src/app/features/projects/components/source-link-preview.component.html', import.meta.url), 'utf8');

test('source link syntax never asserts provider support or import availability', () => {
  for (const value of ['https://example.test/video', '  https://kick.com/example  ', 'http://example.test/a']) {
    const result = sourceLinkFeedback(value);
    assert.equal(result.valid, true);
    assert.match(result.message, /depende de la plataforma/);
  }
});

test('a late Twitch connection response cannot replace a newer confirmed status', async () => {
  const pending = [];
  const component = Object.create(SourceLinkPreviewComponent.prototype);
  Object.assign(component, {
    canImport: () => true, projectId: () => 'project-fixture', twitchStatusGeneration: 0,
    twitchStatus: signal({ configured: false, linked: false, account: null }),
    resolved: signal(null), sourceError: signal(''), sourceNotice: signal(''), importKey: '',
    api: { twitchLinkStatus: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
  });
  const earlier = component.refreshTwitchStatus();
  const latest = component.refreshTwitchStatus();
  pending[1].resolve({ configured: true, linked: false, account: null });
  await latest;
  pending[0].resolve({ configured: false, linked: false, account: null });
  await earlier;
  assert.deepEqual(component.twitchStatus(), { configured: true, linked: false, account: null });
});

test('a failed Twitch status refresh clears the old linked state and resolved clip', async () => {
  const component = Object.create(SourceLinkPreviewComponent.prototype);
  Object.assign(component, {
    canImport: () => true, projectId: () => 'project-fixture', twitchStatusGeneration: 0,
    twitchStatus: signal({ configured: true, linked: true, account: { login: 'creator' } }),
    resolved: signal({ title: 'previously available clip' }), sourceError: signal(''), sourceNotice: signal(''), importKey: 'stale-key',
    api: { twitchLinkStatus: async () => { throw new Error('network unavailable'); } },
  });
  await component.refreshTwitchStatus();
  assert.equal(component.twitchStatus(), null);
  assert.equal(component.resolved(), null);
  assert.equal(component.importKey, '');
  assert.notEqual(component.sourceError(), '');
});

test('a failed availability check from a previous project cannot leave its error in the new project', async () => {
  let rejectResolution;
  const pending = new Promise((_resolve, reject) => { rejectResolution = reject; });
  const component = Object.create(SourceLinkPreviewComponent.prototype);
  Object.assign(component, {
    canImport: () => true, projectId: () => currentProject,
    value: signal('https://clips.twitch.tv/ExampleClip'), result: signal(recognizeSourceLink('https://clips.twitch.tv/ExampleClip')),
    twitchStatus: signal({ configured: true, linked: true, account: null }), sourceBusy: signal(false),
    sourceError: signal(''), sourceNotice: signal(''), resolved: signal(null), importKey: '', sourceOperationGeneration: 0,
    lastProjectId: 'project-alpha', requestedFrame: signal(null), previewState: signal('idle'),
    previewError: signal(''), previewAvailable: { emit() {} },
    api: { resolveSourceLink: () => pending },
  });
  let currentProject = 'project-alpha';
  const check = component.resolveTwitch();
  currentProject = 'project-beta';
  component.synchronizeProjectSource(currentProject, '');
  rejectResolution(new Error('old project unavailable'));
  await check;
  assert.equal(component.sourceError(), '');
  assert.equal(component.sourceBusy(), false);
  assert.equal(component.resolved(), null);
});

test('a missing Twitch Gateway route is reported as unavailable without claiming a linked account',()=>{
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  assert.match(component.reasonMessage('RESOURCE_NOT_FOUND'),/Gateway todavía no publica la ruta de conexión Twitch/);
  assert.match(component.reasonMessage('TWITCH_OAUTH_NOT_CONFIGURED'),/cargar un MP4 propio/);
});

test('configured=false clears stale availability and never calls resolve or import',async()=>{
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  let mutations=0;
  Object.assign(component,{
    canImport:()=>true,projectId:()=> 'project-fixture',twitchStatusGeneration:0,sourceBusy:signal(false),sourceError:signal(''),sourceNotice:signal(''),
    twitchStatus:signal({configured:true,linked:true,account:{login:'creator'}}),resolved:signal({title:'old result'}),
    result:signal(recognizeSourceLink('https://clips.twitch.tv/ExampleClip')),value:signal('https://clips.twitch.tv/ExampleClip'),importKey:'old-key',
    api:{twitchLinkStatus:async()=>({configured:false,linked:false,account:null}),resolveSourceLink:async()=>{mutations++;},importSourceLink:async()=>{mutations++;}},
  });
  await component.refreshTwitchStatus();
  assert.equal(component.twitchStatus().configured,false);
  assert.equal(component.resolved(),null);
  await component.resolveTwitch();
  await component.importTwitch();
  assert.equal(mutations,0);
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

test('YouTube and Kick previews expose their unsupported import contract and authorized-file next action',()=>{
  const youtube=unsupportedSourceImportResolution(recognizeSourceLink('https://youtube.com/watch?v=M7lc1UVf-VE').target);
  const kick=unsupportedSourceImportResolution(recognizeSourceLink('https://kick.com/example-channel').target);
  assert.deepEqual([youtube.state,youtube.importable,youtube.reasonCode,youtube.nextAction],['unsupported',false,'YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED','upload_authorized_file']);
  assert.match(youtube.nextStep,/autorización/iu);
  assert.deepEqual([kick.state,kick.importable,kick.reasonCode,kick.nextAction],['unsupported',false,'KICK_MEDIA_API_UNAVAILABLE','upload_authorized_file']);
  assert.match(kick.nextStep,/sube el archivo MP4/iu);
  assert.equal(unsupportedSourceImportResolution(recognizeSourceLink('https://clips.twitch.tv/ExampleClip').target),null);
});

test('YouTube metadata lookup shows only server-confirmed details and never enables URL import',async()=>{
  const result=recognizeSourceLink('https://youtu.be/M7lc1UVf-VE?t=17');
  assert.equal(canonicalYouTubeMetadataUrl(result),'https://www.youtube.com/watch?v=M7lc1UVf-VE');
  assert.equal(canonicalYouTubeMetadataUrl(recognizeSourceLink('https://youtube.com/playlist?list=123')),null);
  const calls=[];
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  Object.assign(component,{
    canImport:()=>true,projectId:()=> 'project-metadata',value:signal('https://youtu.be/M7lc1UVf-VE?t=17'),
    result:signal(result),sourceBusy:signal(false),sourceError:signal(''),sourceNotice:signal(''),
    sourceOperationGeneration:0,importResolution:signal(unsupportedSourceImportResolution(result.target)),
    api:{
      resolveSourceLink:async(...args)=>{calls.push(['resolve',...args]);return{provider:'youtube',state:'unsupported',importable:false,reasonCode:'YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED',youtubeMetadata:{state:'available',title:'Título consultado',channelTitle:'Canal confirmado',durationSeconds:83,thumbnailUrl:'https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg',uploadStatus:'processed',privacyStatus:'public',embeddable:true}};},
      importSourceLink:async(...args)=>{calls.push(['import',...args]);throw new Error('YouTube no se importa desde URL.');},
    },
  });
  await component.resolveYouTubeMetadata();
  assert.deepEqual(calls,[['resolve','project-metadata','https://www.youtube.com/watch?v=M7lc1UVf-VE']]);
  const resolution=component.importResolution();
  assert.equal(resolution.youtubeMetadata.title,'Título consultado');
  assert.equal(resolution.youtubeMetadata.channelTitle,'Canal confirmado');
  assert.equal(resolution.youtubeMetadata.durationSeconds,83);
  assert.equal(resolution.importable,false);
  assert.equal(resolution.state,'unsupported');
  assert.equal(component.safeYoutubeThumbnail(resolution.youtubeMetadata.thumbnailUrl),'https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg');
  assert.equal(component.safeYoutubeThumbnail('https://example.test/image.jpg'),null);
  assert.equal(component.formatYoutubeDuration(3661),'1:01:01');
  assert.match(component.sourceNotice(),/MP4 inspeccionado/);
  assert.equal(component.sourceBusy(),false);
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

test('Twitch import strips tracking parameters and sends only a recognized clip ID in the backend-supported shape',()=>{
  const clip=recognizeSourceLink('https://www.twitch.tv/creator/clip/ExampleClip-123?tt_content=channel_name&tt_medium=clips_api');
  assert.equal(canonicalTwitchClipImportUrl(clip),'https://clips.twitch.tv/ExampleClip-123');
  assert.equal(canonicalTwitchClipImportUrl(recognizeSourceLink('https://clips.twitch.tv/ExampleClip?ref=share')),'https://clips.twitch.tv/ExampleClip');
  assert.equal(canonicalTwitchClipImportUrl(recognizeSourceLink('https://twitch.tv/videos/12345')),null);
  assert.equal(canonicalTwitchClipImportUrl(recognizeSourceLink('https://youtube.com/watch?v=M7lc1UVf-VE')),null);
  assert.equal(canonicalTwitchClipImportUrl(null),null);
});

test('Twitch availability and import use the normalized clip URL while leaving the pasted URL unchanged',async()=>{
  const pasted='https://www.twitch.tv/creator/clip/ExampleClip-123?tt_content=channel_name';
  const calls=[];
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  Object.assign(component,{
    canImport:()=>true,projectId:()=> 'project-fixture',value:signal(pasted),
    result:signal(recognizeSourceLink(pasted)),twitchStatus:signal({configured:true,linked:true,account:null}),
    sourceBusy:signal(false),sourceError:signal(''),sourceNotice:signal(''),resolved:signal(null),importResolution:signal(null),importKey:'stable-key',
    api:{
      resolveSourceLink:async(...args)=>{calls.push(['resolve',...args]);return{provider:'twitch',state:'available',importable:true,title:'Clip autorizado',message:'La cuenta tiene permiso para descargar este clip.',nextStep:'Confirma la importación.'};},
      importSourceLink:async(...args)=>{calls.push(['import',...args]);return{state:'succeeded',uploadId:'confirmed-upload',title:'Clip autorizado'};},
    },
    imported:{emit:value=>calls.push(['selected',value])},
  });
  await component.resolveTwitch();
  assert.equal(component.resolved().title,'Clip autorizado');
  assert.equal(component.importResolution().state,'available');
  assert.match(component.sourceNotice(),/inspección deben finalizar/);
  assert.deepEqual(calls,[['resolve','project-fixture','https://clips.twitch.tv/ExampleClip-123']]);
  component.importKey='stable-key';
  await component.importTwitch();
  assert.deepEqual(calls.slice(1),[
    ['import','project-fixture','https://clips.twitch.tv/ExampleClip-123','stable-key'],
    ['selected',{uploadId:'confirmed-upload',title:'Clip autorizado'}],
  ]);
  assert.equal(component.value(),pasted);
});

test('Twitch unavailable resolution stays actionable and is not presented as a transport error',async()=>{
  const value='https://clips.twitch.tv/ExampleClip';
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  Object.assign(component,{
    canImport:()=>true,projectId:()=> 'project-fixture',value:signal(value),result:signal(recognizeSourceLink(value)),
    twitchStatus:signal({configured:true,linked:true,account:null}),sourceBusy:signal(false),sourceError:signal(''),
    sourceNotice:signal(''),resolved:signal(null),importResolution:signal(null),importKey:'',sourceOperationGeneration:0,
    api:{resolveSourceLink:async()=>({provider:'twitch',state:'unavailable',importable:false,reasonCode:'TWITCH_CHANNEL_EDITOR_REQUIRED',nextAction:'connect_broadcaster_or_editor_account',message:'La cuenta no puede descargar el clip.',nextStep:'Vincula una cuenta con permiso en el canal.'})},
  });
  await component.resolveTwitch();
  assert.equal(component.importResolution().state,'unavailable');
  assert.equal(component.importResolution().reasonCode,'TWITCH_CHANNEL_EDITOR_REQUIRED');
  assert.equal(component.sourceError(),'');
  assert.equal(component.resolved(),null);
});

test('a confirmed Twitch disconnection during import removes stale availability and asks for a fresh connection check', async () => {
  const component = Object.create(SourceLinkPreviewComponent.prototype);
  const pasted = 'https://clips.twitch.tv/ExampleClip';
  Object.assign(component, {
    canImport: () => true, projectId: () => 'project-fixture', value: signal(pasted),
    result: signal(recognizeSourceLink(pasted)), twitchStatusGeneration: 0, sourceOperationGeneration: 0,
    twitchStatus: signal({ configured: true, linked: true, account: { login: 'creator' } }),
    resolved: signal({ title: 'Clip todavía listo' }), sourceBusy: signal(false),
    sourceError: signal(''), sourceNotice: signal(''), importKey: 'stable-key',
    api: { importSourceLink: async () => { throw new HttpErrorResponse({ status: 409, error: { code: 'TWITCH_ACCOUNT_NOT_LINKED' } }); } },
  });
  await component.importTwitch();
  assert.equal(component.twitchStatus(), null);
  assert.equal(component.resolved(), null);
  assert.equal(component.importKey, '');
  assert.equal(component.sourceBusy(), false);
  assert.match(component.sourceError(), /Vincula una cuenta Twitch/);
});

test('validation prepares an official preview without loading its iframe until an explicit click',async()=>{
  assert.match(sourceLinkTemplate,/<button[^>]*\(click\)="loadPreview\(\)"[^>]*>Abrir vista previa<\/button>/);
  assert.match(sourceLinkTemplate,/solo se cargará cuando pulses «Abrir vista previa»/);
  assert.doesNotMatch(sourceLinkTemplate,/se abrirá automáticamente en este espacio/);
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  const trusted=[];
  const availability=[];
  Object.assign(component,{value:signal(''),result:signal(null),resolved:signal(null),sourceNotice:signal(''),sourceError:signal(''),sourceBusy:signal(false),sourceOperationGeneration:0,linkChanged:{emit(){}},previewAvailable:{emit(value){availability.push(value);}},requestedFrame:signal(null),previewState:signal('idle'),previewError:signal(''),previewFits:()=>true,active:()=>true,sanitizer:{bypassSecurityTrustResourceUrl:url=>{trusted.push(url);return url;}},focusPreview:()=>{},frameTimer:undefined});
  const originalWindow=globalThis.window; globalThis.window={location:{hostname:'localhost'}};
  try {
  component.update({target:{value:'https://youtu.be/M7lc1UVf-VE'}});
  assert.equal(component.result(),null); assert.equal(trusted.length,0);
  component.validate(); assert.equal(component.result().state,'preview'); assert.equal(availability.at(-1),true);
  await Promise.resolve();
  assert.equal(component.previewState(),'idle'); assert.equal(trusted.length,0,'Validation must not load the third-party player.');
  component.loadPreview();
  assert.equal(component.previewState(),'loading'); assert.equal(trusted.length,1);
  component.update({target:{value:'https://evil.test/video'}}); assert.equal(component.requestedFrame(),null); assert.equal(component.result(),null); assert.equal(availability.at(-1),false);
  component.validate(); assert.equal(availability.at(-1),false); await Promise.resolve(); assert.equal(trusted.length,1);
  } finally {globalThis.window=originalWindow;}
});

test('validating YouTube prepares preview-only UI without calling source resolve or import APIs',()=>{
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  let backendCalls=0;
  Object.assign(component,{
    value:signal('https://www.youtube.com/watch?v=M7lc1UVf-VE'),result:signal(null),resolved:signal(null),
    sourceNotice:signal(''),sourceError:signal(''),sourceBusy:signal(false),sourceOperationGeneration:0,
    previewAvailable:{emit(){}},requestedFrame:signal(null),previewState:signal('idle'),previewError:signal(''),
    importResolution:signal(null),canImport:()=>true,
    api:{resolveSourceLink:async()=>{backendCalls++;},importSourceLink:async()=>{backendCalls++;}},frameTimer:undefined,
  });
  component.validate();
  assert.equal(component.result().target.platform,'YouTube');
  assert.equal(component.importResolution().importable,false);
  assert.equal(component.importResolution().nextAction,'upload_authorized_file');
  assert.equal(backendCalls,0);
});

test('preview has explicit loading, ready and error states with retry and CSP handling',()=>{
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  const trusted=[];
  Object.assign(component,{
    value:signal('https://youtu.be/M7lc1UVf-VE'),result:signal(recognizeSourceLink('https://youtu.be/M7lc1UVf-VE')),
    requestedFrame:signal(null),previewState:signal('idle'),previewError:signal(''),width:signal(600),
    previewFits:()=>true,active:()=>true,sanitizer:{bypassSecurityTrustResourceUrl:url=>{trusted.push(url);return url;}},
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

test('a YouTube preview timeout removes the iframe, announces the limit and can retry or close',()=>{
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  let timerCallback;
  let timerDelay=0;
  const cleared=[];
  Object.assign(component,{
    value:signal('https://youtu.be/M7lc1UVf-VE'),result:signal(recognizeSourceLink('https://youtu.be/M7lc1UVf-VE')),
    requestedFrame:signal(null),previewState:signal('idle'),previewError:signal(''),width:signal(600),
    previewFits:()=>true,active:()=>true,sanitizer:{bypassSecurityTrustResourceUrl:url=>url},focusPreview:()=>{},frameTimer:undefined,
  });
  const originalWindow=globalThis.window, originalSetTimeout=globalThis.setTimeout, originalClearTimeout=globalThis.clearTimeout;
  globalThis.window={location:{hostname:'localhost'}};
  globalThis.setTimeout=(callback,delay)=>{timerCallback=callback;timerDelay=delay;return 17;};
  globalThis.clearTimeout=id=>{cleared.push(id);};
  try {
    component.loadPreview();
    assert.equal(component.previewState(),'loading');
    assert.equal(timerDelay,15000);
    timerCallback();
    assert.equal(component.previewState(),'error');
    assert.equal(component.requestedFrame(),null);
    assert.match(component.previewError(),/tardó demasiado/i);

    component.loadPreview();
    assert.equal(component.previewState(),'loading','retry starts a fresh isolated frame');
    assert.equal(component.previewError(),'');
    component.closePreview();
    assert.equal(component.previewState(),'idle');
    assert.equal(component.requestedFrame(),null);
    assert.ok(cleared.includes(17),'closing cancels the outstanding timeout');
  } finally {
    globalThis.window=originalWindow;
    globalThis.setTimeout=originalSetTimeout;
    globalThis.clearTimeout=originalClearTimeout;
  }
});

test('leaving the link pane closes the player but keeps the pasted URL and local validation',()=>{
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  const checked=recognizeSourceLink('https://youtu.be/M7lc1UVf-VE');
  Object.assign(component,{value:signal('https://youtu.be/M7lc1UVf-VE'),result:signal(checked),requestedFrame:signal('trusted-frame'),previewState:signal('ready'),previewError:signal(''),focusPreview:()=>{}});
  component.onVisibilityChange(false);
  assert.equal(component.requestedFrame(),null);
  assert.equal(component.previewState(),'idle');
  assert.equal(component.value(),'https://youtu.be/M7lc1UVf-VE');
  assert.equal(component.result(),checked);
});

test('reusing the source preview for a different project clears the old URL and imports only the restored link',()=>{
  const component=Object.create(SourceLinkPreviewComponent.prototype);
  const availability=[];
  Object.assign(component,{
    lastProjectId:'project-alpha',value:signal('https://youtu.be/M7lc1UVf-VE'),
    result:signal(recognizeSourceLink('https://youtu.be/M7lc1UVf-VE')),
    previewAvailable:{emit:value=>availability.push(value)},resolved:signal({title:'stale clip'}),
    sourceNotice:signal('stale notice'),sourceError:signal('stale error'),sourceBusy:signal(false),sourceOperationGeneration:0,importKey:'stale-key',
    requestedFrame:signal('stale-frame'),previewState:signal('ready'),previewError:signal(''),
  });
  component.synchronizeProjectSource('project-beta','https://youtu.be/ScMzIvxBSi4');
  assert.equal(component.value(),'https://youtu.be/ScMzIvxBSi4');
  assert.equal(component.result().target.id,'ScMzIvxBSi4');
  assert.equal(component.resolved(),null);
  assert.equal(component.importKey,'');
  assert.equal(component.requestedFrame(),null);
  assert.equal(component.previewState(),'idle');
  assert.match(component.result().message,/sube el archivo original/i);

  component.synchronizeProjectSource('project-gamma','');
  assert.equal(component.value(),'');
  assert.equal(component.result(),null);
  assert.equal(component.requestedFrame(),null);
  assert.deepEqual(availability,[false,true,false]);
});

test('source link rejects incomplete, executable, credential-bearing and oversized values', () => {
  for (const value of ['kick.com/example', 'javascript:alert(1)', 'file:///tmp/video', 'https://user:secret@example.test/video', 'https://example.test/' + 'a'.repeat(2048)]) {
    assert.equal(sourceLinkFeedback(value).valid, false);
  }
  assert.deepEqual(sourceLinkFeedback('  '), {valid:false, message:''});
});
