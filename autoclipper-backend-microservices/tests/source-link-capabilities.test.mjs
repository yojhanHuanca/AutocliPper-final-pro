import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IdentityService } from '../apps/autoclipper-identity-service/dist/application/identity.service.js';
import { ProjectService } from '../apps/autoclipper-project-service/dist/application/project.service.js';
import { buildSourceLinkCapabilities, resolveSourceLink, sourceLinkGuidance } from '../apps/autoclipper-project-service/dist/application/source-link.js';

const userId='d19641bf-5b01-4afa-babd-135b25d1c6a4';
const projectId='b5d04a58-8e40-4715-a804-8a332ec7c02b';

test('provider capability contract distinguishes preview-only providers and Twitch setup states',()=>{
  const unsupported=buildSourceLinkCapabilities(projectId,{configured:false,linked:false,clipScopeReady:false});
  assert.deepEqual(unsupported.providers.map(provider=>provider.provider),['youtube','kick','twitch']);
  assert.deepEqual(unsupported.providers[0],{provider:'youtube',configurationState:'not_required',previewAvailable:true,previewKinds:['youtube_video'],importAvailable:true,importReasonCode:null,requiresClipPermissionCheck:false,processingAvailable:false,processingReasonCode:'SOURCE_BYTES_UNAVAILABLE'});
  assert.equal(unsupported.providers[1].previewKinds[0],'kick_live_channel');
  assert.equal(unsupported.providers[1].importReasonCode,'KICK_MEDIA_API_UNAVAILABLE');
  const kickGuidance=sourceLinkGuidance('KICK_MEDIA_API_UNAVAILABLE');
  assert.equal(kickGuidance.nextAction,'upload_authorized_file');
  assert.match(kickGuidance.message,/Términos.*sistemas automatizados/u);
  assert.match(kickGuidance.nextStep,/autorización programática/u);
  assert.equal(unsupported.providers[2].configurationState,'oauth_not_configured');
  assert.equal(unsupported.providers[2].importReasonCode,'TWITCH_OAUTH_NOT_CONFIGURED');
  assert.equal(unsupported.providers[2].processingAvailable,false);

  const notLinked=buildSourceLinkCapabilities(projectId,{configured:true,linked:false,clipScopeReady:false}).providers[2];
  assert.equal(notLinked.configurationState,'account_not_linked');
  assert.equal(notLinked.importReasonCode,'TWITCH_ACCOUNT_NOT_LINKED');
  const missingScope=buildSourceLinkCapabilities(projectId,{configured:true,linked:true,clipScopeReady:false}).providers[2];
  assert.equal(missingScope.configurationState,'clip_scope_missing');
  assert.equal(missingScope.importReasonCode,'TWITCH_CLIP_SCOPE_REQUIRED');
  const ready=buildSourceLinkCapabilities(projectId,{configured:true,linked:true,clipScopeReady:true}).providers[2];
  assert.equal(ready.configurationState,'ready');
  assert.equal(ready.importAvailable,true);
  assert.equal(ready.importReasonCode,null);
  assert.equal(ready.requiresClipPermissionCheck,true,'URL-specific broadcaster/editor permission is still checked during resolve');
  assert.equal(ready.processingReasonCode,'UPLOAD_CONFIRMATION_AND_INSPECTION_REQUIRED');
});

test('Project capability route checks project reader access and sends only user ID to Identity',async()=>{
  const service=Object.create(ProjectService.prototype);
  service.config={IDENTITY_URL:'http://identity.fixture',INTERNAL_TOKEN:'fixture-internal'};
  service.project=async(_req,id,minimum)=>{assert.equal(id,projectId);assert.equal(minimum,'reader');return{user:{id:userId}};};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    assert.equal(String(input),'http://identity.fixture/v1/internal/twitch/source-capabilities');
    assert.equal(init.method,'POST');
    assert.equal(init.headers['x-service-token'],'fixture-internal');
    assert.deepEqual(JSON.parse(init.body),{userId});
    return new globalThis.Response(JSON.stringify({configured:true,linked:true,clipScopeReady:true}),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const result=await service.sourceLinkCapabilities({},projectId);
    assert.equal(result.projectId,projectId);
    assert.equal(result.providers.find(provider=>provider.provider==='twitch').importAvailable,true);
    assert.doesNotMatch(JSON.stringify(result),/token|secret|accessToken|refreshToken|login/iu);
  } finally {globalThis.fetch=originalFetch;}
});

