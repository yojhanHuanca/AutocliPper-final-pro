import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { loadGatewayConfig } from '@autoclipper/configuration';
import { configureHttp } from '@autoclipper/observability';
import { AppModule as GatewayModule } from '../apps/autoclipper-api-gateway/dist/app.module.js';
import { InspectionRuntime } from '../apps/autoclipper-media-processing-service/dist/application/inspection-runtime.js';
import { Module } from '@nestjs/common';
import { OperationsController } from '../apps/autoclipper-media-processing-service/dist/interfaces/operations.controller.js';
import {IdentityController} from '../apps/autoclipper-identity-service/dist/interfaces/identity.controller.js';
import {IdentityService} from '../apps/autoclipper-identity-service/dist/application/identity.service.js';
import {WorkspaceController} from '../apps/autoclipper-workspace-service/dist/interfaces/workspace.controller.js';
import {WorkspaceService} from '../apps/autoclipper-workspace-service/dist/application/workspace.service.js';
import {ProjectController} from '../apps/autoclipper-project-service/dist/interfaces/project.controller.js';
import {ProjectService} from '../apps/autoclipper-project-service/dist/application/project.service.js';

import {ProcessingRuntime} from '../apps/autoclipper-media-processing-service/dist/application/processing-runtime.js';
import {DerivativesController} from '../apps/autoclipper-project-service/dist/interfaces/derivatives.controller.js';

import {AnalysisController} from '../apps/autoclipper-project-service/dist/interfaces/analysis.controller.js';
import {AnalysisController as InternalAnalysisController} from '../apps/autoclipper-content-analysis-service/dist/interfaces/analysis.controller.js';
import {AnalysisRuntime} from '../apps/autoclipper-content-analysis-service/dist/application/analysis-runtime.js';
// Contract generation must not instantiate database/queue clients or start workers.
class MediaContractModule {}
Module({ controllers: [OperationsController], providers: [{ provide: InspectionRuntime, useValue: {} },{provide:ProcessingRuntime,useValue:{}}] })(MediaContractModule);
const directory = new URL('../../autoclipper-project-documentation/contracts/', import.meta.url);
await mkdir(directory, { recursive: true });
const documents={};
const contractModule=(controller,service)=>{class ContractModule{}Module({controllers:Array.isArray(controller)?controller:[controller],providers:[{provide:service,useValue:{}}]})(ContractModule);return ContractModule;};
for (const [name, module] of [['gateway', GatewayModule], ['media', MediaContractModule],['identity',contractModule(IdentityController,IdentityService)],['workspace',contractModule(WorkspaceController,WorkspaceService)],['project',contractModule([ProjectController,DerivativesController,AnalysisController],ProjectService)],['analysis',contractModule(InternalAnalysisController,AnalysisRuntime)]]) {
  const app = await NestFactory.create(module, { logger: false });
  try {
    const document = configureHttp(app, loadGatewayConfig(), name === 'gateway' ? 'api-gateway' : name==='media'?'media-processing-service':`${name}-service`);
    document.info.version='0.2.0';documents[name]=document;
  } finally { await app.close(); }
}
const publicDocument=documents.gateway;
for(const name of ['identity','workspace','project']){const document=documents[name];for(const [path,operation]of Object.entries(document.paths)){if(!path.includes('/health/')&&!path.includes('/internal/'))publicDocument.paths[path]=operation;}publicDocument.components.schemas={...publicDocument.components.schemas,...document.components.schemas};}
publicDocument.components.securitySchemes={...publicDocument.components.securitySchemes,cookieSession:{type:'apiKey',in:'cookie',name:'autoclipper_access'},refreshSession:{type:'apiKey',in:'cookie',name:'autoclipper_refresh'}};
publicDocument.components.schemas.ErrorResponse={type:'object',required:['code','message','correlationId'],properties:{code:{type:'string'},message:{type:'string'},correlationId:{type:'string',format:'uuid'}}};
for(const [path,item]of Object.entries(publicDocument.paths))for(const [method,operation]of Object.entries(item)){if(!['get','post','patch','delete'].includes(method)||path.includes('/health/'))continue;for(const status of ['400','401','403','409','429','503'])operation.responses[status]??={description:'Classified error with a safe correlation identifier',content:{'application/json':{schema:{$ref:'#/components/schemas/ErrorResponse'}}}};if(['post','patch','delete'].includes(method)){operation.parameters??=[];operation.parameters.push({in:'header',name:'X-CSRF-Token',required:true,schema:{type:'string'},description:'Signed double-submit token from GET /v1/auth/csrf. Origin must equal the configured Angular origin.'});}const publicAuth=['/v1/auth/providers','/v1/auth/google/challenge','/v1/auth/google','/v1/auth/csrf','/v1/auth/register','/v1/auth/verify','/v1/auth/login','/v1/auth/password/forgot','/v1/auth/password/reset','/v1/auth/logout'];operation.security=publicAuth.includes(path)?[]:path==='/v1/auth/refresh'?[{refreshSession:[]}]:[{cookieSession:[]}];}
for(const [name,document]of Object.entries(documents))await writeFile(new URL(`${name}.openapi.json`,directory),JSON.stringify(document,null,2)+'\n');
const runtimeDirectory=new URL('../apps/autoclipper-api-gateway/contracts/',import.meta.url);await mkdir(runtimeDirectory,{recursive:true});await writeFile(new URL('public.openapi.json',runtimeDirectory),JSON.stringify(publicDocument,null,2)+'\n');
console.log('Gateway and service OpenAPI contracts exported from implemented controllers, without starting dependencies.');
