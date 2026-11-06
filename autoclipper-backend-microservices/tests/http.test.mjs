import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { loadGatewayConfig } from '@autoclipper/configuration';
import { ApplicationLogger,configureHttp,createSafeLogger,SafeExceptionFilter } from '@autoclipper/observability';
import { AppModule } from '../apps/autoclipper-api-gateway/dist/app.module.js';

test('gateway contract, CORS, correlation and safe errors', async () => {
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  const document = configureHttp(app, loadGatewayConfig({ ENABLE_DOCS: 'true' }), 'api-gateway');
  await app.listen(0, '127.0.0.1');
  try {
    const base = await app.getUrl();
    const live = await fetch(`${base}/v1/health/live`, { headers: { origin: 'http://localhost:4200', 'x-correlation-id': 'untrusted-value' } });
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });
    assert.equal(live.headers.get('access-control-allow-origin'), 'http://localhost:4200');
    assert.notEqual(live.headers.get('x-correlation-id'), 'untrusted-value');
    const missing = await fetch(`${base}/v1/secrets?password=do-not-log`);
    const error = await missing.json();
    assert.equal(missing.status, 404);
    assert.equal(error.code, 'RESOURCE_NOT_FOUND');
    assert.equal(error.correlationId, missing.headers.get('x-correlation-id'));
    assert.equal(JSON.stringify(error).includes('do-not-log'), false);
    assert.ok(document.paths['/v1/health/live']);
    assert.equal((await fetch(`${base}/openapi.json`)).status, 200);
  } finally { await app.close(); }
});

test('structured logs redact provider keys, Twitch OAuth tokens, cookies and signed URLs',async()=>{
  const markers=['fixture-openai-api-key','fixture-gemini-api-key','fixture-twitch-client-secret','fixture-twitch-access-token','fixture-twitch-refresh-token','fixture-cookie-value','fixture-service-token','fixture-csrf-token','fixture-google-api-key','fixture-signed-url-signature','fixture-oauth-state','fixture-deep-nested-api-key','fixture-error-details'];
  const signedUrl=`https://cdn.example.test/clip.mp4?signature=${markers[9]}&token=${markers[4]}`;
  const lines=[],safeLogger=createSafeLogger({write:line=>lines.push(line)});
  safeLogger.error({code:'LOG_REDACTION_TEST',errorCode:'SAFE_ERROR_CODE',error:{message:markers[12]},OPENAI_API_KEY:markers[0],provider:{geminiApiKey:markers[1]},twitch:{clientSecret:markers[2],accessToken:markers[3],refreshToken:markers[4]},request:{url:signedUrl,headers:{cookie:markers[5],authorization:`Bearer ${markers[3]}`,'x-service-token':markers[6],'x-csrf-token':markers[7],'x-goog-api-key':markers[8]}},metadata:{provider:{request:{OPENAI_API_KEY:markers[11]}}},downloadUrl:signedUrl,authorizationUrl:`https://id.twitch.tv/oauth2/authorize?state=${markers[10]}`});
  await new Promise(resolve=>safeLogger.flush(resolve));
  const output=lines.join('');for(const marker of markers)assert.equal(output.includes(marker),false,`log leaked ${marker}`);assert.match(output,/\[REDACTED\]/u);assert.match(output,/SAFE_ERROR_CODE/u);

  const frameworkEvents=[],frameworkLogger=new ApplicationLogger({info:value=>frameworkEvents.push(value),error:value=>frameworkEvents.push(value),warn:value=>frameworkEvents.push(value),debug:value=>frameworkEvents.push(value)});
  frameworkLogger.log(signedUrl);frameworkLogger.warn(markers.join(' '));frameworkLogger.debug(signedUrl);frameworkLogger.verbose(signedUrl);frameworkLogger.error(markers.join(' '));
  assert.deepEqual(frameworkEvents,[{code:'FRAMEWORK_ERROR'}]);assert.equal(JSON.stringify(frameworkEvents).includes(markers.join(' ')),false);
});

test('HTTP error responses omit raw exception details that contain credentials or signed URLs',()=>{
  const markers=['fixture-openai-api-key','fixture-gemini-api-key','fixture-twitch-access-token','fixture-cookie-value','fixture-signed-url-signature'];
  const signedUrl=`https://cdn.example.test/clip.mp4?signature=${markers[4]}`;
  const response={locals:{correlationId:'redaction-test'},statusCode:0,body:undefined,status(value){this.statusCode=value;return this;},json(value){this.body=value;}};
  const host={switchToHttp:()=>({getResponse:()=>response})};
  new SafeExceptionFilter().catch(new HttpException({code:'INTERNAL_ERROR',message:markers.join(' '),apiKey:markers[0],cookie:markers[3],url:signedUrl},400),host);
  const output=JSON.stringify(response.body);for(const marker of markers)assert.equal(output.includes(marker),false);assert.equal(output.includes(signedUrl),false);
});

