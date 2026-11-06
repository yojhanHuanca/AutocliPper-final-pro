import {Body,Controller,Delete,Get,Inject,Param,Post,Req,Res,HttpCode} from "@nestjs/common";
import type {Request,Response} from "express";
import {ApiBody,ApiCreatedResponse,ApiHeader,ApiOkResponse,ApiTags,ApiExtraModels,ApiForbiddenResponse,getSchemaPath} from "@nestjs/swagger";
import {AnalysisSpecDto,AnalysisStatusDto,ManualTranscriptRenderDto,ProposalTranscriptRenderDto,NoSelectionDto,LocalSelectionDto,LlmSelectionDto,ErrorResponse} from "@autoclipper/api-contracts";
import {uuid} from "@autoclipper/http-security";
import {ProjectService} from "../application/project.service.js";
const providerDiagnosticSchema = {
  type: "object",
  required: ["configured", "status", "code", "missingSettings", "nextSteps"],
  properties: {
    configured: { type: "boolean" },
    status: { type: "string" },
    code: { type: "string", nullable: true },
    missingSettings: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    model: { type: "string" },
    budgetUsd: { type: "number" },
    maxEstimatedCostUsd: { type: "number" },
    maxInputBytes: { type: "integer" },
    maxOutputTokens: { type: "integer" },
  },
};
const analysisProvidersSchema = {
  type: "object",
  required: ["transcription", "selection", "automaticPipeline", "paidExecutionEnabled"],
  properties: {
    transcription: {
      type: "object",
      required: ["whisper_cpp", "deepgram"],
      additionalProperties: false,
      properties: {
        whisper_cpp: {
          type: "object",
          required: ["configured", "maxSeconds", "diarization", "diagnostic"],
          properties: {
            configured: { type: "boolean" }, maxSeconds: { type: "integer" }, diarization: { type: "boolean" }, diagnostic: providerDiagnosticSchema,
          },
        },
        deepgram: {
          type: "object",
          required: ["configured", "maxSeconds", "diarization"],
          properties: { configured: { type: "boolean" }, maxSeconds: { type: "integer" }, diarization: { type: "boolean" } },
        },
      },
    },
    selection: {
      type: "object",
      required: ["provider", "local", "ollama", "openai", "gemini"],
      properties: {
        provider: { type: "string", enum: ["openai", "gemini", "ollama", "local_ai", "groq"] },
        local_ai: { type: "object", properties: { configured: { type: "boolean" }, model: { type: "string" } } },
        local: { type: "object", required: ["configured", "status", "algorithm", "externalCostUsd"], properties: { configured: { type: "boolean" }, status: { type: "string", enum: ["ready"] }, algorithm: { type: "string" }, externalCostUsd: { type: "number", enum: [0] } } },
        readiness: {
          type: "object",
          required: ["status", "blockers"],
          properties: {
            status: { type: "string", enum: ["disabled", "missing_credentials", "ready", "unsupported"] },
            blockers: { type: "array", items: { type: "string" } },
          },
        },
        ollama: {
          type: "object",
          required: ["configured", "diagnostic"],
          properties: { configured: { type: "boolean" }, diagnostic: providerDiagnosticSchema },
        },
        openai: {
          type: "object",
          required: ["configured", "diagnostic"],
          properties: { configured: { type: "boolean" }, diagnostic: providerDiagnosticSchema },
        },
        gemini: {
          type: "object",
          required: ["configured", "diagnostic"],
          properties: { configured: { type: "boolean" }, diagnostic: providerDiagnosticSchema },
        },
      },
    },
    automaticPipeline: {
      type: "object",
      required: ["ready", "selectionMode", "blockers"],
      properties: { ready: { type: "boolean" }, selectionMode: { type: "string", enum: ["local"] }, blockers: { type: "array", items: { type: "string" } } },
    },
    paidExecutionEnabled: { type: "boolean" },
  },
};
@ApiTags("analysis")
@ApiExtraModels(ManualTranscriptRenderDto,ProposalTranscriptRenderDto,NoSelectionDto,LocalSelectionDto,LlmSelectionDto)
@Controller()
export class AnalysisController {
  constructor(@Inject(ProjectService)readonly service:ProjectService){}
  @Get("analyses/providers") @ApiOkResponse({schema:analysisProvidersSchema}) providers(@Req()req:Request){return this.service.analyses.providers(req);}
  @Post("processing/:id/analyses")@ApiBody({type:AnalysisSpecDto})@ApiHeader({name:"Idempotency-Key",required:true})
  @ApiForbiddenResponse({type:ErrorResponse,description:"Manual analysis is blocked with MANUAL_PROCESSING_NOT_ADMITTED when server PROCESSING_ADMISSION_MODE=commercial, for all providers and selection variants. Use an admitted pipeline."})
  @ApiCreatedResponse({schema:{type:"object",required:["id","status"],properties:{id:{type:"string",format:"uuid"},status:{type:"string"}}}})
  begin(@Req()req:Request,@Param("id")id:string,@Body()input:AnalysisSpecDto,@Res({passthrough:true})res:Response){return this.service.analyses.begin(req,uuid(id),input,String(res.locals["correlationId"]));}
  @Get("analyses/:id")@ApiOkResponse({type:AnalysisStatusDto}) status(@Req()req:Request,@Param("id")id:string){return this.service.analyses.status(req,uuid(id));}
  @Delete("analyses/:id")@HttpCode(200) cancel(@Req()req:Request,@Param("id")id:string){return this.service.analyses.cancel(req,uuid(id));}
  @Post("analyses/:id/renders")@ApiHeader({name:"Idempotency-Key",required:true})@ApiBody({schema:{oneOf:[{$ref:getSchemaPath(ManualTranscriptRenderDto)},{$ref:getSchemaPath(ProposalTranscriptRenderDto)}]}})
  @ApiForbiddenResponse({type:ErrorResponse,description:"Manual and proposal-based renders are blocked with MANUAL_PROCESSING_NOT_ADMITTED when server PROCESSING_ADMISSION_MODE=commercial. Existing analyses remain readable."})
  @ApiCreatedResponse({schema:{type:"object",required:["id","status"],properties:{id:{type:"string",format:"uuid"},status:{type:"string"}}}})
  render(@Req()req:Request,@Param("id")id:string,@Body()input:unknown,@Res({passthrough:true})res:Response){return this.service.analyses.render(req,uuid(id),input,String(res.locals["correlationId"]));}
}
