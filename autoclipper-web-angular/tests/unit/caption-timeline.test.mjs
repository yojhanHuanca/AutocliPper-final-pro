import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyTranscriptCues, layoutCaptionCues, validateCaptionCues } from '../../.local/tests/client.mjs';

test('caption geometry uses clip-relative real times, separates overlaps and keeps the form order untouched', () => {
  const cues=[
    {index:0,startSeconds:14,endSeconds:18,text:'Cruza el final'},
    {index:1,startSeconds:9,endSeconds:12,text:'Cruza el inicio'},
    {index:2,startSeconds:11,endSeconds:13,text:'Se superpone'},
    {index:3,startSeconds:16,endSeconds:17,text:'Fuera'},
    {index:4,startSeconds:NaN,endSeconds:12,text:'Sin tiempo'},
    {index:5,startSeconds:12,endSeconds:12,text:'Sin duración'},
  ];
  const original=structuredClone(cues);
  const layout=layoutCaptionCues(cues,10,16);
  assert.deepEqual(layout.map(cue=>cue.index),[1,2,0]);
  assert.equal(layout[0].left,0);
  assert.equal(layout[0].startSeconds,9,'Geometry clipping must not rewrite source timestamps.');
  assert.equal(layout[0].row,0);assert.equal(layout[1].row,1);assert.equal(layout[2].row,0);
  for (const cue of layout) {assert.ok(cue.left>=0);assert.ok(cue.width>0);assert.ok(cue.left+cue.width<=100);}
  assert.deepEqual(cues,original);
  assert.deepEqual(layoutCaptionCues(cues,16,10),[]);
  assert.deepEqual(layoutCaptionCues(cues,NaN,16),[]);
});

test('editable transcript copies intersect the clip, preserve text and never truncate or mutate the source', () => {
  const source=[{startSeconds:8,endSeconds:10,text:'Solo antes'},{startSeconds:9,endSeconds:11,text:'Inicio'},{startSeconds:11,endSeconds:14,text:'Centro'},{startSeconds:15,endSeconds:18,text:'Final'},{startSeconds:16,endSeconds:19,text:'Solo después'}];
  const original=structuredClone(source);
  assert.deepEqual(copyTranscriptCues(source,10,16),[
    {startSeconds:10,endSeconds:11,text:'Inicio'},
    {startSeconds:11,endSeconds:14,text:'Centro'},
    {startSeconds:15,endSeconds:16,text:'Final'},
  ]);
  assert.deepEqual(source,original);
  assert.throws(()=>copyTranscriptCues(source,20,25),/No hay frases/);
  assert.throws(()=>copyTranscriptCues(source,16,10),/Corrige/);
  assert.throws(()=>copyTranscriptCues([{startSeconds:0,endSeconds:Infinity,text:'Inválido'}],0,1),/inválidos/);
  assert.throws(()=>copyTranscriptCues(Array.from({length:201},(_,index)=>({startSeconds:index/100,endSeconds:index/100+.1,text:'Una frase'})),0,5),/200/);
});

test('manual captions reject nonfinite bounds, reversed times and markup before persistence', () => {
  for(const times of [[NaN,12],[10,Infinity],[11,11],[12,11],[9,12],[10,17]])
    assert.throws(()=>validateCaptionCues([{startSeconds:times[0],endSeconds:times[1],text:'Frase'}],10,16),/tiempos/);
  for(const text of ['<b>Texto</b>','{texto}','\\N','Un\ttab','Un\u0000control'])
    assert.throws(()=>validateCaptionCues([{startSeconds:10,endSeconds:12,text}],10,16),/texto simple/);
  assert.throws(()=>validateCaptionCues([{startSeconds:10,endSeconds:12,text:'Frase'}],NaN,16),/tiempos/);
  assert.equal(validateCaptionCues([{startSeconds:10,endSeconds:12,text:'Línea uno\nLínea dos'}],10,16)[0].text,'Línea uno\nLínea dos');
});