test('Identity capability response reports configured, linked and scope booleans without reading token material',async()=>{
  const service=Object.create(IdentityService.prototype);
  service.config={INTERNAL_TOKEN:'fixture-internal'};
  service.twitch={configured:true};
  const queries=[];
  service.pool={query:async(sql,values)=>{queries.push({sql,values});return{rows:[{scope:['editor:manage:clips']}]};}};
  const req={headers:{'x-service-token':'fixture-internal'}};
  assert.deepEqual(await service.internalTwitchSourceCapabilities(req,{userId}),{configured:true,linked:true,clipScopeReady:true});
  assert.equal(queries.length,1);
  assert.equal(queries[0].sql,'SELECT scope FROM twitch_links WHERE user_id=$1');
  assert.deepEqual(queries[0].values,[userId]);
  service.twitch={configured:false};
  queries.length=0;
  assert.deepEqual(await service.internalTwitchSourceCapabilities(req,{userId}),{configured:false,linked:false,clipScopeReady:false});
  assert.equal(queries.length,0,'missing app configuration does not query or disclose linked accounts');
});

test('source resolver rejects SSRF and invalid URL forms before any network-capable path',()=>{
  for(const url of [
    'https://127.0.0.1/abcdefghijk',
    'https://[::1]/abcdefghijk',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/abcdefghijk',
    'https://youtube.com.evil.example/watch?v=abcdefghijk',
    'https://clips.twitch.tv/Clip?next=https://127.0.0.1',
  ]) assert.throws(()=>resolveSourceLink(url));
});

test('public OpenAPI and generated SDK expose the same typed capabilities route',async()=>{
  const openapi=JSON.parse(await readFile(new URL('../apps/autoclipper-api-gateway/contracts/public.openapi.json',import.meta.url),'utf8'));
  const operation=openapi.paths['/v1/projects/{id}/source-links/capabilities']?.get;
  assert.ok(operation);
  assert.equal(operation.responses['200'].content['application/json'].schema.$ref,'#/components/schemas/SourceLinkCapabilitiesDto');
  const schema=openapi.components.schemas.SourceLinkCapabilitiesDto;
  assert.deepEqual(schema.required,['projectId','providers']);
  assert.equal(schema.properties.providers.maxItems,3);
  const sdk=await readFile(new URL('../packages/autoclipper-api-contracts/src/generated.ts',import.meta.url),'utf8');
  assert.match(sdk,/"\/v1\/projects\/\{id\}\/source-links\/capabilities"/u);
  assert.match(sdk,/SourceLinkCapabilitiesDto/u);

  const sourceImport=openapi.components.schemas.SourceLinkDto;
  assert.deepEqual(sourceImport.required,['url']);
  assert.equal(sourceImport.properties.vodOffsetSeconds.minimum,5);
  assert.equal(sourceImport.properties.vodOffsetSeconds.maximum,Number.MAX_SAFE_INTEGER);
  assert.equal(sourceImport.properties.durationSeconds.minimum,5);
  assert.equal(sourceImport.properties.durationSeconds.maximum,60);
  const sdkSourceImport=sdk.slice(sdk.indexOf('SourceLinkDto: {'),sdk.indexOf('UploadDto: {'));
  assert.match(sdkSourceImport,/vodOffsetSeconds\?: number;/u);
  assert.match(sdkSourceImport,/durationSeconds\?: number;/u);
});
