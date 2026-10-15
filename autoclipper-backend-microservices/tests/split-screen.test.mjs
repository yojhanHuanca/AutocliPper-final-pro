import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {editorSpec,internalProcessingSpec,processingSpec,splitSourceError} from '@autoclipper/api-contracts';
test('split-screen editing requires bounded explicit layout duration and audio policies',()=>{
  const spec={version:1,kind:'clip',startSeconds:0,endSeconds:3,aspect:'square',splitScreen:{secondaryUploadId:randomUUID(),layout:'side_by_side',primaryRatio:0.4,startSeconds:0,shortInput:'freeze',audio:'primary'}};
  assert.equal(editorSpec.safeParse(spec).success,true);assert.equal(internalProcessingSpec.safeParse(spec).success,true);assert.equal(processingSpec.safeParse(spec).success,false,'Split screen is admitted through versioned editor snapshots only');
  for(const patch of [{aspect:'source'},{splitScreen:{...spec.splitScreen,audio:undefined}},{splitScreen:{...spec.splitScreen,primaryRatio:0.1}},{splitScreen:{...spec.splitScreen,shortInput:'download_external'}},{splitScreen:{...spec.splitScreen,secondaryUploadId:'https://untrusted.invalid/video'}},{splitScreen:{...spec.splitScreen,filters:'movie=secret'}},{splitScreen:{...spec.splitScreen,framing:{x:2,y:0}}}])assert.equal(editorSpec.safeParse({...spec,...patch}).success,false);
  const main={durationSeconds:4,width:640,height:240,audioCodec:'aac'},second={...main,durationSeconds:1};
  assert.equal(splitSourceError(spec,main,second,1000,1000),undefined);assert.equal(splitSourceError({...spec,splitScreen:{...spec.splitScreen,shortInput:'reject'}},main,second,1000,1000),'SECONDARY_TOO_SHORT');assert.equal(splitSourceError(spec,{...main,width:3840},second,1000,1000),'SPLIT_INPUT_LIMIT');assert.equal(splitSourceError(spec,main,second,104857600,1),'SPLIT_INPUT_LIMIT');assert.equal(splitSourceError(spec,{...main,audioCodec:null},second,1000,1000),'NO_SELECTED_AUDIO');assert.equal(splitSourceError({...spec,splitScreen:{...spec.splitScreen,startSeconds:1}},main,second,1000,1000),'SECONDARY_TIMESTAMP_OUT_OF_RANGE');
});
