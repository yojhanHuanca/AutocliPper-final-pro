import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

delete process.env.TWITCH_CLIENT_ID;
delete process.env.TWITCH_CLIENT_SECRET;
delete process.env.TWITCH_REDIRECT_URI;
const { TwitchAdapter, TWITCH_CLIP_SCOPE, TWITCH_CLIP_SCOPES, TWITCH_CLIP_DOWNLOAD_HELIX_REQUEST_BUDGET, TWITCH_HELIX_REQUEST_BUDGET_PER_FIXED_MINUTE, TWITCH_VOD_CLIP_CREATE_HELIX_REQUEST_BUDGET, hasTwitchClipScope } = await import('../apps/autoclipper-identity-service/dist/infrastructure/twitch.js');
const { IdentityService } = await import('../apps/autoclipper-identity-service/dist/application/identity.service.js');
const { seal,unseal } = await import('../apps/autoclipper-identity-service/dist/infrastructure/mail.js');
const fixtureUserId='d19641bf-5b01-4afa-babd-135b25d1c6a4',fixtureKey='a'.repeat(64);

function refreshFixture({stored={accessToken:'fixture-old-access',refreshToken:'fixture-one-use-refresh'},lock='acquire',lockError,writeFailures=0,unlockError}={}){
  const state={cipher:seal(JSON.stringify(stored),fixtureKey,`twitch:${fixtureUserId}`),lockHeld:false,updates:0,unlocks:0,releases:[]};
  const service=Object.create(IdentityService.prototype);service.encryptionKey=fixtureKey;
  service.pool={connect:async()=>({
    query:async(sql,values)=>{
      if(sql.includes('pg_try_advisory_lock')){
        if(lockError)throw lockError;
        if(lock==='busy'||state.lockHeld)return{rows:[{locked:false}]};
        state.lockHeld=true;return{rows:[{locked:true}]};
      }
      if(sql.includes('SELECT token_cipher,twitch_user_id FROM twitch_links'))return{rows:[{token_cipher:state.cipher,twitch_user_id:fixtureUserId}]};
      if(sql.includes('UPDATE twitch_links SET token_cipher=')){
        state.updates++;
        if(state.updates<=writeFailures)throw Object.assign(new Error('fixture DB write failure'),{code:'08006'});
        state.cipher=values[0];return{rows:[]};
      }
      if(sql.includes('UPDATE twitch_links SET token_validated_at='))return{rows:[]};
      if(sql.includes('pg_advisory_unlock')){
        state.unlocks++;
        if(unlockError)throw unlockError;
        state.lockHeld=false;return{rows:[{pg_advisory_unlock:true}]};
      }
      assert.fail(`unexpected refresh fixture query: ${sql}`);
    },
    release:error=>{state.releases.push(error);if(error)state.lockHeld=false;}
  })};
  service.twitch={
    refresh:async()=>({accessToken:'fixture-new-access',refreshToken:'fixture-rotated-refresh',scopes:['editor:manage:clips'],expiresIn:3600}),
    validate:async()=>({userId:fixtureUserId,login:'fixture',clientId:'fixture-client',scopes:['editor:manage:clips'],expiresIn:3600})
  };
  return{service,state};
}

test('Twitch remains explicitly disabled when no registered app credentials are configured', () => {
  const adapter=new TwitchAdapter();
  assert.equal(adapter.configured,false);
  assert.throws(()=>adapter.authorizationUrl('state'),error=>error.getStatus?.()===503&&error.getResponse?.().code==='TWITCH_OAUTH_NOT_CONFIGURED');
});

