import {Body,Controller,Delete,Get,Inject,Param,Post,Req,Res,HttpCode} from "@nestjs/common";
import type {Request,Response} from "express";
import {ApiBody,ApiCreatedResponse,ApiHeader,ApiOkResponse,ApiTags,ApiExtraModels,ApiForbiddenResponse,getSchemaPath} from "@nestjs/swagger";
import {AnalysisSpecDto,AnalysisStatusDto,ManualTranscriptRenderDto,ProposalTranscriptRenderDto,NoSelectionDto,LlmSelectionDto,ErrorResponse} from "@autoclipper/api-contracts";
import {uuid} from "@autoclipper/http-security";
import {ProjectService} from "../application/project.service.js";
@ApiTags("analysis")
@ApiExtraModels(ManualTranscriptRenderDto,ProposalTranscriptRenderDto,NoSelectionDto,LlmSelectionDto)
@Controller()
export class AnalysisController {
  constructor(@Inject(ProjectService)readonly service:ProjectService){}
  @Get("analyses/providers")@ApiOkResponse({schema:{type:"object",required:["transcription","selection","paidExecutionEnabled"],properties:{transcription:{type:"object",required:["whisper_cpp","deepgram"],additionalProperties:false,properties:Object.fromEntries(["whisper_cpp","deepgram"].map(name=>[name,{type:"object",required:["configured","maxSeconds","diarization"],properties:{configured:{type:"boolean"},maxSeconds:{type:"integer"},diarization:{type:"boolean"}}}]))},selection:{type:"object",required:["ollama"],properties:{ollama:{type:"object",required:["configured"],properties:{configured:{type:"boolean"}}}}},paidExecutionEnabled:{type:"boolean"}}}}) providers(@Req()req:Request){return this.service.analyses.providers(req);}
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
