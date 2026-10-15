import {z} from "zod";
import {ApiProperty} from "@nestjs/swagger";
export const usageStage=z.enum(["audio","analysis","render"]);
export type UsageStage=z.infer<typeof usageStage>;
export const usageReservation=z.object({version:z.literal(1),pipelineId:z.uuid(),workspaceId:z.uuid(),creatorId:z.uuid(),sourceSeconds:z.number().finite().positive().max(300),clipSeconds:z.number().finite().min(0.1).max(120)}).strict().refine(value=>value.clipSeconds<=value.sourceSeconds);
export type UsageReservation=z.infer<typeof usageReservation>;
export const usageReport=z.object({version:z.literal(1),eventId:z.uuid(),pipelineId:z.uuid(),workspaceId:z.uuid(),stage:usageStage,outcome:z.enum(["succeeded","failed","cancelled","skipped"]),actualDurationSeconds:z.number().finite().min(0).max(300.3)}).strict().refine(value=>value.outcome==="succeeded"?value.actualDurationSeconds>0:value.actualDurationSeconds===0);
export type UsageReport=z.infer<typeof usageReport>;
export const usageAdmission=z.object({admitted:z.boolean(),code:z.enum(["PROCESSING_ALLOWANCE_EXCEEDED","PROCESSING_CONCURRENCY_EXCEEDED","USAGE_AUTHORIZATION_REVOKED"]).nullable()}).strict();
export function usageBudgets(value:Pick<UsageReservation,"sourceSeconds"|"clipSeconds">){return{audio:Math.ceil(value.sourceSeconds+0.3),analysis:Math.ceil(value.sourceSeconds+0.3),render:Math.ceil(value.clipSeconds+0.3)};}
export class DevelopmentPlanDto {
  @ApiProperty({enum:["development"]}) kind!:string;
  @ApiProperty() label!:string;
  @ApiProperty({description:"Immutable version digest; no commercial price."}) version!:string;
  @ApiProperty({minimum:1}) processingSecondsPerMonth!:number;
  @ApiProperty({minimum:1,maximum:4}) activePipelines!:number;
}
export class ConsumptionDto {
  @ApiProperty({format:"uuid"}) workspaceId!:string;
  @ApiProperty({enum:["material_seconds_per_stage"]}) unit!:string;
  @ApiProperty({type:DevelopmentPlanDto,nullable:true}) plan!:DevelopmentPlanDto|null;
  @ApiProperty({type:String,format:"date-time"}) periodStart!:string;
  @ApiProperty({type:String,format:"date-time"}) periodEnd!:string;
  @ApiProperty() consumedSeconds!:number;
  @ApiProperty() consumedMinutes!:number;
  @ApiProperty() reservedSeconds!:number;
  @ApiProperty() availableSeconds!:number;
}
export class UsageLedgerEntryDto {
  @ApiProperty({pattern:"^[0-9]+$"}) id!:string;
  @ApiProperty({format:"uuid"}) pipelineId!:string;
  @ApiProperty({enum:["audio","analysis","render"]}) stage!:string;
  @ApiProperty({enum:["reserve","consume","release"]}) kind!:string;
  @ApiProperty({minimum:0}) seconds!:number;
  @ApiProperty({format:"date-time"}) at!:string;
  @ApiProperty({format:"date-time"}) periodStart!:string;
}
export class UsageLedgerDto {
  @ApiProperty({type:[UsageLedgerEntryDto],maxItems:50}) items!:UsageLedgerEntryDto[];
  @ApiProperty({type:String,nullable:true}) nextBeforeId!:string|null;
}
