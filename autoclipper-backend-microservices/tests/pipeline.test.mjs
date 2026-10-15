import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pipelineSpec} from '@autoclipper/api-contracts';
test('pipeline admits explicit manual local ASR only, with bounded interval and no arbitrary stages or URLs',()=>{
  const spec={version:1,provider:'whisper_cpp',language:'auto',selection:{mode:'none'},startSeconds:0,endSeconds:8,aspect:'square'};
  assert.equal(pipelineSpec.safeParse(spec).success,true);
  for(const changed of [{provider:'deepgram'},{selection:{mode:'llm'}},{startSeconds:9},{endSeconds:121},{endSeconds:301},{language:'xx'},{url:'https://example.test/video'},{analysisId:'user-controlled'},{aspect:'invalid'}])assert.equal(pipelineSpec.safeParse({...spec,...changed}).success,false,JSON.stringify(changed));
});
