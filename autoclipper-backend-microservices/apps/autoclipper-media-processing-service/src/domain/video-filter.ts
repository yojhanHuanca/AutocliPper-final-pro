import type {ValidatedProcessingSpec} from "@autoclipper/api-contracts";
type Clip=Extract<ValidatedProcessingSpec,{kind:"clip"}>;
export function videoFilter(spec:Clip){
  const dimensions={vertical:[720,1280],square:[720,720],horizontal:[1280,720]} as const;
  const size=spec.aspect==="source"?undefined:dimensions[spec.aspect],frame=spec.framing??{x:0.5,y:0.5};
  let filter=size?`scale=${size[0]}:${size[1]}:force_original_aspect_ratio=increase,crop=${size[0]}:${size[1]}:(iw-ow)*${frame.x}:(ih-oh)*${frame.y},setsar=1`:"scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
  if(spec.subtitles){
    const style=spec.subtitles.style??{template:"clean",fontSize:24,position:"bottom"};
    const templates={clean:"BorderStyle=1,Outline=2,Shadow=0,Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000",boxed:"BorderStyle=3,Outline=2,Shadow=0,Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000",bold:"BorderStyle=1,Outline=3,Shadow=0,Bold=1,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000"};
    // force_style writes libass internal alignment bits: top(4) | center(2).
    filter+=`,subtitles=filename=captions.srt:force_style='FontName=DejaVu Sans,FontSize=${style.fontSize},Alignment=${style.position==="top"?6:2},MarginV=32,${templates[style.template]}'`;
  }
  return filter;
}
