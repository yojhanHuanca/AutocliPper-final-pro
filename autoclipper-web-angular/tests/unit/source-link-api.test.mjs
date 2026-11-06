import '@angular/compiler';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectsApi, SettingsApi } from '../../.local/tests/client.mjs';

test('Twitch status and OAuth operations use the documented account routes', async () => {
  const api = Object.create(ProjectsApi.prototype);
  const calls = [];
  api.api = {
    get: async (...args) => { calls.push(['get', ...args]); return { configured: true, linked: false, account: null }; },
    post: async (...args) => { calls.push(['post', ...args]); return { authorizationUrl: 'https://id.twitch.tv/oauth2/authorize', expiresInSeconds: 300, scope: 'editor:manage:clips' }; },
    delete: async (...args) => { calls.push(['delete', ...args]); return { unlinked: true }; },
  };

  assert.equal((await api.twitchLinkStatus()).configured, true);
  await api.linkTwitch();
  await api.unlinkTwitch();
  assert.deepEqual(calls, [
    ['get', '/auth/twitch/link'],
    ['post', '/auth/twitch/link', {}],
    ['delete', '/auth/twitch/link'],
  ]);
});

test('Twitch account settings use the same implemented Identity connection routes',async()=>{
  const api=Object.create(SettingsApi.prototype),calls=[];
  api.api={
    get:async(...args)=>{calls.push(['get',...args]);return{configured:true,linked:false,account:null};},
    post:async(...args)=>{calls.push(['post',...args]);return{authorizationUrl:'https://id.twitch.tv/oauth2/authorize',expiresInSeconds:300,scope:'editor:manage:clips'};},
    delete:async(...args)=>{calls.push(['delete',...args]);return{unlinked:true};},
  };
  assert.equal((await api.twitchLinkStatus()).configured,true);
  await api.linkTwitch(); await api.unlinkTwitch();
  assert.deepEqual(calls,[['get','/auth/twitch/link'],['post','/auth/twitch/link',{}],['delete','/auth/twitch/link']]);
});

test('source resolution and import send only the project URL and reuse an idempotency key', async () => {
  const api = Object.create(ProjectsApi.prototype);
  const calls = [];
  api.api = { post: async (...args) => { calls.push(args); return { provider: 'twitch', state: 'available', importable: true }; } };
  const project = 'project/with space';
  const url = 'https://clips.twitch.tv/ExampleClip';
  await api.resolveSourceLink(project, url);
  await api.importSourceLink(project, url, 'stable-key');
  assert.deepEqual(calls, [
    ['/projects/project%2Fwith%20space/source-links/resolve', { url }],
    ['/projects/project%2Fwith%20space/source-links/import', { url }, 'stable-key'],
  ]);
});

test('Twitch VOD resolution and import send the same explicit interval and optional title', async () => {
  const api = Object.create(ProjectsApi.prototype);
  const calls = [];
  api.api = { post: async (...args) => { calls.push(args); return { provider: 'twitch', state: 'available', importable: true }; } };
  const url = 'https://www.twitch.tv/videos/12345';
  const interval = { vodOffsetSeconds: 185, durationSeconds: 30, title: 'Momento clave' };
  await api.resolveSourceLink('project-1', url, interval);
  await api.importSourceLink('project-1', url, 'vod-idempotency-key', interval);
  assert.deepEqual(calls, [
    ['/projects/project-1/source-links/resolve', { url, ...interval }],
    ['/projects/project-1/source-links/import', { url, ...interval }, 'vod-idempotency-key'],
  ]);
});

test('project source capabilities use the published read route', async () => {
  const api = Object.create(ProjectsApi.prototype);
  const calls = [];
  api.api = { get: async (...args) => { calls.push(args); return { projectId: 'project-1', providers: [] }; } };
  await api.sourceLinkCapabilities('project-1/unsafe');
  assert.deepEqual(calls, [['/projects/project-1%2Funsafe/source-links/capabilities']]);
});

test('YouTube metadata resolution carries an abort signal and a finite deadline', async () => {
  const api = Object.create(ProjectsApi.prototype);
  const calls = [];
  api.api = {
    postCancelable: async (...args) => { calls.push(args); return { provider: 'youtube', state: 'unsupported', importable: false }; },
  };
  const controller = new AbortController();
  await api.resolveSourceLink('project-1', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', {
    signal: controller.signal,
    timeoutMs: 7_000,
  });
  assert.deepEqual(calls, [[
    '/projects/project-1/source-links/resolve',
    { url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE' },
    controller.signal,
    7_000,
  ]]);
});
