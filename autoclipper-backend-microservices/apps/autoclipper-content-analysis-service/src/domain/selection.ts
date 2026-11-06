import {createHash} from "node:crypto";
import {selectionOutput,type AnalysisSpec,type LocalSelectionSpec,type SegmentProposal} from "@autoclipper/api-contracts";
import {AnalysisError,type Transcript} from "./transcript.js";

const LOCAL_ALGORITHM="deterministic-window-v1";
export const LOCAL_SELECTION_REVISION=createHash("sha256").update(LOCAL_ALGORITHM).digest("hex");

type AutomaticSelection=Extract<AnalysisSpec["selection"],{mode:"llm"|"local"}>;

export function selectLocalSegments(transcript:Transcript,spec:LocalSelectionSpec){
  const duration=transcript.durationSeconds,band=duration/spec.count,clipDuration=Math.min(spec.maxSeconds,band);
  if(spec.minSeconds*spec.count>duration||clipDuration<spec.minSeconds)throw new AnalysisError("INVALID_SELECTION_REQUEST");
  const segments:SegmentProposal[]=Array.from({length:spec.count},(_,index)=>{
    const startSeconds=index*band+(band-clipDuration)/2,endSeconds=startSeconds+clipDuration;
    const excerpt=transcript.segments.filter(cue=>cue.endSeconds>startSeconds&&cue.startSeconds<endSeconds).map(cue=>cue.text).join(" ").replace(/\p{Cc}/gu," ").replace(/\s+/gu," ").trim().slice(0,150);
    return{startSeconds,endSeconds,title:excerpt||`Extracto local ${index+1}`,description:"Ventana de transcripción elegida localmente por distribución temporal.",hashtags:[],explanation:"Selección determinista equidistante; no usa un modelo generativo ni estima viralidad."};
  });
  return{segments,provider:"local" as const,model:LOCAL_ALGORITHM,revision:LOCAL_SELECTION_REVISION,promptVersion:"segment-selection-local-v1" as const,usage:{inputTokens:0 as const,outputTokens:0 as const},estimatedExternalCostUsd:0 as const};
}

export function validateSelection(value:unknown,transcript:Transcript,spec:AutomaticSelection){
  const parsed=selectionOutput.safeParse(value);if(!parsed.success||parsed.data.segments.length!==spec.count)throw new AnalysisError("INVALID_SEGMENT_SELECTION");
  let previous=0;
  for(const segment of parsed.data.segments){
    const duration=segment.endSeconds-segment.startSeconds;
    if(segment.startSeconds<previous-1e-9||segment.endSeconds>transcript.durationSeconds+1e-9||duration<spec.minSeconds-1e-9||duration>spec.maxSeconds+1e-9)throw new AnalysisError("INVALID_SEGMENT_TIME");
    if(spec.mode==="llm"&&(!transcript.segments.some(cue=>segment.startSeconds>=cue.startSeconds&&segment.startSeconds<cue.endSeconds)||!transcript.segments.some(cue=>segment.endSeconds>cue.startSeconds&&segment.endSeconds<=cue.endSeconds+0.001)))throw new AnalysisError("SEGMENT_OUTSIDE_TRANSCRIPT");
    previous=segment.endSeconds;
  }
  return parsed.data;
}
