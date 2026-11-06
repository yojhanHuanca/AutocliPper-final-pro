import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {cookieName,digest} from '@autoclipper/http-security';
import {ProxyController} from '../apps/autoclipper-api-gateway/dist/proxy.controller.js';
import {IdentityController} from '../apps/autoclipper-identity-service/dist/interfaces/identity.controller.js';
import {IdentityService} from '../apps/autoclipper-identity-service/dist/application/identity.service.js';

const ownerId='0c71c343-b530-49a9-959a-3915cdb96764';
const otherId='32e9f34a-d65c-4af6-8105-f246f5b98827';
const requestId='390d0e90-83c0-4cf6-8eaf-7b627625fef5';
const unknownId='5ca207c4-a383-4b74-9c15-7f777772e8fc';
const correlationId='fa9cfe11-9bf9-42c1-8d29-cae62f81f301';
const ownerToken='gateway-owner-fixture-token'.padEnd(43,'a');
const otherToken='gateway-other-fixture-token'.padEnd(43,'b');
const internalToken='fixture-only-gateway-service-token';

test('public contract exposes the authenticated deletion status and exact pending 404 contract',async()=>{
  const document=JSON.parse(await readFile(new URL('../apps/autoclipper-api-gateway/contracts/public.openapi.json',import.meta.url),'utf8'));
  const generated=await readFile(new URL('../packages/autoclipper-api-contracts/src/generated.ts',import.meta.url),'utf8');
  const operation=document.paths['/v1/auth/privacy-requests/{id}/status']?.get;
  assert.ok(operation);
  assert.deepEqual(operation.security,[{cookieSession:[]}]);
  assert.equal(operation.responses['200'].content['application/json'].schema.$ref,'#/components/schemas/PrivacyDeletionStatusDto');
  assert.equal(operation.responses['404'].content['application/json'].schema.$ref,'#/components/schemas/ErrorResponse');
  const response=document.components.schemas.PrivacyDeletionStatusDto;
  assert.deepEqual(response.required,['id','kind','requestState','fulfillment','purgeCompleted','deletionExecutor','createdAt']);
  assert.deepEqual(response.properties.fulfillment.enum,['pending']);
  assert.deepEqual(response.properties.purgeCompleted.enum,[false]);
  assert.deepEqual(response.properties.deletionExecutor.enum,['not_implemented']);
  assert.match(generated,/IdentityController_privacyDeletionStatus:/);
  assert.match(generated,/purgeCompleted: false;/);
  assert.match(generated,/deletionExecutor: "not_implemented";/);
});