test('Twitch authorization requests only the download scope and uses a one-use state supplied by Identity', () => {
  process.env.TWITCH_CLIENT_ID='fixture-client';
  process.env.TWITCH_CLIENT_SECRET='fixture-secret';
  process.env.TWITCH_REDIRECT_URI='http://localhost:3000/v1/auth/twitch/callback';
  const adapter=new TwitchAdapter();
  const url=new URL(adapter.authorizationUrl('state-once'));
  assert.equal(url.origin,'https://id.twitch.tv');
  assert.equal(url.pathname,'/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('client_id'),'fixture-client');
  assert.equal(url.searchParams.get('redirect_uri'),process.env.TWITCH_REDIRECT_URI);
  assert.equal(url.searchParams.get('scope'),TWITCH_CLIP_SCOPE);
  assert.equal(url.searchParams.get('state'),'state-once');
  assert.equal(url.searchParams.get('force_verify'),'true');
  assert.deepEqual(TWITCH_CLIP_SCOPES,['editor:manage:clips','channel:manage:clips']);
  assert.equal(TWITCH_CLIP_SCOPE,'editor:manage:clips channel:manage:clips');
});

test('clip-download consent accepts broadcaster or editor scope and rejects unrelated scopes',()=>{
  assert.equal(hasTwitchClipScope(['channel:manage:clips']),true);
  assert.equal(hasTwitchClipScope(['editor:manage:clips']),true);
  assert.equal(hasTwitchClipScope(['user:read:email']),false);
});

test('concurrent Twitch 401 responses serialize refresh and reuse the rotated token',async()=>{
  const userId='d19641bf-5b01-4afa-babd-135b25d1c6a4',key='a'.repeat(64),initial={accessToken:'fixture-old-access',refreshToken:'fixture-one-use-refresh'};
  const service=Object.create(IdentityService.prototype),lock={held:false},state={cipher:seal(JSON.stringify(initial),key,`twitch:${userId}`)};
  service.config={INTERNAL_TOKEN:'fixture-internal'};service.encryptionKey=key;
  service.redis={incrby:async()=>1,expire:async()=>1};
  service.pool={
    query:async()=>({rows:[{token_cipher:state.cipher,login:'fixture',twitch_user_id:userId}]}),
    connect:async()=>{
      let releaseLock;
      return{
        query:async(sql,values)=>{
          if(sql.includes('pg_try_advisory_lock')){
            if(lock.held)return{rows:[{locked:false}]};
            lock.held=true;releaseLock=()=>{lock.held=false;};return{rows:[{locked:true}]};
          }
          if(sql.includes('pg_advisory_unlock')){releaseLock?.();return{rows:[{pg_advisory_unlock:true}]};}
          if(sql.includes('SELECT token_cipher,twitch_user_id FROM twitch_links'))return{rows:[{token_cipher:state.cipher,twitch_user_id:userId}]};
          if(sql.includes('UPDATE twitch_links SET token_cipher=')){state.cipher=values[0];return{rows:[]};}
          if(sql.includes('UPDATE twitch_links SET token_validated_at='))return{rows:[]};
          assert.fail(`unexpected fixture query: ${sql}`);
        },release:()=>{}
      };
    }
  };
  let refreshes=0,downloads=0;
  service.twitch={
    configured:true,
    validate:async accessToken=>{
      if(accessToken==='fixture-old-access')throw new UnauthorizedException({code:'TWITCH_TOKEN_INVALID'});
      return{userId,login:'fixture',clientId:'fixture-client',scopes:['editor:manage:clips'],expiresIn:3600};
    },
    refresh:async refreshToken=>{refreshes++;assert.equal(refreshToken,'fixture-one-use-refresh');await new Promise(resolve=>setTimeout(resolve,10));return{accessToken:'fixture-new-access',refreshToken:'fixture-rotated-refresh',scopes:['editor:manage:clips'],expiresIn:3600};},
    clipDownload:async accessToken=>{downloads++;assert.equal(accessToken,'fixture-new-access');return{broadcasterId:'42',title:'Fixture clip',durationSeconds:20,downloadUrl:'https://production.assets.clips.twitchcdn.net/fixture.mp4'};}
  };
  const req={headers:{'x-service-token':'fixture-internal'}},input={userId,clipId:'FixtureClip'};
  const results=await Promise.all([service.internalTwitchClipDownload(req,input),service.internalTwitchClipDownload(req,input)]);
  assert.equal(refreshes,1);assert.equal(downloads,2);assert.ok(results.every(result=>result.available));
  assert.deepEqual(JSON.parse(unseal(state.cipher,key,`twitch:${userId}`)),{accessToken:'fixture-new-access',refreshToken:'fixture-rotated-refresh'});
});

test('Redis rate-limit failure stops Twitch refresh before reading or rotating stored credentials',async()=>{
  const old={accessToken:'fixture-old-access',refreshToken:'fixture-one-use-refresh'},cipher=seal(JSON.stringify(old),fixtureKey,`twitch:${fixtureUserId}`);
  const service=Object.create(IdentityService.prototype);service.config={INTERNAL_TOKEN:'fixture-internal'};service.encryptionKey=fixtureKey;
  service.pool={query:async()=>({rows:[{token_cipher:cipher,login:'fixture',twitch_user_id:fixtureUserId}]})};
  service.redis={incrby:async()=>{throw new Error('fixture Redis unavailable');}};
  let providerCalls=0;service.twitch={configured:true,validate:async()=>{providerCalls++;},refresh:async()=>{providerCalls++;}};
  await assert.rejects(service.internalTwitchClipDownload({headers:{'x-service-token':'fixture-internal'}},{userId:fixtureUserId,clipId:'FixtureClip'}),/fixture Redis unavailable/);
  assert.equal(providerCalls,0);assert.deepEqual(JSON.parse(unseal(cipher,fixtureKey,`twitch:${fixtureUserId}`)),old);
});

test('busy or failed PostgreSQL refresh-lock acquisition releases the client safely',async()=>{
  const originalNow=Date.now;let reads=0;
  const {service,state}=refreshFixture({lock:'busy'});
  Date.now=()=>reads++<2?100000:110001;
  try {
    await assert.rejects(service.refreshTwitchLink(fixtureUserId,'fixture-old-access'),error=>error.getStatus?.()===503&&error.getResponse?.().code==='TWITCH_TOKEN_REFRESH_BUSY');
    assert.equal(state.updates,0);assert.equal(state.unlocks,0);assert.equal(state.releases.length,1);assert.equal(state.releases[0],undefined);
  } finally {Date.now=originalNow;}
  const failure=Object.assign(new Error('fixture lock connection failed'),{code:'ECONNRESET'}),broken=refreshFixture({lockError:failure});
  await assert.rejects(broken.service.refreshTwitchLink(fixtureUserId,'fixture-old-access'),error=>error===failure);
  assert.equal(broken.state.releases[0],failure,'discard a client whose lock acquisition outcome is unknown');
});

test('rotated Twitch tokens survive a transient database write failure and permanent failure leaves the old row intact',async()=>{
  const recovered=refreshFixture({writeFailures:1});
  const result=await recovered.service.refreshTwitchLink(fixtureUserId,'fixture-old-access');
  assert.equal(recovered.state.updates,2);assert.equal(recovered.state.lockHeld,false);assert.equal(recovered.state.unlocks,1);
  assert.deepEqual(JSON.parse(unseal(recovered.state.cipher,fixtureKey,`twitch:${fixtureUserId}`)),result.saved);
  assert.equal(result.saved.refreshToken,'fixture-rotated-refresh');assert.equal(recovered.state.releases[0],undefined);

  const failed=refreshFixture({writeFailures:3}),before=failed.state.cipher;
  await assert.rejects(failed.service.refreshTwitchLink(fixtureUserId,'fixture-old-access'),/fixture DB write failure/);
  assert.equal(failed.state.cipher,before,'failed writes must not partially replace the prior encrypted row');
  assert.equal(failed.state.updates,3);assert.equal(failed.state.lockHeld,false);assert.equal(failed.state.unlocks,1);
});

test('unlock failure discards the PostgreSQL session so its advisory lock cannot remain held',async()=>{
  const failure=new Error('fixture unlock failed'),{service,state}=refreshFixture({unlockError:failure});
  const result=await service.refreshTwitchLink(fixtureUserId,'fixture-old-access');
  assert.equal(result.saved.accessToken,'fixture-new-access');
  assert.equal(state.releases[0],failure);assert.equal(state.lockHeld,false,'discarding the session releases its session-level lock');
});

test('Twitch internal admission caps fixed-window rollover below the download route limit',async()=>{
  const userId='d19641bf-5b01-4afa-babd-135b25d1c6a4',key='a'.repeat(64),stored={accessToken:'fixture-access',refreshToken:'fixture-refresh'};
  const service=Object.create(IdentityService.prototype),buckets=new Map();let calls=0;
  service.config={INTERNAL_TOKEN:'fixture-internal'};service.encryptionKey=key;
  service.redis={incrby:async(bucket,amount)=>{const count=(buckets.get(bucket)??0)+amount;buckets.set(bucket,count);return count;},expire:async()=>1};
  service.pool={query:async()=>({rows:[{token_cipher:seal(JSON.stringify(stored),key,`twitch:${userId}`),login:'fixture',twitch_user_id:userId}]})};
  service.twitch={configured:true,validate:async()=>({userId,login:'fixture',clientId:'fixture-client',scopes:['channel:manage:clips'],expiresIn:3600}),clipDownload:async()=>{calls++;return{broadcasterId:'42',title:'Fixture clip',durationSeconds:20,downloadUrl:'https://production.assets.clips.twitchcdn.net/fixture.mp4'};}};
  const req={headers:{'x-service-token':'fixture-internal'}};
  const originalNow=Date.now;let now=Math.floor(originalNow()/60000)*60000+59000;Date.now=()=>now;
  try{
    for(let index=0;index<TWITCH_HELIX_REQUEST_BUDGET_PER_FIXED_MINUTE/TWITCH_CLIP_DOWNLOAD_HELIX_REQUEST_BUDGET;index++)assert.equal((await service.internalTwitchClipDownload(req,{userId,clipId:'FixtureClip'})).available,true);
    now+=1000;
    for(let index=0;index<TWITCH_HELIX_REQUEST_BUDGET_PER_FIXED_MINUTE/TWITCH_CLIP_DOWNLOAD_HELIX_REQUEST_BUDGET;index++)assert.equal((await service.internalTwitchClipDownload(req,{userId,clipId:'FixtureClip'})).available,true);
    const limited=await service.internalTwitchClipDownload(req,{userId,clipId:'FixtureClip'});
    assert.deepEqual(limited,{available:false,reasonCode:'TWITCH_RATE_LIMITED'});assert.equal(calls,(TWITCH_HELIX_REQUEST_BUDGET_PER_FIXED_MINUTE/TWITCH_CLIP_DOWNLOAD_HELIX_REQUEST_BUDGET)*2);
    // Across a fixed-window boundary the weighted maximum is 96 Helix calls.
    assert.ok(TWITCH_HELIX_REQUEST_BUDGET_PER_FIXED_MINUTE*2<100);
    assert.equal(TWITCH_VOD_CLIP_CREATE_HELIX_REQUEST_BUDGET,2);
  } finally {Date.now=originalNow;}
});

test('Helix clip lookup resolves a slug and requests its temporary download with the token owner as editor_id', async () => {
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));calls.push({url,init});
    if(url.pathname==='/helix/clips') return globalThis.Response.json({data:[{id:'ClipSlug',broadcaster_id:'broadcaster-42',title:'Moment',duration:37.5}]});
    if(url.pathname==='/helix/clips/downloads') return globalThis.Response.json({data:[{clip_id:'ClipSlug',landscape_download_url:'https://production.assets.clips.twitchcdn.net/signed/object?expires=soon',portrait_download_url:null}]});
    throw new Error(`unexpected Twitch endpoint: ${url.pathname}`);
  };
  try {
    const result=await new TwitchAdapter().clipDownload('fixture-access','editor-7','ClipSlug');
    assert.equal(result.broadcasterId,'broadcaster-42');
    assert.equal(result.title,'Moment');
    assert.equal(result.durationSeconds,37.5);
    assert.equal(new URL(result.downloadUrl).hostname,'production.assets.clips.twitchcdn.net');
    const params=calls[1].url.searchParams;
    assert.equal(params.get('broadcaster_id'),'broadcaster-42');
    assert.equal(params.get('editor_id'),'editor-7');
    assert.equal(params.get('clip_id'),'ClipSlug');
    assert.equal(calls[0].init.redirect,'error');
    assert.equal(calls[1].init.redirect,'error');
  } finally {globalThis.fetch=original;}
});

