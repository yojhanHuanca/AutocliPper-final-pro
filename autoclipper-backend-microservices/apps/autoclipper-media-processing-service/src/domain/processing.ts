import type {ProcessingSpec} from "@autoclipper/api-contracts";
import {InspectionError,type MediaMetadata} from "./inspection.js";

export function validateProcessingSource(spec:ProcessingSpec,metadata:MediaMetadata) {
  if(metadata.width>3840||metadata.height>3840)throw new InspectionError("RENDER_INPUT_LIMIT",false);
  if(spec.kind==="audio"&&!metadata.audioCodec)throw new InspectionError("NO_AUDIO_STREAM",false);
  if(spec.kind==="audio"&&metadata.durationSeconds>3600)throw new InspectionError("AUDIO_DURATION_LIMIT",false);
  if(spec.kind==="clip"&&spec.endSeconds>metadata.durationSeconds)throw new InspectionError("TIMESTAMP_OUT_OF_RANGE",false);
}
function timestamp(seconds:number,separator:string) {
  const value=Math.round(seconds*1000);
  return `${String(Math.floor(value/3600000)).padStart(2,"0")}:${String(Math.floor(value/60000)%60).padStart(2,"0")}:${String(Math.floor(value/1000)%60).padStart(2,"0")}${separator}${String(value%1000).padStart(3,"0")}`;
}
export function subtitles(spec:Extract<ProcessingSpec,{kind:"clip"}>) {
  const cues=spec.subtitles?.cues??[];
  const render=(separator:string)=>cues.map((cue,index)=>`${index+1}\n${timestamp(cue.startSeconds-spec.startSeconds,separator)} --> ${timestamp(cue.endSeconds-spec.startSeconds,separator)}\n${cue.text}\n`).join("\n");
  return {srt:render(","),vtt:`WEBVTT\n\n${render(".")}`};
}
export const outputFiles = ["clip.mp4","audio.wav","captions.srt","captions.vtt"] as const;
export function outputPrefix(workspaceId:string,id:string){return `workspaces/${workspaceId}/media/derivatives/${id}/`;}
