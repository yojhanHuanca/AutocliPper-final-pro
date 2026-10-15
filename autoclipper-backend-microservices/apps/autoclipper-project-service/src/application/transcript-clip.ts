import {BadRequestException,ConflictException} from "@nestjs/common";
import {internalProcessingSpec,transcriptRenderSpec,type AnalysisStatus} from "@autoclipper/api-contracts";
import {body} from "@autoclipper/http-security";

export function transcriptClip(state:AnalysisStatus,input:unknown){
  const spec=body(transcriptRenderSpec,input);
  if(state.status!=="succeeded"||!state.transcript)throw new ConflictException();
  const times="proposalIndex" in spec?state.selection?.segments[spec.proposalIndex]:spec;
  if(!times)throw new BadRequestException();
  const {startSeconds,endSeconds}=times;
  if(endSeconds-startSeconds<0.1||endSeconds-startSeconds>120||endSeconds>state.transcript.durationSeconds)throw new BadRequestException();
  const cues=state.transcript.segments.filter(segment=>segment.startSeconds<endSeconds&&segment.endSeconds>startSeconds).map(segment=>({startSeconds:Math.max(startSeconds,segment.startSeconds),endSeconds:Math.min(endSeconds,segment.endSeconds),text:Array.from(segment.text.replace(/[<>\\{}]/gu," "),character=>character.charCodeAt(0)<32?" ":character).join("").trim()})).filter(cue=>cue.text&&cue.endSeconds-cue.startSeconds>=0.01);
  if(!cues.length||cues.length>200||cues.some(cue=>cue.text.length>500))throw new BadRequestException();
  const clip=body(internalProcessingSpec,{version:1,kind:"clip",startSeconds,endSeconds,aspect:spec.aspect,subtitles:{provenance:"transcript",transcriptId:state.transcript.id,cues}});
  if(clip.kind!=="clip"||!clip.subtitles||clip.subtitles.provenance!=="transcript")throw new BadRequestException();return{...clip,subtitles:clip.subtitles};
}
