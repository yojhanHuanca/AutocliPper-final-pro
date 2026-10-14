import {z} from "zod";
import {ApiProperty,ApiPropertyOptional,getSchemaPath} from "@nestjs/swagger";

export const selectionSpec=z.object({mode:z.literal("llm"),count:z.number().int().min(1).max(3),minSeconds:z.number().finite().min(1).max(120),maxSeconds:z.number().finite().min(1).max(120),instructions:z.string().trim().max(2000).default("")}).strict().refine(value=>value.minSeconds<=value.maxSeconds);
export const analysisSpec=z.object({version:z.literal(1),provider:z.enum(["whisper_cpp","deepgram"]),language:z.enum(["auto","es","en"]).default("auto"),selection:z.union([z.object({mode:z.literal("none")}).strict(),selectionSpec]).default({mode:"none"})}).strict();
export type AnalysisSpec=z.infer<typeof analysisSpec>;
export const proposalSchema=z.object({startSeconds:z.number().finite().nonnegative(),endSeconds:z.number().finite().positive(),title:z.string().trim().min(1).max(150),description:z.string().max(2000),hashtags:z.array(z.string().regex(/^#[\p{L}\p{N}_]{1,80}$/u)).max(12),explanation:z.string().trim().min(1).max(2000),score:z.number().finite().min(0).max(1).optional()}).strict();
export const selectionOutput=z.object({segments:z.array(proposalSchema).min(1).max(3)}).strict();
export type SegmentProposal=z.infer<typeof proposalSchema>;
export const transcriptSegmentSchema=z.object({startSeconds:z.number().finite().nonnegative(),endSeconds:z.number().finite().positive(),text:z.string().trim().min(1).max(2000),speaker:z.number().int().nonnegative().optional()}).strict();
export const transcriptDataSchema=z.object({language:z.string().min(2).max(16),languageSource:z.enum(["detected","requested"]),durationSeconds:z.number().finite().positive(),segments:z.array(transcriptSegmentSchema).min(1).max(20000),provider:z.enum(["whisper_cpp","deepgram"]),model:z.string().min(1).max(200),revision:z.string().min(1).max(200),engineVersion:z.string().max(100),modelSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),requestId:z.string().max(200).nullable(),estimatedExternalCostUsd:z.number().finite().nonnegative(),diarization:z.boolean()}).strict();
export const selectionResultSchema=selectionOutput.extend({provider:z.literal("ollama"),model:z.string().min(1).max(200),revision:z.string().regex(/^[a-f0-9]{64}$/),promptVersion:z.literal("segment-selection-v1"),usage:z.object({inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative()}).strict(),estimatedExternalCostUsd:z.literal(0)}).strict();
export const analysisStatus=z.object({id:z.uuid(),status:z.enum(["queued","transcribing","selecting","succeeded","failed","cancelled"]),attempts:z.number().int().nonnegative(),errorCode:z.string().max(100).nullable(),startedAt:z.iso.datetime().nullable(),finishedAt:z.iso.datetime().nullable(),transcript:transcriptDataSchema.extend({id:z.uuid()}).nullable(),selection:selectionResultSchema.nullable(),providerOutcomeUnknown:z.boolean(),phases:z.array(z.object({phase:z.enum(["transcribing","selecting"]),attempt:z.number().int().positive(),startedAt:z.iso.datetime(),finishedAt:z.iso.datetime().nullable(),errorCode:z.string().max(100).nullable()}).strict()).max(6)}).strict();
export type AnalysisStatus=z.infer<typeof analysisStatus>;
export const transcriptRenderSpec=z.union([
  z.object({version:z.literal(1),proposalIndex:z.number().int().min(0).max(2),aspect:z.enum(["source","vertical","square","horizontal"])}).strict(),
  z.object({version:z.literal(1),startSeconds:z.number().finite().nonnegative(),endSeconds:z.number().finite().positive(),aspect:z.enum(["source","vertical","square","horizontal"])}).strict(),
]);
export class NoSelectionDto {
  @ApiProperty({enum:["none"]}) mode!:string;
}
export class LlmSelectionDto {
  @ApiProperty({enum:["llm"]}) mode!:string;
  @ApiProperty({minimum:1,maximum:3}) count!:number;
  @ApiProperty({minimum:1,maximum:120}) minSeconds!:number;
  @ApiProperty({minimum:1,maximum:120}) maxSeconds!:number;
  @ApiPropertyOptional({maxLength:2000,default:""}) instructions?:string;
}
export class AnalysisSpecDto {
  @ApiProperty({enum:[1]}) version!:number;
  @ApiProperty({enum:["whisper_cpp","deepgram"]}) provider!:string;
  @ApiPropertyOptional({enum:["auto","es","en"],default:"auto"}) language?:string;
  @ApiPropertyOptional({oneOf:[{$ref:getSchemaPath(NoSelectionDto)},{$ref:getSchemaPath(LlmSelectionDto)}],description:"none preserves a real transcript without simulating AI segment selection."}) selection?:NoSelectionDto|LlmSelectionDto;
}
export class TranscriptSegmentDto {
  @ApiProperty() startSeconds!:number;
  @ApiProperty() endSeconds!:number;
  @ApiProperty() text!:string;
  @ApiPropertyOptional() speaker?:number;
}
export class TranscriptDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty() language!:string;
  @ApiProperty({enum:["detected","requested"]}) languageSource!:string;
  @ApiProperty() durationSeconds!:number;
  @ApiProperty({type:[TranscriptSegmentDto]}) segments!:TranscriptSegmentDto[];
  @ApiProperty() provider!:string;
  @ApiProperty() model!:string;
  @ApiProperty() revision!:string;
  @ApiProperty() engineVersion!:string;
  @ApiProperty({type:String,nullable:true}) modelSha256!:string|null;
  @ApiProperty({type:String,nullable:true}) requestId!:string|null;
  @ApiProperty({description:"Estimate of external API cost only; local compute is not free."}) estimatedExternalCostUsd!:number;
  @ApiProperty() diarization!:boolean;
}
export class AnalysisStatusDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({enum:["queued","transcribing","selecting","succeeded","failed","cancelled"]}) status!:string;
  @ApiProperty() attempts!:number;
  @ApiProperty({type:String,nullable:true}) errorCode!:string|null;
  @ApiProperty({type:String,nullable:true,format:"date-time"}) startedAt!:string|null;
  @ApiProperty({type:String,nullable:true,format:"date-time"}) finishedAt!:string|null;
  @ApiProperty({type:TranscriptDto,nullable:true}) transcript!:TranscriptDto|null;
  @ApiProperty({type:()=>SelectionResultDto,nullable:true}) selection!:SelectionResultDto|null;
  @ApiProperty() providerOutcomeUnknown!:boolean;
  @ApiProperty({type:()=>[AnalysisPhaseDto]}) phases!:AnalysisPhaseDto[];
}
export class SegmentProposalDto {
  @ApiProperty() startSeconds!:number;
  @ApiProperty() endSeconds!:number;
  @ApiProperty({maxLength:150}) title!:string;
  @ApiProperty({maxLength:2000}) description!:string;
  @ApiProperty({type:[String],maxItems:12}) hashtags!:string[];
  @ApiProperty({maxLength:2000}) explanation!:string;
  @ApiPropertyOptional({minimum:0,maximum:1,description:"Indicative score; no guarantee of virality."}) score?:number;
}
export class SelectionUsageDto {
  @ApiProperty() inputTokens!:number;
  @ApiProperty() outputTokens!:number;
}
export class SelectionResultDto {
  @ApiProperty({type:[SegmentProposalDto],minItems:1,maxItems:3}) segments!:SegmentProposalDto[];
  @ApiProperty({enum:["ollama"]}) provider!:string;
  @ApiProperty() model!:string;
  @ApiProperty({description:"Pinned model SHA-256."}) revision!:string;
  @ApiProperty({enum:["segment-selection-v1"]}) promptVersion!:string;
  @ApiProperty({type:SelectionUsageDto}) usage!:SelectionUsageDto;
  @ApiProperty({enum:[0]}) estimatedExternalCostUsd!:number;
}
export class AnalysisPhaseDto {
  @ApiProperty({enum:["transcribing","selecting"]}) phase!:string;
  @ApiProperty() attempt!:number;
  @ApiProperty({format:"date-time"}) startedAt!:string;
  @ApiProperty({type:String,format:"date-time",nullable:true}) finishedAt!:string|null;
  @ApiProperty({type:String,nullable:true}) errorCode!:string|null;
}
export class ManualTranscriptRenderDto {
  @ApiProperty({enum:[1]}) version!:number;
  @ApiProperty({minimum:0}) startSeconds!:number;
  @ApiProperty({minimum:0,description:"Clip duration 0.1–120 seconds, within source."}) endSeconds!:number;
  @ApiProperty({enum:["source","vertical","square","horizontal"]}) aspect!:string;
}
export class ProposalTranscriptRenderDto {
  @ApiProperty({enum:[1]}) version!:number;
  @ApiProperty({minimum:0,maximum:2,description:"Index into the persisted real LLM proposals."}) proposalIndex!:number;
  @ApiProperty({enum:["source","vertical","square","horizontal"]}) aspect!:string;
}
