import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocialProviders } from '../apps/autoclipper-project-service/dist/application/social-providers.js';
import { publicationInput } from '../apps/autoclipper-project-service/dist/application/social-publishing.service.js';
import { youtubeDownloadArgs } from '../apps/autoclipper-project-service/dist/application/youtube-download.js';

test('YouTube extractor accepts IDs only, ignores personal config and never launches a shell', () => {
  for (const id of ['https://localhost/private', '../secret', '-exec', 'a'.repeat(12)]) assert.throws(() => youtubeDownloadArgs(id, '/tmp/job', 1024));
  const args = youtubeDownloadArgs('abcdefghijk', '/tmp/job', 1024);
  assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(args.at(-2), '--');
  assert.ok(args.includes('--ignore-config')); assert.ok(args.includes('--no-playlist'));
  assert.ok(!args.includes('--cookies-from-browser'));
  assert.throws(() => youtubeDownloadArgs('abcdefghijk', '/tmp/job', 0));
  assert.throws(() => youtubeDownloadArgs('abcdefghijk', '/tmp/job', 104857601));
});

test('publication requires explicit consent and an audience declaration, with private visibility by default', () => {
  const input = { provider: 'youtube', title: 'Mi clip', madeForKids: false, consent: true };
  assert.equal(publicationInput.parse(input).privacy, 'private');
  assert.equal(publicationInput.safeParse({ ...input, consent: false }).success, false);
  assert.equal(publicationInput.safeParse({ provider: 'youtube', title: 'Mi clip', consent: true }).success, false);
  assert.equal(publicationInput.safeParse({ ...input, accessToken: 'must-not-accept' }).success, false);
});

test('YouTube initiation validates provider upload host before sending any video bytes', async () => {
  let calls = 0;
  const providers = new SocialProviders(async (url, init) => {
    calls++; assert.equal(new URL(url).hostname, 'www.googleapis.com');
    assert.equal(JSON.parse(init.body).status.privacyStatus, 'private');
    return new globalThis.Response('', { status: 200, headers: { location: 'https://127.0.0.1/upload/private' } });
  });
  await assert.rejects(providers.youtubeInit('fixture-token', { title: 'Clip', description: '', privacy: 'private', madeForKids: false, bytes: 1024 }), error => error.code === 'SOCIAL_UPLOAD_URL_INVALID' && error.uncertain);
  assert.equal(calls, 1);
});

test('TikTok inbox upload uses bounded FILE_UPLOAD chunks and does not claim direct publication', async () => {
  const providers = new SocialProviders(async (url, init) => {
    assert.equal(url, 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/');
    const { source_info } = JSON.parse(init.body);
    assert.equal(source_info.source, 'FILE_UPLOAD');
    assert.equal(source_info.total_chunk_count, 2);
    return globalThis.Response.json({ error: { code: 'ok' }, data: { publish_id: 'fixture-publish', upload_url: 'https://open-upload.tiktokapis.com/upload/fixture' } });
  });
  const result = await providers.tiktokInit('fixture-token', 25 * 1024 * 1024);
  assert.equal(result.chunkSize, 10 * 1024 * 1024);
  assert.equal(result.totalChunks, 2);
});

test('TikTok refuses arbitrary signed upload hosts and uncertain provider outcomes are not safe to replay', async () => {
  const providers = new SocialProviders(async () => globalThis.Response.json({ error: { code: 'ok' }, data: { publish_id: 'fixture', upload_url: 'https://attacker.example/upload' } }));
  await assert.rejects(providers.tiktokInit('fixture-token', 100), error => error.code === 'SOCIAL_UPLOAD_URL_INVALID' && error.uncertain);
  const broken = new SocialProviders(async () => { throw new Error('token and provider internals'); });
  await assert.rejects(broken.tiktokInit('fixture-token', 100), error => error.code === 'SOCIAL_PROVIDER_UNREACHABLE' && error.uncertain && !error.message.includes('token'));
});

test('TikTok processing distinguishes inbox delivery from a final published post', async () => {
  const providers = new SocialProviders(async () => globalThis.Response.json({ error: { code: 'ok' }, data: { status: 'SEND_TO_USER_INBOX' } }));
  assert.equal(await providers.tiktokStatus('fixture-token', 'fixture-id'), 'SEND_TO_USER_INBOX');
});
