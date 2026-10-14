import {z} from "zod";
import {transcriptDataSchema,transcriptSegmentSchema} from "@autoclipper/api-contracts";

export class AnalysisError extends Error {
  constructor(readonly code:string,readonly retryable=false,readonly outcomeUnknown=false){super(code);}
}
export const transcriptSegment=transcriptSegmentSchema;
export const transcriptSchema=transcriptDataSchema;
export type Transcript=z.infer<typeof transcriptSchema>;
export function validateTranscript(value:unknown,sourceDuration:number):Transcript {
  const parsed=transcriptSchema.safeParse(value);if(!parsed.success)throw new AnalysisError("INVALID_TRANSCRIPT");
  const result=parsed.data;
  if(Buffer.byteLength(JSON.stringify(result))>750000)throw new AnalysisError("TRANSCRIPT_SIZE_LIMIT");
  if(Math.abs(result.durationSeconds-sourceDuration)>0.5)throw new AnalysisError("TRANSCRIPT_DURATION_MISMATCH");
  let previous=0;
  for(const segment of result.segments){
    if(segment.startSeconds<previous||segment.endSeconds<=segment.startSeconds||segment.endSeconds>sourceDuration+0.5)throw new AnalysisError("TRANSCRIPT_TIME_OUT_OF_RANGE");
    segment.endSeconds=Math.min(segment.endSeconds,sourceDuration);
    if(segment.endSeconds<=segment.startSeconds)throw new AnalysisError("TRANSCRIPT_TIME_OUT_OF_RANGE");
    previous=segment.endSeconds;
    if(!result.diarization&&segment.speaker!==undefined)throw new AnalysisError("UNSUPPORTED_DIARIZATION_RESULT");
  }
  result.durationSeconds=sourceDuration;return result;
}
export interface TranscriptionProvider {
  readonly name:"whisper_cpp"|"deepgram";
  configured():Promise<boolean>;
  transcribe(path:string,durationSeconds:number,language:"auto"|"es"|"en",signal:AbortSignal):Promise<Transcript>;
}