test('Helix VOD import creates only the bounded interval as the token owner and uses the VOD broadcaster from Twitch metadata',async t=>{
  const original=globalThis.fetch,originalEnv={clientId:process.env.TWITCH_CLIENT_ID,secret:process.env.TWITCH_CLIENT_SECRET,redirect:process.env.TWITCH_REDIRECT_URI};
  t.after(()=>{globalThis.fetch=original;for(const [key,value]of Object.entries({TWITCH_CLIENT_ID:originalEnv.clientId,TWITCH_CLIENT_SECRET:originalEnv.secret,TWITCH_REDIRECT_URI:originalEnv.redirect})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  process.env.TWITCH_CLIENT_ID='fixture-client';process.env.TWITCH_CLIENT_SECRET='fixture-secret';process.env.TWITCH_REDIRECT_URI='http://localhost:3000/v1/auth/twitch/callback';
  const calls=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));calls.push({url,init});
    if(url.pathname==='/helix/videos')return globalThis.Response.json({data:[{id:'2916449488',user_id:'424242',duration:'1h2m3s'}]});
    if(url.pathname==='/helix/videos/clips')return globalThis.Response.json({data:[{id:'CreatedClip_42'}]},{status:202});
    throw new Error(`unexpected Twitch endpoint: ${url.pathname}`);
  };
  const result=await new TwitchAdapter().createVodClip('fixture-access','editor-7','2916449488',125,30,'AutoClipper excerpt');
  assert.deepEqual(result,{clipId:'CreatedClip_42',broadcasterId:'424242',title:'AutoClipper excerpt',durationSeconds:30});
  assert.equal(calls.length,2);assert.equal(calls[0].init.method,undefined);assert.equal(calls[1].init.method,'POST');
  assert.equal(calls[1].url.searchParams.get('broadcaster_id'),'424242');assert.equal(calls[1].url.searchParams.get('editor_id'),'editor-7');assert.equal(calls[1].url.searchParams.get('vod_id'),'2916449488');assert.equal(calls[1].url.searchParams.get('vod_offset'),'125');assert.equal(calls[1].url.searchParams.get('duration'),'30');assert.equal(calls[1].url.searchParams.get('title'),'AutoClipper excerpt');
  assert.equal(calls[1].init.redirect,'error');
});

