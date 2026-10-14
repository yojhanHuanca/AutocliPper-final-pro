import {selectionOutput,type AnalysisSpec} from "@autoclipper/api-contracts";
import {AnalysisError,type Transcript} from "./transcript.js";
export function validateSelection(value:unknown,transcript:Transcript,spec:Extract<AnalysisSpec["selection"],{mode:"llm"}>) {
  const parsed=selectionOutput.safeParse(value);if(!parsed.success||parsed.data.segments.length!==spec.count)throw new AnalysisError("INVALID_SEGMENT_SELECTION");
  let previous=0;
  for(const segment of parsed.data.segments){
    const duration=segment.endSeconds-segment.startSeconds;
    if(segment.startSeconds<previous||segment.endSeconds>transcript.durationSeconds||duration<spec.minSeconds||duration>spec.maxSeconds)throw new AnalysisError("INVALID_SEGMENT_TIME");
    if(!transcript.segments.some(cue=>segment.startSeconds>=cue.startSeconds&&segment.startSeconds<cue.endSeconds)||!transcript.segments.some(cue=>segment.endSeconds>cue.startSeconds&&segment.endSeconds<=cue.endSeconds+0.001))throw new AnalysisError("SEGMENT_OUTSIDE_TRANSCRIPT");
    previous=segment.endSeconds;
  }
  return parsed.data;
}
