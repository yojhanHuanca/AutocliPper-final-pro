import {Body,Controller,Delete,Get,HttpCode,Inject,Param,Post,Query,Req,Res} from "@nestjs/common";
import {ApiBody,ApiCreatedResponse,ApiHeader,ApiOkResponse,ApiQuery,ApiTags} from "@nestjs/swagger";
import type {Request,Response} from "express";
import {PipelineSpecDto,PipelineStatusDto} from "@autoclipper/api-contracts";
import {uuid} from "@autoclipper/http-security";
import {ProjectService} from "../application/project.service.js";
@ApiTags("pipelines")
@Controller()
export class PipelineController {
  constructor(@Inject(ProjectService)readonly service:ProjectService){}
  @Post("uploads/:id/pipelines")@ApiHeader({name:"Idempotency-Key",required:true})@ApiBody({type:PipelineSpecDto})@ApiCreatedResponse({type:PipelineStatusDto})
  begin(@Req()req:Request,@Param("id")id:string,@Body()input:PipelineSpecDto,@Res({passthrough:true})res:Response){return this.service.pipelines.begin(req,uuid(id),input,String(res.locals["correlationId"]));}
  @Get("pipelines/:id")@ApiOkResponse({type:PipelineStatusDto}) status(@Req()req:Request,@Param("id")id:string){return this.service.pipelines.status(req,uuid(id));}
  @Delete("pipelines/:id")@HttpCode(200)@ApiOkResponse({schema:{type:"object",required:["cancellationRequested"],properties:{cancellationRequested:{type:"boolean"}}}})
  cancel(@Req()req:Request,@Param("id")id:string){return this.service.pipelines.cancel(req,uuid(id));}
  @Get("pipelines/:id/download")@ApiQuery({name:"kind",enum:["video","srt","vtt"],required:false})@ApiOkResponse({schema:{type:"object",required:["url","expiresInSeconds","contentType","bytes","sha256"],properties:{url:{type:"string",format:"uri"},expiresInSeconds:{type:"integer",maximum:120},contentType:{type:"string"},bytes:{type:"integer"},sha256:{type:"string"}}}})
  download(@Req()req:Request,@Param("id")id:string,@Query("kind")kind="video"){return this.service.pipelines.download(req,uuid(id),kind);}
}