test('Helix VOD import accepts offsets after 24 hours when they fit the actual VOD',async t=>{
  const original=globalThis.fetch,originalEnv={clientId:process.env.TWITCH_CLIENT_ID,secret:process.env.TWITCH_CLIENT_SECRET,redirect:process.env.TWITCH_REDIRECT_URI};
  t.after(()=>{globalThis.fetch=original;for(const [key,value]of Object.entries({TWITCH_CLIENT_ID:originalEnv.clientId,TWITCH_CLIENT_SECRET:originalEnv.secret,TWITCH_REDIRECT_URI:originalEnv.redirect})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  process.env.TWITCH_CLIENT_ID='fixture-client';process.env.TWITCH_CLIENT_SECRET='fixture-secret';process.env.TWITCH_REDIRECT_URI='http://localhost:3000/v1/auth/twitch/callback';
  const calls=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));calls.push({url,init});
    if(url.pathname==='/helix/videos')return globalThis.Response.json({data:[{id:'2916449488',user_id:'424242',duration:'26h'}]});
    if(url.pathname==='/helix/videos/clips')return globalThis.Response.json({data:[{id:'CreatedClip_25h'}]},{status:202});
    throw new Error(`unexpected Twitch endpoint: ${url.pathname}`);
  };
  const result=await new TwitchAdapter().createVodClip('fixture-access','editor-7','2916449488',90_030,30,'Late VOD excerpt');
  assert.equal(result.clipId,'CreatedClip_25h');
  assert.equal(calls[1].url.searchParams.get('vod_offset'),'90030');
});

