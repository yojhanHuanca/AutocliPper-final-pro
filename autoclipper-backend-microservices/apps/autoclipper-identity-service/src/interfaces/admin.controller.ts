import {Body,Controller,Get,HttpCode,Inject,Post,Query,Req,Res} from "@nestjs/common";
import type {Request,Response} from "express";
import {ApiBody,ApiExcludeEndpoint,ApiOkResponse,ApiQuery,ApiTags} from "@nestjs/swagger";
import {AdminQueryDto,AdminReauthDto,AdminElevatedDto,AdminAccessDto,AdminUsersPageDto,AdminWorkspacesPageDto,AdminJobsPageDto,AdminConsumptionPageDto} from "@autoclipper/api-contracts";
import {requireInternal} from "@autoclipper/http-security";
import {IdentityService} from "../application/identity.service.js";
@ApiTags("administration-read-only")@Controller()
export class AdminController {
  constructor(@Inject(IdentityService)readonly service:IdentityService){}
  @Get("admin/access")@ApiOkResponse({type:AdminAccessDto}) access(@Req()req:Request){return this.service.admin.access(req);}
  @Post("admin/access")@HttpCode(200)@ApiBody({type:AdminReauthDto})@ApiOkResponse({type:AdminElevatedDto}) elevate(@Req()req:Request,@Body()input:unknown,@Res({passthrough:true})res:Response){return this.service.adminAccess(req,input,String(res.locals["correlationId"]));}
  @Get("admin/users")@ApiQuery({name:"beforeId",required:false,schema:{type:"string",format:"uuid"}})@ApiQuery({name:"limit",required:false,schema:{type:"integer",minimum:1,maximum:50,default:25}})@ApiOkResponse({type:AdminUsersPageDto}) users(@Req()req:Request,@Query()input:unknown,@Res({passthrough:true})res:Response){return this.service.admin.users(req,input,String(res.locals["correlationId"]));}
  @Get("admin/workspaces")@ApiQuery({type:AdminQueryDto})@ApiOkResponse({type:AdminWorkspacesPageDto}) workspaces(@Req()req:Request,@Query()input:unknown,@Res({passthrough:true})res:Response){return this.service.admin.forward(req,"workspaces.read",input,String(res.locals["correlationId"]));}
  @Get("admin/jobs")@ApiQuery({type:AdminQueryDto})@ApiOkResponse({type:AdminJobsPageDto}) jobs(@Req()req:Request,@Query()input:unknown,@Res({passthrough:true})res:Response){return this.service.admin.forward(req,"jobs.read",input,String(res.locals["correlationId"]));}
  @Get("admin/consumption")@ApiQuery({type:AdminQueryDto})@ApiOkResponse({type:AdminConsumptionPageDto}) consumption(@Req()req:Request,@Query()input:unknown,@Res({passthrough:true})res:Response){return this.service.admin.forward(req,"consumption.read",input,String(res.locals["correlationId"]));}
  @Post("internal/admin-authorize")@HttpCode(200)@ApiExcludeEndpoint() authorize(@Req()req:Request,@Body()input:unknown){requireInternal(req,this.service.config);return this.service.admin.authorize(input);}
}
