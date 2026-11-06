import {z} from "zod";
import {ApiProperty,ApiPropertyOptional,getSchemaPath} from "@nestjs/swagger";
import {SubtitleStyleDto} from "./processing.js";
import {selectionInstructions} from "./analysis.js";

// v1 keeps the original manually selected interval. v2 defaults to the bounded
// local selector; paid generative selection remains an explicit opt-in.
const aspect=z.enum(["source","vertical","square","horizontal"]);
const subtitles=z.discriminatedUnion("source",[
  z.object({source:z.literal("none")}).strict(),
  z.object({source:z.literal("transcript"),style:z.object({template:z.enum(["clean","boxed","bold"]),fontSize:z.number().int().min(12).max(40).default(24),position:z.enum(["top","bottom"]).default("bottom")}).strict().optional()}).strict(),
]);
const manualPipelineSpec=z.object({version:z.literal(1),provider:z.literal("whisper_cpp"),language:z.enum(["auto","es","en"]),selection:z.object({mode:z.literal("none")}).strict(),startSeconds:z.number().finite().min(0).max(300),endSeconds:z.number().finite().positive().max(300),aspect}).strict().refine(value=>value.endSeconds-value.startSeconds>=0.1&&value.endSeconds-value.startSeconds<=120);
const automaticPipelineSpec=z.object({version:z.literal(2),mode:z.literal("automatic"),provider:z.literal("whisper_cpp"),language:z.enum(["auto","es","en"]).default("auto"),clipCount:z.number().int().min(1).max(3),maxDurationSeconds:z.number().finite().min(1).max(120).optional(),selectionMode:z.enum(["local","llm"]).default("local"),contentType:z.enum(["general","tutorial","interview","gameplay","commentary","reaction"]),instructions:selectionInstructions.default(""),aspect,subtitles}).strict().refine(value=>value.selectionMode==="llm"||value.instructions==="");
export const pipelineSpec=z.discriminatedUnion("version",[manualPipelineSpec,automaticPipelineSpec]);
export type PipelineSpec=z.infer<typeof pipelineSpec>;
export type AutomaticPipelineSpec=Extract<PipelineSpec,{version:2}>;
export class PipelineSpecDto {
  @ApiProperty({enum:[1]}) version!:number;
  @ApiProperty({enum:["whisper_cpp"]}) provider!:string;
  @ApiProperty({enum:["auto","es","en"]}) language!:string;
  @ApiProperty({type:"object",required:["mode"],additionalProperties:false,properties:{mode:{type:"string",enum:["none"]}},description:"Manual interval; no automatic segment selection."}) selection!:{mode:"none"};
  @ApiProperty({minimum:0,maximum:300}) startSeconds!:number;
  @ApiProperty({minimum:0,maximum:300,description:"Within the inspected source; clip length 0.1–120 seconds."}) endSeconds!:number;
  @ApiProperty({enum:["source","vertical","square","horizontal"]}) aspect!:string;
}
export class PipelineSubtitlesNoneDto {@ApiProperty({enum:["none"]}) source!:string;}
export class PipelineSubtitlesTranscriptDto {
  @ApiProperty({enum:["transcript"]}) source!:string;
  @ApiPropertyOptional({type:SubtitleStyleDto}) style?:SubtitleStyleDto;
}
export class AutomaticPipelineSpecDto {
  @ApiProperty({enum:[2]}) version!:number;
  @ApiProperty({enum:["automatic"]}) mode!:string;
  @ApiProperty({enum:["whisper_cpp"],description:"Local ASR; no external transcription API."}) provider!:string;
  @ApiPropertyOptional({enum:["auto","es","en"],default:"auto"}) language?:string;
  @ApiProperty({minimum:1,maximum:3,description:"The selector returns exactly this many distinct source intervals."}) clipCount!:number;
  @ApiPropertyOptional({minimum:1,maximum:120,description:"Optional upper bound per clip; omitted means 120 seconds."}) maxDurationSeconds?:number;
  @ApiPropertyOptional({enum:["local","llm"],default:"local",description:"Local is deterministic, evenly distributed, and free of generative-model calls. llm requires separate paid AI authorization."}) selectionMode?:string;
  @ApiProperty({enum:["general","tutorial","interview","gameplay","commentary","reaction"]}) contentType!:string;
  @ApiPropertyOptional({maxLength:2000,default:"",description:"User selection instructions passed to the fixed, versioned backend prompt. Requires selectionMode=llm and paid AI authorization; never interpreted by the local deterministic selector."}) instructions?:string;
  @ApiProperty({enum:["source","vertical","square","horizontal"]}) aspect!:string;
  @ApiProperty({oneOf:[{$ref:getSchemaPath(PipelineSubtitlesNoneDto)},{$ref:getSchemaPath(PipelineSubtitlesTranscriptDto)}]}) subtitles!:PipelineSubtitlesNoneDto|PipelineSubtitlesTranscriptDto;
}
export class PipelineEventDto {
  @ApiProperty() version!:number;
  @ApiProperty() status!:string;
  @ApiProperty({format:"date-time"}) at!:string;
}
export class PipelineStatusDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({enum:["queued","audio","analysis","render","stopping","succeeded","partial_failed","failed","cancelled"]}) status!:string;
  @ApiProperty({oneOf:[{$ref:getSchemaPath(PipelineSpecDto)},{$ref:getSchemaPath(AutomaticPipelineSpecDto)}]}) spec!:PipelineSpecDto|AutomaticPipelineSpecDto;
  @ApiProperty() version!:number;
  @ApiProperty() cancellationRequested!:boolean;
  @ApiProperty({enum:["legacy","pending","accepted","rejected"],description:"Consumption admission; legacy intents predate usage accounting."}) usageState!:string;
  @ApiProperty({type:String,nullable:true}) errorCode!:string|null;
  @ApiProperty({format:"date-time"}) createdAt!:string;
  @ApiProperty({format:"date-time"}) deadlineAt!:string;
  @ApiProperty({type:String,format:"date-time",nullable:true}) finishedAt!:string|null;
  @ApiProperty({type:String,format:"uuid",nullable:true}) audioProcessingId!:string|null;
  @ApiProperty({type:String,format:"uuid",nullable:true}) analysisId!:string|null;
  @ApiProperty({type:String,format:"uuid",nullable:true}) renderProcessingId!:string|null;
  @ApiProperty({description:"Unallocated portion of the upfront storage reservation; children settle their transferred portions."}) reservedBytes!:number;
  @ApiPropertyOptional({minimum:1,maximum:3}) requestedClips?:number;
  @ApiPropertyOptional({minimum:0,maximum:3}) completedClips?:number;
  @ApiPropertyOptional({minimum:0,maximum:3,description:"Children in a terminal render state; progress is measured, not estimated."}) settledClips?:number;
  @ApiProperty({type:[PipelineEventDto],maxItems:8}) events!:PipelineEventDto[];
  @ApiPropertyOptional({type:()=>[PipelineClipStatusDto],maxItems:3}) clips?:PipelineClipStatusDto[];
}
export class PipelineClipStatusDto {
  @ApiProperty({minimum:0,maximum:2}) index!:number;
  @ApiProperty({enum:["queued","running","succeeded","failed","cancelled"]}) status!:string;
  @ApiProperty({maxLength:150}) title!:string;
  @ApiProperty() startSeconds!:number;
  @ApiProperty() endSeconds!:number;
  @ApiProperty({type:String,format:"uuid",nullable:true}) processingId!:string|null;
  @ApiProperty({type:String,nullable:true}) errorCode!:string|null;
}