test('Twitch VOD creation validates duration and offset before side effects and refuses to retry an uncertain POST',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(input,init)=>{calls++;const url=new URL(String(input));if(url.pathname==='/helix/videos')return globalThis.Response.json({data:[{id:'2916449488',user_id:'424242',duration:'2m0s'}]});if(init?.method==='POST')throw new Error('fixture timeout after request may have been sent');throw new Error('unexpected endpoint');};
  try{
    const adapter=new TwitchAdapter();
    await assert.rejects(adapter.createVodClip('fixture-access','editor-7','2916449488',4,30,'Title'),error=>error.getResponse?.().code==='TWITCH_VOD_INTERVAL_INVALID');assert.equal(calls,0);
    await assert.rejects(adapter.createVodClip('fixture-access','editor-7','2916449488',150,30,'Title'),error=>error.getResponse?.().code==='TWITCH_VOD_OFFSET_OUT_OF_RANGE');assert.equal(calls,1);
    await assert.rejects(adapter.createVodClip('fixture-access','editor-7','2916449488',60,30,'Title'),error=>error.getResponse?.().code==='TWITCH_VOD_CLIP_CREATE_OUTCOME_UNKNOWN');assert.equal(calls,3,'the uncertain create POST was attempted exactly once');
  }finally{globalThis.fetch=original;}
});

