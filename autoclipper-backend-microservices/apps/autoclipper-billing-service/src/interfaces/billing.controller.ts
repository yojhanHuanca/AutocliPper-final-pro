import {Body,Controller,Get,HttpCode,Inject,Param,Post,Query,Req} from "@nestjs/common";
import {ApiExcludeEndpoint,ApiOkResponse,ApiQuery,ApiTags} from "@nestjs/swagger";
import type {Request} from "express";
import {ConsumptionDto,UsageLedgerDto} from "@autoclipper/api-contracts";
import {requireInternal,uuid} from "@autoclipper/http-security";
import {BillingService} from "../application/billing.service.js";
@ApiTags("consumption")@Controller()
export class BillingController {
  @Post("internal/admin-consumption")@HttpCode(200)@ApiExcludeEndpoint() adminConsumption(@Req()req:Request,@Body()input:unknown){return this.service.adminConsumption(req,input);}
  constructor(@Inject(BillingService)readonly service:BillingService){}
  @Get("health/live") live(){return{status:"ok"};}
  @Get("health/ready") async ready(){await this.service.pool.query("SELECT 1 FROM plan_versions LIMIT 1");return{status:"ok"};}
  @Get("consumption/workspaces/:id")@ApiOkResponse({type:ConsumptionDto}) consumption(@Req()req:Request,@Param("id")id:string){return this.service.consumption(req,uuid(id));}
  @Get("consumption/workspaces/:id/ledger")@ApiQuery({name:"beforeId",required:false,type:String})@ApiOkResponse({type:UsageLedgerDto}) ledger(@Req()req:Request,@Param("id")id:string,@Query("beforeId")beforeId?:string){return this.service.ledger(req,uuid(id),beforeId);}
  @Post("internal/usage-reservations")@HttpCode(200)@ApiExcludeEndpoint() reserve(@Req()req:Request,@Body()input:unknown){requireInternal(req,this.service.config);return this.service.reserve(input);}
  @Post("internal/usage-settlements")@HttpCode(200)@ApiExcludeEndpoint() settle(@Req()req:Request,@Body()input:unknown){requireInternal(req,this.service.config);return this.service.settle(input);}
}