test('API Gateway proxies owner status, preserves auth isolation and never exposes private upstream fields',async t=>{
  const envKeys=['IDENTITY_URL','INTERNAL_TOKEN'];
  const oldEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const key of envKeys){const value=oldEnv[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}});

  const tokenUsers=new Map([
    [digest(ownerToken),{id:ownerId,email:'owner@example.test',name:'Owner'}],
    [digest(otherToken),{id:otherId,email:'other@example.test',name:'Other'}],
  ]);
  const auditRows=[],sqlStatements=[],forwardedServiceTokens=[];
  const now=new Date('2026-10-29T12:00:00.000Z');
  const client={
    async query(sql,values=[]){
      sqlStatements.push(sql);
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
      if(sql.startsWith('SELECT id,state,created_at FROM privacy_requests')){
        assert.match(sql,/id=\$1 AND user_id=\$2 AND kind='deletion'/);
        const row=values[0]===requestId&&values[1]===ownerId?{id:requestId,state:'requested',created_at:now,internal_note:'must remain private',access_token:'private-fixture-secret'}:undefined;
        return{rows:row?[{id:row.id,state:row.state,created_at:row.created_at}]:[]};
      }
      if(sql.startsWith('INSERT INTO security_audit')){auditRows.push(values);return{rows:[]};}
      throw new Error(`Unexpected Identity query: ${sql}`);
    },
    release(){},
  };
  const identityService=Object.create(IdentityService.prototype);
  identityService.pool={
    async query(sql,values=[]){
      if(sql.includes('FROM access_tokens a')){const user=tokenUsers.get(values[0]);return{rows:user?[user]:[]};}
      throw new Error(`Unexpected Identity pool query: ${sql}`);
    },
    async connect(){return client;},
  };
  class IdentityBoundaryModule{}
  const identityRoute={privacyDeletionStatus:identityService.privacyDeletionStatus.bind(identityService)};
  Module({controllers:[IdentityController],providers:[{provide:IdentityService,useValue:identityRoute}]})(IdentityBoundaryModule);
  class GatewayBoundaryModule{}
  Module({controllers:[ProxyController]})(GatewayBoundaryModule);

  const identity=await NestFactory.create(IdentityBoundaryModule,{logger:false});
  identity.setGlobalPrefix('v1');
  identity.use((req,res,next)=>{res.locals.correlationId=req.headers['x-correlation-id']??correlationId;forwardedServiceTokens.push(req.headers['x-service-token']);next();});
  await identity.listen(0,'127.0.0.1');
  process.env.IDENTITY_URL=await identity.getUrl();
  process.env.INTERNAL_TOKEN=internalToken;
  t.after(async()=>identity.close());

  const gateway=await NestFactory.create(GatewayBoundaryModule,{logger:false});
  gateway.setGlobalPrefix('v1');
  gateway.use((_req,res,next)=>{res.locals.correlationId=correlationId;next();});
  await gateway.listen(0,'127.0.0.1');
  t.after(async()=>gateway.close());
  const base=await gateway.getUrl(),url=id=>`${base}/v1/auth/privacy-requests/${id}/status`;

  const anonymous=await fetch(url(requestId));
  const anonymousBody=await anonymous.json();
  assert.equal(anonymous.status,401);
  assert.equal(anonymousBody.message,'Request could not be completed');
  assert.equal(JSON.stringify(anonymousBody).includes(internalToken),false);

  const owner=await fetch(url(requestId),{headers:{cookie:`${cookieName('access')}=${ownerToken}`,'x-service-token':'browser-forged-token'} });
  const ownerBody=await owner.json();
  assert.equal(owner.status,200);
  assert.equal(owner.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(ownerBody,{id:requestId,kind:'deletion',requestState:'requested',fulfillment:'pending',purgeCompleted:false,deletionExecutor:'not_implemented',createdAt:now.toISOString()});
  assert.equal(JSON.stringify(ownerBody).includes('must remain private'),false);
  assert.equal(JSON.stringify(ownerBody).includes('private-fixture-secret'),false);
  assert.equal(JSON.stringify(ownerBody).includes(internalToken),false);

  const otherUser=await fetch(url(requestId),{headers:{cookie:`${cookieName('access')}=${otherToken}`} });
  const otherBody=await otherUser.json();
  const nonexistent=await fetch(url(unknownId),{headers:{cookie:`${cookieName('access')}=${ownerToken}`} });
  const nonexistentBody=await nonexistent.json();
  assert.equal(otherUser.status,404);
  assert.equal(nonexistent.status,404);
  assert.deepEqual(otherBody,nonexistentBody);
  assert.equal(otherBody.message,'Request could not be completed');
  assert.equal(otherUser.headers.get('cache-control'),'private, no-store');

  assert.equal(forwardedServiceTokens.length,4);
  assert.ok(forwardedServiceTokens.every(value=>value===internalToken));
  assert.equal(auditRows.length,1);
  assert.equal(auditRows[0][1],ownerId);
  assert.equal(auditRows[0][2],'privacy.deletion_status_viewed');
  assert.equal(sqlStatements.some(sql=>/\b(DELETE|UPDATE)\b.*privacy_requests/iu.test(sql)),false);
});
