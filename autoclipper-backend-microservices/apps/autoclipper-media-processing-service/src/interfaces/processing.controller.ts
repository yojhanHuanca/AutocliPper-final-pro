import {Controller,Post,Body,Req,Inject,HttpCode} from "@nestjs/common";
import {ApiExcludeController} from "@nestjs/swagger";
import type {Request} from "express";
import {z} from "zod";
import {body,requireInternal} from "@autoclipper/http-security";
import {ProcessingRuntime} from "../application/processing-runtime.js";
@ApiExcludeController()
@Controller("internal")
export class ProcessingController {
  constructor(@Inject(ProcessingRuntime)readonly runtime:ProcessingRuntime){}
  @Post("processing")@HttpCode(200) submit(@Req()req:Request,@Body()input:unknown){
    requireInternal(req,this.runtime.config);
    const data=body(z.object({id:z.uuid(),workspaceId:z.uuid(),inspectionId:z.uuid(),spec:z.unknown(),correlationId:z.uuid(),cancelRequested:z.boolean().default(false)}).strict(),input);
    return this.runtime.submit({...data,spec:data.spec});
  }
  @Post("processing-status")@HttpCode(200) status(@Req()req:Request,@Body()input:unknown){
    requireInternal(req,this.runtime.config);const data=body(z.object({id:z.uuid(),workspaceId:z.uuid()}).strict(),input);
    return this.runtime.status(data.id,data.workspaceId);
  }
  @Post("processing-cancel")@HttpCode(200) cancel(@Req()req:Request,@Body()input:unknown){
    requireInternal(req,this.runtime.config);const data=body(z.object({id:z.uuid(),workspaceId:z.uuid()}).strict(),input);
    return this.runtime.cancel(data.id,data.workspaceId);
  }
}
