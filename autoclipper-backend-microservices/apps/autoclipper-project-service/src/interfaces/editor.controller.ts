import {Body,Controller,Get,Inject,Param,Patch,Post,Query,Req,Res} from "@nestjs/common";
import type {Request,Response} from "express";
import {ApiBody,ApiCreatedResponse,ApiExtraModels,ApiHeader,ApiOkResponse,ApiProperty,ApiTags,ApiQuery} from "@nestjs/swagger";
import {z} from "zod";
import {EditorDraftDto,EditorRevisionDto,EditorRevisionSummaryDto,EditorExportDto,EditorSpecDto,NoEditorCaptionsDto,UserEditorCaptionsDto,TranscriptEditorCaptionsDto} from "@autoclipper/api-contracts";
import {body,uuid} from "@autoclipper/http-security";
import {ProjectService} from "../application/project.service.js";
class CreateEditDto {@ApiProperty({maxLength:150}) name!:string;@ApiProperty({type:EditorSpecDto}) spec!:EditorSpecDto;}
class UpdateEditDto {@ApiProperty({minimum:1,description:"Current draft version. Stale updates return 412."}) version!:number;@ApiProperty({type:EditorSpecDto}) spec!:EditorSpecDto;}
class RenderRevisionDto {@ApiProperty({minimum:1}) revisionVersion!:number;}
class RestoreRevisionDto {@ApiProperty({minimum:1}) version!:number;@ApiProperty({minimum:1}) revisionVersion!:number;}
@ApiTags("editor")
@ApiExtraModels(NoEditorCaptionsDto,UserEditorCaptionsDto,TranscriptEditorCaptionsDto,EditorRevisionSummaryDto,EditorExportDto)
@Controller()
export class EditorController {
  constructor(@Inject(ProjectService)readonly service:ProjectService){}
  @Post("uploads/:id/edits")@ApiHeader({name:"Idempotency-Key",required:true})@ApiBody({type:CreateEditDto})@ApiCreatedResponse({type:EditorDraftDto})
  create(@Req()req:Request,@Param("id")id:string,@Body()input:unknown,@Res({passthrough:true})res:Response){return this.service.editor.create(req,uuid(id),input,String(res.locals["correlationId"]));}
  @Get("edits/:id")@ApiOkResponse({type:EditorDraftDto,headers:{ETag:{description:"Quoted current draft version, for example \"3\".",schema:{type:"string"}}}}) async get(@Req()req:Request,@Param("id")id:string,@Res({passthrough:true})res:Response){const value=await this.service.editor.get(req,uuid(id));res.setHeader("ETag",`"${value.version}"`);return value;}
  @Patch("edits/:id")@ApiHeader({name:"If-Match",required:false,description:"Quoted expected version; must match the version in the body."})@ApiBody({type:UpdateEditDto})@ApiOkResponse({type:EditorDraftDto}) update(@Req()req:Request,@Param("id")id:string,@Body()input:unknown,@Res({passthrough:true})res:Response){return this.service.editor.update(req,uuid(id),input,String(res.locals["correlationId"]));}
  @Get("edits/:id/revisions")@ApiQuery({name:"beforeVersion",required:false,type:Number,minimum:1})@ApiOkResponse({schema:{type:"object",required:["items","nextBeforeVersion"],properties:{items:{type:"array",maxItems:50,items:{$ref:"#/components/schemas/EditorRevisionSummaryDto"}},nextBeforeVersion:{type:"integer",nullable:true}}}}) history(@Req()req:Request,@Param("id")id:string,@Query("beforeVersion")before:string|undefined){return this.service.editor.history(req,uuid(id),before);}
  @Get("edits/:id/revisions/:version")@ApiOkResponse({type:EditorRevisionDto}) revision(@Req()req:Request,@Param("id")id:string,@Param("version")number:string){return this.service.editor.getRevision(req,uuid(id),body(z.coerce.number().int().min(1).max(2147483646),number));}
  @Post("edits/:id/restore")@ApiHeader({name:"If-Match",required:false,description:"Quoted expected version; must match the version in the body."})@ApiBody({type:RestoreRevisionDto})@ApiCreatedResponse({type:EditorDraftDto}) restore(@Req()req:Request,@Param("id")id:string,@Body()input:unknown,@Res({passthrough:true})res:Response){return this.service.editor.restore(req,uuid(id),input,String(res.locals["correlationId"]));}
  @Post("edits/:id/renders")@ApiHeader({name:"Idempotency-Key",required:true})@ApiBody({type:RenderRevisionDto})@ApiCreatedResponse({schema:{type:"object",required:["id","status"],properties:{id:{type:"string",format:"uuid"},status:{type:"string"}}}}) render(@Req()req:Request,@Param("id")id:string,@Body()input:unknown,@Res({passthrough:true})res:Response){return this.service.editor.render(req,uuid(id),input,String(res.locals["correlationId"]));}
  @Get("edits/:id/exports")@ApiOkResponse({schema:{type:"object",required:["items"],properties:{items:{type:"array",maxItems:50,items:{$ref:"#/components/schemas/EditorExportDto"}}}}}) exports(@Req()req:Request,@Param("id")id:string){return this.service.editor.exports(req,uuid(id));}
  @Get("projects/:id/edits")@ApiOkResponse({schema:{type:"object",required:["items"],properties:{items:{type:"array",maxItems:50,items:{type:"object",required:["id","uploadId","name","version","updatedAt"],properties:{id:{type:"string",format:"uuid"},uploadId:{type:"string",format:"uuid"},name:{type:"string"},version:{type:"integer"},updatedAt:{type:"string",format:"date-time"}}}}}}})async list(@Req()req:Request,@Param("id")id:string){const projectId=uuid(id);await this.service.get(req,projectId);return this.service.editor.list(projectId);}
}
