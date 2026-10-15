import type {ValidatedProcessingSpec} from "@autoclipper/api-contracts";
import {InspectionError} from "./inspection.js";
import {captionFilter} from "./video-filter.js";
type Clip=Extract<ValidatedProcessingSpec,{kind:"clip"}>;
export function splitScreenPlan(spec:Clip){
  const split=spec.splitScreen;if(!split||spec.aspect==="source")throw new InspectionError("INVALID_SPLIT_SPEC",false);
  const [width,height]={vertical:[720,1280],square:[720,720],horizontal:[1280,720]}[spec.aspect] as [number,number];
  const side=split.layout==="side_by_side",extent=side?width:height,first=2*Math.round(extent*split.primaryRatio/2);
  const mainSize=side?[first,height]:[width,first],secondSize=side?[width-first,height]:[width,height-first],duration=spec.endSeconds-spec.startSeconds;
  const panel=(input:number,size:number[],frame:{x:number;y:number})=>`[${input}:v:0]setpts=PTS-STARTPTS,scale=${size[0]}:${size[1]}:force_original_aspect_ratio=increase,crop=${size[0]}:${size[1]}:(iw-ow)*${frame.x}:(ih-oh)*${frame.y},setsar=1,fps=30`;
  const main=panel(0,mainSize,spec.framing??{x:0.5,y:0.5})+`,trim=duration=${duration}[primary]`;
  const secondary=panel(1,secondSize,split.framing??{x:0.5,y:0.5})+(split.shortInput==="freeze"?`,tpad=stop_mode=clone:stop_duration=${duration}`:"")+`,trim=duration=${duration}[secondary]`;
  const captions=captionFilter(spec),combine=`[primary][secondary]${side?"hstack":"vstack"}=inputs=2:shortest=1[composite];[composite]${captions??"null"}[video]`;
  const audioInput=split.audio==="none"?null:split.audio==="primary"?0:1;
  const audio=audioInput===null?"":`;[${audioInput}:a:0]aresample=48000:async=1:first_pts=0,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[audio]`;
  return{filter:`${main};${secondary};${combine}${audio}`,audioInput,width,height};
}
