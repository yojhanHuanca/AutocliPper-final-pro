import {z} from "zod";
import {ApiProperty} from "@nestjs/swagger";

// This increment deliberately admits only local ASR and an explicit manual interval.
export const pipelineSpec=z.object({version:z.literal(1),provider:z.literal("whisper_cpp"),language:z.enum(["auto","es","en"]),selection:z.object({mode:z.literal("none")}).strict(),startSeconds:z.number().finite().min(0).max(300),endSeconds:z.number().finite().positive().max(300),aspect:z.enum(["source","vertical","square","horizontal"])}).strict().refine(value=>value.endSeconds-value.startSeconds>=0.1&&value.endSeconds-value.startSeconds<=120);
export type PipelineSpec=z.infer<typeof pipelineSpec>;
export class PipelineSpecDto {
  @ApiProperty({enum:[1]}) version!:number;
  @ApiProperty({enum:["whisper_cpp"]}) provider!:string;
  @ApiProperty({enum:["auto","es","en"]}) language!:string;
  @ApiProperty({type:"object",required:["mode"],additionalProperties:false,properties:{mode:{type:"string",enum:["none"]}},description:"Manual interval; no automatic segment selection."}) selection!:{mode:"none"};
  @ApiProperty({minimum:0,maximum:300}) startSeconds!:number;
  @ApiProperty({minimum:0,maximum:300,description:"Within the inspected source; clip length 0.1–120 seconds."}) endSeconds!:number;
  @ApiProperty({enum:["source","vertical","square","horizontal"]}) aspect!:string;
}
export class PipelineEventDto {
  @ApiProperty() version!:number;
  @ApiProperty() status!:string;
  @ApiProperty({format:"date-time"}) at!:string;
}
export class PipelineStatusDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({enum:["queued","audio","analysis","render","stopping","succeeded","failed","cancelled"]}) status!:string;
  @ApiProperty({type:PipelineSpecDto}) spec!:PipelineSpecDto;
  @ApiProperty() version!:number;
  @ApiProperty() cancellationRequested!:boolean;
  @ApiProperty({type:String,nullable:true}) errorCode!:string|null;
  @ApiProperty({format:"date-time"}) createdAt!:string;
  @ApiProperty({format:"date-time"}) deadlineAt!:string;
  @ApiProperty({type:String,format:"date-time",nullable:true}) finishedAt!:string|null;
  @ApiProperty({type:String,format:"uuid",nullable:true}) audioProcessingId!:string|null;
  @ApiProperty({type:String,format:"uuid",nullable:true}) analysisId!:string|null;
  @ApiProperty({type:String,format:"uuid",nullable:true}) renderProcessingId!:string|null;
  @ApiProperty({description:"Unallocated portion of the upfront storage reservation; children settle their transferred portions."}) reservedBytes!:number;
  @ApiProperty({type:[PipelineEventDto],maxItems:8}) events!:PipelineEventDto[];
}
