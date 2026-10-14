import {z} from "zod";
import {ApiProperty,ApiPropertyOptional,getSchemaPath,OmitType} from "@nestjs/swagger";
import {framingSchema,subtitleStyleSchema,subtitleCueSchema,internalProcessingSpec,FramingDto,SubtitleStyleDto,SubtitleCueDto,ProcessingSpecDto,ProcessingStatusDto} from "./processing.js";
const noCaptions=z.object({source:z.literal("none")}).strict();
const userCaptions=z.object({source:z.literal("user"),cues:z.array(subtitleCueSchema).min(1).max(200),style:subtitleStyleSchema.optional()}).strict();
const transcriptCaptions=z.object({source:z.literal("transcript"),analysisId:z.uuid(),style:subtitleStyleSchema.optional()}).strict();
export const editorSpec=z.object({version:z.literal(1),kind:z.literal("clip"),startSeconds:z.number().finite().nonnegative().max(14400),endSeconds:z.number().finite().positive().max(14400),aspect:z.enum(["source","vertical","square","horizontal"]),framing:framingSchema.optional(),subtitles:z.union([noCaptions,userCaptions,transcriptCaptions]).default({source:"none"})}).strict().superRefine((value,context)=>{
  const validation=internalProcessingSpec.safeParse({version:1,kind:"clip",startSeconds:value.startSeconds,endSeconds:value.endSeconds,aspect:value.aspect,...(value.framing?{framing:value.framing}:{}),...(value.subtitles.source==="user"?{subtitles:{provenance:"user",cues:value.subtitles.cues,...(value.subtitles.style?{style:value.subtitles.style}:{})}}:{})});
  if(!validation.success)context.addIssue({code:"custom",message:"Invalid editing timeline, framing or captions"});
  if(Buffer.byteLength(JSON.stringify(value),"utf8")>65000)context.addIssue({code:"custom",message:"Editing description exceeds 65,000 bytes"});
});
export type EditorSpec=z.infer<typeof editorSpec>;
export class NoEditorCaptionsDto {@ApiProperty({enum:["none"]}) source!:string;}
export class UserEditorCaptionsDto {
  @ApiProperty({enum:["user"]}) source!:string;
  @ApiProperty({type:[SubtitleCueDto],minItems:1,maxItems:200}) cues!:SubtitleCueDto[];
  @ApiPropertyOptional({type:SubtitleStyleDto}) style?:SubtitleStyleDto;
}
export class TranscriptEditorCaptionsDto {
  @ApiProperty({enum:["transcript"]}) source!:string;
  @ApiProperty({format:"uuid",description:"Existing authorized successful analysis of the same source upload."}) analysisId!:string;
  @ApiPropertyOptional({type:SubtitleStyleDto}) style?:SubtitleStyleDto;
}
export class EditorSpecDto {
  @ApiProperty({enum:[1]}) version!:number;
  @ApiProperty({enum:["clip"]}) kind!:string;
  @ApiProperty({minimum:0}) startSeconds!:number;
  @ApiProperty({minimum:0,description:"Clip length 0.1–120 seconds."}) endSeconds!:number;
  @ApiProperty({enum:["source","vertical","square","horizontal"]}) aspect!:string;
  @ApiPropertyOptional({type:FramingDto}) framing?:FramingDto;
  @ApiPropertyOptional({oneOf:[{$ref:getSchemaPath(NoEditorCaptionsDto)},{$ref:getSchemaPath(UserEditorCaptionsDto)},{$ref:getSchemaPath(TranscriptEditorCaptionsDto)}]}) subtitles?:NoEditorCaptionsDto|UserEditorCaptionsDto|TranscriptEditorCaptionsDto;
}
export class EditorRevisionSummaryDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({minimum:1}) version!:number;
  @ApiProperty({enum:["created","updated","restored"]}) action!:string;
  @ApiProperty({type:Number,nullable:true}) restoredFromVersion!:number|null;
  @ApiProperty({format:"uuid"}) authorId!:string;
  @ApiProperty({format:"date-time"}) createdAt!:string;
}
export class EditorRevisionDto extends EditorRevisionSummaryDto {
  @ApiProperty({type:EditorSpecDto}) spec!:EditorSpecDto;
  @ApiProperty({type:ProcessingSpecDto,description:"Immutable server-resolved render description, including verified transcript provenance."}) renderSpec!:ProcessingSpecDto;
}
export class EditorExportDto extends OmitType(ProcessingStatusDto,["spec"] as const) {}
export class EditorDraftDto {
  @ApiProperty({format:"uuid"}) id!:string;
  @ApiProperty({format:"uuid"}) uploadId!:string;
  @ApiProperty({format:"uuid"}) projectId!:string;
  @ApiProperty() name!:string;
  @ApiProperty({minimum:1}) version!:number;
  @ApiProperty({type:EditorRevisionDto}) revision!:EditorRevisionDto;
}
