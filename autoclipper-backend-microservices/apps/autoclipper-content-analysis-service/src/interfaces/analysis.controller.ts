import {Controller,Post,Get,Body,Req,Res,Inject,HttpCode,ServiceUnavailableException} from "@nestjs/common";
import type {Request,Response} from "express";
import {ApiExcludeEndpoint,ApiBody,ApiOkResponse,ApiTags} from "@nestjs/swagger";
import {z} from "zod";
import {requireInternal,body,same,internalJson} from "@autoclipper/http-security";
import {analysisSpec,privacyOwnerRequest,privacyAnalysisAuthority,LOCAL_TRANSCRIPTION_MAX_SECONDS} from "@autoclipper/api-contracts";
import {registry} from "@autoclipper/observability";
import {AnalysisRuntime} from "../application/analysis-runtime.js";
import {prepareAnalysisExport} from '../application/privacy-exports.js';
@ApiTags("content-analysis")
@Controller()
export class AnalysisController {
  constructor(@Inject(AnalysisRuntime)readonly runtime:AnalysisRuntime){}
  @Get("health/live") live(){return{status:"ok"};}
  @Get("health/ready") async ready(){if(!await this.runtime.readiness())throw new ServiceUnavailableException();return{status:"ok"};}
  @Get("metrics")@ApiExcludeEndpoint()async metrics(@Req()req:Request,@Res()res:Response){const token=String(req.headers.authorization??"");if(!same(token,`Bearer ${this.runtime.config.INTERNAL_TOKEN}`))requireInternal(req,this.runtime.config);res.type(registry.contentType).send(await registry.metrics());}
  @Post("internal/analysis-providers")@HttpCode(200)@ApiExcludeEndpoint() providers(@Req()req:Request){requireInternal(req,this.runtime.config);return this.runtime.capabilities();}
  @Post('internal/privacy-analysis-export')@HttpCode(200)@ApiExcludeEndpoint()async privacyAnalysisExport(@Req()req:Request,@Body()input:unknown){
    requireInternal(req,this.runtime.config);const data=body(privacyOwnerRequest,input);
    const authority=body(privacyAnalysisAuthority,await internalJson(this.runtime.config.IDENTITY_URL,'/v1/internal/privacy-analysis-export-authorize',this.runtime.config,{...data,scope:'analysis-attribution-v1'}));
    return prepareAnalysisExport(this.runtime.pool,authority.userId,authority.requestId,data.idempotencyKey,data.correlationId);
  }
  @Post("internal/analysis-preflight")@HttpCode(200)@ApiExcludeEndpoint() preflight(@Req()req:Request,@Body()input:unknown){requireInternal(req,this.runtime.config);const data=body(z.object({spec:analysisSpec,durationSeconds:z.number().finite().positive().max(LOCAL_TRANSCRIPTION_MAX_SECONDS)}).strict(),input);return this.runtime.preflight(data.spec,data.durationSeconds);}
  @Post("internal/analyses")@HttpCode(200)@ApiExcludeEndpoint()@ApiBody({schema:{type:"object"}}) submit(@Req()req:Request,@Body()input:unknown){requireInternal(req,this.runtime.config);const data=body(z.object({id:z.uuid(),workspaceId:z.uuid(),creatorId:z.uuid(),correlationId:z.uuid(),source:z.unknown(),spec:z.unknown(),cancelRequested:z.boolean().default(false)}).strict(),input);return this.runtime.submit({...data,source:data.source,spec:data.spec});}
  @Post("internal/analysis-status")@HttpCode(200)@ApiExcludeEndpoint()@ApiOkResponse({schema:{type:"object"}}) status(@Req()req:Request,@Body()input:unknown){requireInternal(req,this.runtime.config);const data=body(z.object({id:z.uuid(),workspaceId:z.uuid()}).strict(),input);return this.runtime.status(data.id,data.workspaceId);}
  @Post("internal/analysis-cancel")@HttpCode(200)@ApiExcludeEndpoint() cancel(@Req()req:Request,@Body()input:unknown){requireInternal(req,this.runtime.config);const data=body(z.object({id:z.uuid(),workspaceId:z.uuid()}).strict(),input);return this.runtime.cancel(data.id,data.workspaceId);}
}
