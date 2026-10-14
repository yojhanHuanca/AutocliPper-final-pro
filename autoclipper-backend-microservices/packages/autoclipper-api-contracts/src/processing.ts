import { z } from "zod";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const seconds = z.number().finite().min(0).max(14400);
const cue = z.object({
  startSeconds: seconds,
  endSeconds: seconds,
  text: z.string().trim().min(1).max(500).refine(value => !/[<>\\{}]/u.test(value) && [...value].every(character => character==="\n" || character.charCodeAt(0)>=32)),
}).strict().refine(value => value.endSeconds - value.startSeconds >= 0.01);
const clip = z.object({
  version: z.literal(1), kind: z.literal("clip"), startSeconds: seconds, endSeconds: seconds,
  aspect: z.enum(["source","vertical","square","horizontal"]),
  subtitles: z.object({ provenance: z.literal("user"), cues: z.array(cue).min(1).max(200) }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.endSeconds - value.startSeconds < 0.1 || value.endSeconds - value.startSeconds > 120) context.addIssue({code:"custom",message:"Clip duration must be 0.1 to 120 seconds"});
  let previous = value.startSeconds;
  for (const caption of value.subtitles?.cues ?? []) {
    if (caption.startSeconds < previous || caption.endSeconds > value.endSeconds) context.addIssue({code:"custom",message:"Cues must be ordered, non-overlapping and contained in the requested clip"});
    previous = caption.endSeconds;
  }
});
export const processingSpec = z.union([z.object({version:z.literal(1),kind:z.literal("audio")}).strict(),clip]);
export type ProcessingSpec = z.infer<typeof processingSpec>;
export const artifactSchema = z.object({kind:z.enum(["video","audio","srt","vtt"]),objectKey:z.string().max(512),bytes:z.number().int().positive().max(134217728),sha256:z.string().regex(/^[a-f0-9]{64}$/),etag:z.string().min(1).max(200),contentType:z.enum(["video/mp4","audio/wav","application/x-subrip","text/vtt"])}).strict();
export type ProcessingArtifact = z.infer<typeof artifactSchema>;
export const processingStatus = z.object({id:z.uuid(),status:z.enum(["queued","running","succeeded","failed","cancelled"]),attempts:z.number().int().nonnegative(),errorCode:z.string().nullable(),startedAt:z.string().nullable(),finishedAt:z.string().nullable(),cleanupPending:z.boolean(),result:z.object({artifacts:z.array(artifactSchema).max(3),durationSeconds:z.number().positive(),width:z.number().int().positive().optional(),height:z.number().int().positive().optional(),sampleRate:z.number().int().positive().optional()}).strict().nullable()}).strict();
export type ProcessingStatus = z.infer<typeof processingStatus>;

export class SubtitleCueDto {
  @ApiProperty({minimum:0,description:"Absolute timestamp in the source video, seconds."}) startSeconds!: number;
  @ApiProperty({minimum:0}) endSeconds!: number;
  @ApiProperty({maxLength:500,description:"Plain user-provided text; markup and ASS commands are rejected."}) text!: string;
}
export class UserSubtitlesDto {
  @ApiProperty({enum:["user"]}) provenance!: string;
  @ApiProperty({type:[SubtitleCueDto],maxItems:200}) cues!: SubtitleCueDto[];
}
export class ProcessingSpecDto {
  @ApiProperty({enum:[1]}) version!: number;
  @ApiProperty({enum:["audio","clip"]}) kind!: string;
  @ApiPropertyOptional({minimum:0}) startSeconds?: number;
  @ApiPropertyOptional({minimum:0,description:"Clip length must be 0.1–120 seconds and fit the source."}) endSeconds?: number;
  @ApiPropertyOptional({enum:["source","vertical","square","horizontal"]}) aspect?: string;
  @ApiPropertyOptional({type:UserSubtitlesDto}) subtitles?: UserSubtitlesDto;
}
export class AudioProcessingSpecDto {
  @ApiProperty({enum:[1]}) version!: number;
  @ApiProperty({enum:["audio"]}) kind!: string;
}
export class ClipProcessingSpecDto {
  @ApiProperty({enum:[1]}) version!: number;
  @ApiProperty({enum:["clip"]}) kind!: string;
  @ApiProperty({minimum:0}) startSeconds!: number;
  @ApiProperty({minimum:0,description:"Must fit the video; clip length 0.1–120 seconds."}) endSeconds!: number;
  @ApiProperty({enum:["source","vertical","square","horizontal"]}) aspect!: string;
  @ApiPropertyOptional({type:UserSubtitlesDto}) subtitles?: UserSubtitlesDto;
}
export class ProcessingArtifactDto {
  @ApiProperty({enum:["video","audio","srt","vtt"]}) kind!: string;
  @ApiProperty({minimum:1,description:"Bytes charged to workspace storage."}) bytes!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty() contentType!: string;
}
export class ProcessingStatusDto {
  @ApiProperty({format:"uuid"}) id!: string;
  @ApiProperty({enum:["queued","running","succeeded","failed","cancelled"]}) status!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty({type:String,nullable:true}) errorCode!: string|null;
  @ApiProperty({type:String,nullable:true,format:"date-time"}) startedAt!: string|null;
  @ApiProperty({type:String,nullable:true,format:"date-time"}) finishedAt!: string|null;
  @ApiProperty() cleanupPending!: boolean;
  @ApiProperty({type:ProcessingSpecDto}) spec!: ProcessingSpecDto;
  @ApiProperty({type:[ProcessingArtifactDto]}) artifacts!: ProcessingArtifactDto[];
  @ApiProperty({type:Number,nullable:true}) durationSeconds!: number|null;
  @ApiPropertyOptional() width?: number;
  @ApiPropertyOptional() height?: number;
  @ApiPropertyOptional() sampleRate?: number;
}
