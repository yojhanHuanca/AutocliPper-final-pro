import {Controller,Post,Get,Delete,Req,Res,Body,Param,Query,Inject,HttpCode} from "@nestjs/common";
import type {Request,Response} from "express";
import {ApiTags,ApiBody,ApiHeader,ApiCreatedResponse,ApiOkResponse,ApiQuery,ApiExtraModels,ApiForbiddenResponse,getSchemaPath} from "@nestjs/swagger";
import {ProcessingSpecDto,ProcessingStatusDto,AudioProcessingSpecDto,ClipProcessingSpecDto,ErrorResponse} from "@autoclipper/api-contracts";
import {uuid} from "@autoclipper/http-security";
import {ProjectService} from "../application/project.service.js";
@ApiTags("processing")
@ApiExtraModels(AudioProcessingSpecDto,ClipProcessingSpecDto)
@Controller()
export class DerivativesController {
  constructor(@Inject(ProjectService)readonly service:ProjectService){}
  @Post("uploads/:id/processing")
  @ApiForbiddenResponse({type:ErrorResponse,description:"Manual processing is blocked with MANUAL_PROCESSING_NOT_ADMITTED when server PROCESSING_ADMISSION_MODE=commercial. Use an admitted pipeline. Reads, downloads and cancellation remain authorized separately."})
  @ApiBody({schema:{oneOf:[{$ref:getSchemaPath(AudioProcessingSpecDto)},{$ref:getSchemaPath(ClipProcessingSpecDto)}]}})
  @ApiHeader({name:"Idempotency-Key",required:true})
  @ApiCreatedResponse({schema:{type:"object",required:["id","status"],properties:{id:{type:"string",format:"uuid"},status:{type:"string"}}}})
  begin(@Req()req:Request,@Res({passthrough:true})res:Response,@Param("id")id:string,@Body()input:ProcessingSpecDto){return this.service.derivatives.begin(req,uuid(id),input,String(res.locals["correlationId"]));}
  @Get("processing/:id")@ApiOkResponse({type:ProcessingStatusDto}) status(@Req()req:Request,@Param("id")id:string){return this.service.derivatives.status(req,uuid(id));}
  @Get("projects/:id/processing")@ApiOkResponse({schema:{type:"object",required:["items"],properties:{items:{type:"array",maxItems:50,items:{$ref:"#/components/schemas/ProcessingStatusDto"}}}}}) async list(@Req()req:Request,@Param("id")id:string){const projectId=uuid(id);await this.service.get(req,projectId);return this.service.derivatives.list(req,projectId);}
  @Delete("processing/:id")@HttpCode(200)@ApiOkResponse({schema:{type:"object",required:["cancellationRequested"],properties:{cancellationRequested:{type:"boolean"}}}}) cancel(@Req()req:Request,@Param("id")id:string){return this.service.derivatives.cancel(req,uuid(id));}
  @Get("processing/:id/download")
  @ApiQuery({name:"kind",enum:["video","audio","srt","vtt"]})
  @ApiOkResponse({schema:{type:"object",required:["url","expiresInSeconds","contentType","bytes","sha256"],properties:{url:{type:"string",format:"uri"},expiresInSeconds:{type:"integer",example:120},contentType:{type:"string"},bytes:{type:"integer"},sha256:{type:"string"}}}})
  download(@Req()req:Request,@Param("id")id:string,@Query("kind")kind:string){return this.service.derivatives.download(req,uuid(id),kind);}
}