test('local selection preflight keeps its safe mismatch code through the HTTP error filter',()=>{
  const response={locals:{correlationId:'local-preflight-test'},statusCode:0,body:undefined,status(code){this.statusCode=code;return this;},json(value){this.body=value;}};
  const host={switchToHttp:()=>({getResponse:()=>response})};
  new SafeExceptionFilter().catch(new ServiceUnavailableException({code:'SELECTION_MODEL_MISMATCH'}),host);
  assert.equal(response.statusCode,503);
  assert.equal(response.body.code,'SELECTION_MODEL_MISMATCH');
  assert.equal(response.body.correlationId,'local-preflight-test');
});

test('automatic selection errors expose safe OpenAI, Gemini and budget actions instead of generic dependency failures',()=>{
  const cases=[
    ['OPENAI_API_KEY_MISSING','configure_openai','OPENAI_API_KEY',503],
    ['GEMINI_API_KEY_MISSING','configure_gemini','GEMINI_API_KEY',503],
    ['SELECTION_MODEL_NOT_SUPPORTED','review_ai_provider','modelo de selección',503],
    ['OPENAI_INVOCATION_LIMIT_REACHED','review_ai_budget','límite de solicitudes OpenAI',429],
    ['AI_BUDGET_NOT_AUTHORIZED','review_ai_budget','límite aprobado',503],
  ];
  for(const [code,nextAction,messagePart,status] of cases){
    const response={locals:{correlationId:'ai-preflight-test'},statusCode:0,body:undefined,status(value){this.statusCode=value;return this;},json(value){this.body=value;}};
    const host={switchToHttp:()=>({getResponse:()=>response})};
    new SafeExceptionFilter().catch(new HttpException({code},status),host);
    assert.equal(response.statusCode,status);assert.equal(response.body.code,code);assert.equal(response.body.nextAction,nextAction);assert.match(response.body.message,new RegExp(messagePart,'iu'));assert.equal(response.body.correlationId,'ai-preflight-test');
  }
});

test('source-link HTTP errors preserve safe provider codes and tell the caller how to proceed',()=>{
  const cases=[
    [422,'YOUTUBE_DOWNLOAD_APPROVAL_REQUIRED','upload_authorized_file'],
    [422,'KICK_MEDIA_API_UNAVAILABLE','upload_authorized_file'],
    [503,'TWITCH_OAUTH_NOT_CONFIGURED','configure_twitch_oauth'],
    [409,'TWITCH_ACCOUNT_NOT_LINKED','link_twitch_account'],
    [403,'TWITCH_CHANNEL_EDITOR_REQUIRED','connect_broadcaster_or_editor_account'],
    [429,'TWITCH_RATE_LIMITED','retry_after_rate_limit'],
  ];
  for(const [status,code,nextAction] of cases){
    const response={locals:{correlationId:'source-link-test'},statusCode:0,body:undefined,status(value){this.statusCode=value;return this;},json(value){this.body=value;}};
    const host={switchToHttp:()=>({getResponse:()=>response})};
    new SafeExceptionFilter().catch(new HttpException({code},status),host);
    assert.equal(response.statusCode,status);
    assert.equal(response.body.code,code);
    assert.equal(response.body.nextAction,nextAction);
    assert.ok(response.body.message.length>20);
    assert.equal(response.body.correlationId,'source-link-test');
  }
});

test('sharing, YouTube download and free-AI setup failures remain actionable without exposing provider details',()=>{
 for(const [code,status,action] of [['SOCIAL_OAUTH_NOT_CONFIGURED',503,'configure_social_oauth'],['SOCIAL_RECONNECT_REQUIRED',409,'link_social_account'],['LOCAL_AI_NOT_READY',503,'start_local_ai'],['YOUTUBE_VIDEO_UNAVAILABLE',503,'check_source_access']]){
  const response={locals:{correlationId:'workflow-test'},status(value){this.statusCode=value;return this;},json(value){this.body=value;}};
  const host={switchToHttp:()=>({getResponse:()=>response})};
  new SafeExceptionFilter().catch(new HttpException({code,message:'private-provider-reply',accessToken:'do-not-expose'},status),host);
  assert.equal(response.body.code,code);assert.equal(response.body.nextAction,action);
  assert.equal(JSON.stringify(response.body).includes('do-not-expose'),false);
  assert.equal(JSON.stringify(response.body).includes('private-provider-reply'),false);
 }
});
