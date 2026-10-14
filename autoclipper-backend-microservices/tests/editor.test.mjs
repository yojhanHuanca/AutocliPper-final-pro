import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorSpec,processingSpec} from '@autoclipper/api-contracts';
import {videoFilter} from '../apps/autoclipper-media-processing-service/dist/domain/video-filter.js';
const base={version:1,kind:'clip',startSeconds:0,endSeconds:4,aspect:'square'};
test('editor descriptions version timelines framing and subtitle sources are strict',()=>{
  assert.equal(editorSpec.parse(base).subtitles.source,'none');
  for(const spec of [{...base,version:2},{...base,endSeconds:200},{...base,startSeconds:5},{...base,framing:{x:1.01,y:0.5}},{...base,aspect:'source',framing:{x:0.5,y:0.5}},{...base,filter:'movie=http://example.test'},{...base,subtitles:{source:'transcript',analysisId:'invalid',cues:[]}},{...base,subtitles:{source:'user',cues:[{startSeconds:0,endSeconds:5,text:'outside'}]}}])assert.equal(editorSpec.safeParse(spec).success,false);
  const parsed=editorSpec.parse({...base,framing:{x:0,y:1},subtitles:{source:'user',cues:[{startSeconds:0,endSeconds:3,text:'Safe caption'}],style:{template:'boxed'}}});assert.equal(parsed.subtitles.style.fontSize,24);assert.equal(parsed.subtitles.style.position,'bottom');
});
test('render options allow only bounded templates and numeric framing, never arbitrary ASS or filters',()=>{
  const captions={provenance:'user',cues:[{startSeconds:0,endSeconds:3,text:'Safe'}]};
  for(const style of [{template:'arbitrary,FontName=unsafe'},{template:'clean',fontSize:999},{template:'clean',position:'center'},{template:'bold',forceStyle:'evil'}])assert.equal(processingSpec.safeParse({...base,subtitles:{...captions,style}}).success,false);
  const clip=processingSpec.parse({...base,framing:{x:1,y:0},subtitles:{...captions,style:{template:'bold',fontSize:30,position:'top'}}});const filter=videoFilter(clip);assert.match(filter,/crop=720:720:\(iw-ow\)\*1:\(ih-oh\)\*0/u);assert.match(filter,/Alignment=6/u);assert.match(filter,/Bold=1/u);assert.match(filter,/PrimaryColour=&H0000FFFF/u);
});
