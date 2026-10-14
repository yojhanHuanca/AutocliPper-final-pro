import {test} from "node:test";
import assert from "node:assert/strict";
import {processingSpec} from "@autoclipper/api-contracts";
import {subtitles,validateProcessingSource} from "../apps/autoclipper-media-processing-service/dist/domain/processing.js";
const spec={version:1,kind:"clip",startSeconds:10,endSeconds:12,aspect:"vertical",subtitles:{provenance:"user",cues:[{startSeconds:10.2,endSeconds:11,text:"Explicit user text"}]}};
test("processing specs reject unsafe text, invalid spans, unknown versions and non-user subtitle provenance",()=>{
  assert.ok(processingSpec.safeParse(spec).success);
  for(const invalid of [{...spec,version:2},{...spec,endSeconds:10},{...spec,endSeconds:131},{...spec,subtitles:{provenance:"ai",cues:spec.subtitles.cues}},{...spec,subtitles:{provenance:"user",cues:[{startSeconds:9,endSeconds:11,text:"Before range"}]}},{...spec,subtitles:{provenance:"user",cues:[{startSeconds:10,endSeconds:11,text:"{\\pos(0,0)}injection"}]}},{...spec,url:"http://attacker.test"}])assert.equal(processingSpec.safeParse(invalid).success,false);
  const text=subtitles(processingSpec.parse(spec));
  assert.match(text.srt,/00:00:00,200 --> 00:00:01,000/);
  assert.match(text.vtt,/WEBVTT\n\n1\n00:00:00\.200 --> 00:00:01\.000/);
});
test("processing source validation refuses out-of-range clips, audio-free sources and oversized input",()=>{
  const metadata={durationSeconds:11,format:"mp4",width:320,height:240,videoCodec:"h264",audioCodec:null};
  assert.throws(()=>validateProcessingSource(processingSpec.parse(spec),metadata),error=>error.code==="TIMESTAMP_OUT_OF_RANGE");
  assert.throws(()=>validateProcessingSource({version:1,kind:"audio"},metadata),error=>error.code==="NO_AUDIO_STREAM");
  assert.throws(()=>validateProcessingSource({...spec,endSeconds:11},{...metadata,width:7680}),error=>error.code==="RENDER_INPUT_LIMIT");
});