test('Identity creates a Twitch VOD clip only with the linked OAuth owner and returns permission denial without tokens',async()=>{
  const userId=fixtureUserId,cipher=seal(JSON.stringify({accessToken:'fixture-access',refreshToken:'fixture-refresh'}),fixtureKey,`twitch:${userId}`),service=Object.create(IdentityService.prototype);
  service.config={INTERNAL_TOKEN:'fixture-internal'};service.encryptionKey=fixtureKey;
  service.pool={query:async()=>({rows:[{token_cipher:cipher,login:'fixture',twitch_user_id:'editor-7'}]})};service.redis={incrby:async(_key,amount)=>amount,expire:async()=>1};
  service.twitch={configured:true,validate:async token=>{assert.equal(token,'fixture-access');return{userId:'editor-7',login:'fixture',clientId:'fixture-client',scopes:['editor:manage:clips'],expiresIn:3600};},createVodClip:async(...args)=>{assert.deepEqual(args,['fixture-access','editor-7','2916449488',90_125,30,'AutoClipper excerpt']);return{clipId:'CreatedClip_42',broadcasterId:'broadcaster-42',title:'AutoClipper excerpt',durationSeconds:30};}};
  const req={headers:{'x-service-token':'fixture-internal'}},input={userId,vodId:'2916449488',vodOffsetSeconds:90_125,durationSeconds:30,title:'AutoClipper excerpt'};
  assert.deepEqual(await service.internalTwitchVodClipCreate(req,input),{state:'created',clipId:'CreatedClip_42',broadcasterId:'broadcaster-42',title:'AutoClipper excerpt',durationSeconds:30});
  service.twitch.createVodClip=async()=>{throw new ForbiddenException({code:'TWITCH_CHANNEL_EDITOR_REQUIRED'});};
  assert.deepEqual(await service.internalTwitchVodClipCreate(req,input),{state:'rejected',reasonCode:'TWITCH_CHANNEL_EDITOR_REQUIRED'});
  assert.equal(JSON.stringify(await service.internalTwitchVodClipCreate(req,input)).includes('fixture-access'),false);
});

test('Helix denial is preserved as an editor authorization result and non-CDN URLs are refused', async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async input=>new URL(String(input)).pathname==='/helix/clips'
      ? globalThis.Response.json({data:[{id:'ClipSlug',broadcaster_id:'broadcaster-42',title:'Moment',duration:20}]})
      : globalThis.Response.json({error:'Forbidden'}, {status:403});
    await assert.rejects(new TwitchAdapter().clipDownload('token','not-an-editor','ClipSlug'),error=>error.getStatus?.()===403);

    globalThis.fetch=async input=>new URL(String(input)).pathname==='/helix/clips'
      ? globalThis.Response.json({data:[{id:'ClipSlug',broadcaster_id:'broadcaster-42',title:'Moment',duration:20}]})
      : globalThis.Response.json({data:[{clip_id:'ClipSlug',landscape_download_url:'https://example.invalid/redirect'}]});
    await assert.rejects(new TwitchAdapter().clipDownload('token','editor-7','ClipSlug'),error=>error.getStatus?.()===503);
  } finally {globalThis.fetch=original;}
});

test('Twitch clip duration follows the official 60-second maximum before requesting media',async()=>{
  const original=globalThis.fetch;
  try {
    for(const durationSeconds of [0,60.01]){
      const paths=[];
      globalThis.fetch=async input=>{const url=new URL(String(input));paths.push(url.pathname);return globalThis.Response.json({data:[{id:'ClipSlug',broadcaster_id:'broadcaster-42',title:'Moment',duration:durationSeconds}]});};
      await assert.rejects(new TwitchAdapter().clipDownload('fixture-access','editor-7','ClipSlug'),error=>error.getStatus?.()===403&&error.getResponse?.().code==='TWITCH_CLIP_DURATION_UNSUPPORTED');
      assert.deepEqual(paths,['/helix/clips'],'reject duration before asking for a temporary media URL');
    }
    const paths=[];
    globalThis.fetch=async input=>{const url=new URL(String(input));paths.push(url.pathname);return url.pathname==='/helix/clips'
      ?globalThis.Response.json({data:[{id:'ClipSlug',broadcaster_id:'broadcaster-42',title:'Moment',duration:60}]})
      :globalThis.Response.json({data:[{clip_id:'ClipSlug',landscape_download_url:'https://production.assets.clips.twitchcdn.net/signed/object',portrait_download_url:null}]});};
    assert.equal((await new TwitchAdapter().clipDownload('fixture-access','editor-7','ClipSlug')).durationSeconds,60);
    assert.deepEqual(paths,['/helix/clips','/helix/clips/downloads']);
  } finally {globalThis.fetch=original;}
});
