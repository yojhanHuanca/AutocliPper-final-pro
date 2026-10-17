import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackWindow, renderedCaptionCues } from '../../.local/tests/client.mjs';

const entries=[
  {index:3,startSeconds:9,endSeconds:12,text:'Cruza el inicio'},
  {index:4,startSeconds:11,endSeconds:13,text:'Superpuesta'},
  {index:5,startSeconds:15,endSeconds:18,text:'Cruza el final'},
  {index:6,startSeconds:20,endSeconds:21,text:'Fuera'},
];
const spec={version:1,kind:'clip',startSeconds:10,endSeconds:16,subtitles:{provenance:'transcript',cues:entries.slice(0,3).map(cue=>({...cue,startSeconds:Math.max(10,cue.startSeconds),endSeconds:Math.min(16,cue.endSeconds)}))}};

test('rendered cues map source times to clip time without mutating data or dropping overlaps',()=>{
  const original=structuredClone({entries,spec});
  assert.deepEqual(playbackWindow(spec,6.04),{start:10,end:16,duration:6});
  assert.deepEqual(renderedCaptionCues(entries,spec,6),[
    {index:3,from:0,to:2},{index:4,from:1,to:3},{index:5,from:5,to:6},
  ]);
  assert.deepEqual({entries,spec},original);
  const last=renderedCaptionCues(entries,spec,5.96).at(-1);
  assert.equal(last.from,5);assert.ok(Math.abs(last.to-5.96)<1e-10);
});

test('missing, invalid or incompatible media metadata never supplies a playback window',()=>{
  for(const duration of [null,NaN,Infinity,0,-1,8]) assert.equal(playbackWindow(spec,duration),null);
  for(const value of [undefined,{...spec,kind:'audio'},{...spec,startSeconds:NaN},{...spec,startSeconds:-1},{...spec,endSeconds:10},{...spec,endSeconds:131}])
    assert.equal(playbackWindow(value,6),null);
  assert.deepEqual(renderedCaptionCues(entries,undefined,6),[]);
});

test('only cues actually present in the immutable render are linked; invalid cues cannot create seeks',()=>{
  assert.deepEqual(renderedCaptionCues([{...entries[0],text:'Otro texto'},{...entries[1],startSeconds:NaN},{...entries[2],endSeconds:14}],spec,6),[]);
  assert.deepEqual(renderedCaptionCues(entries,{...spec,subtitles:undefined},6),[]);
});
