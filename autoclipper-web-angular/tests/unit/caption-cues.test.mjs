import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptionCues } from '../../.local/tests/client.mjs';
test('caption edits use absolute source times and preserve user text without mutating the form', () => {
  const form=[{startSeconds:42,endSeconds:44,text:'Una frase con intención.'}];
  const result=validateCaptionCues(form,40,50);assert.deepEqual(result,form);assert.notEqual(result[0],form[0]);
});

test('persisted captions require chronological non-overlapping intervals of at least 0.01 seconds without silently sorting the payload',()=>{
  const overlap=[{startSeconds:40,endSeconds:43,text:'Primera'},{startSeconds:42,endSeconds:44,text:'Superpuesta'}];
  const original=structuredClone(overlap);
  assert.throws(()=>validateCaptionCues(overlap,40,50),/frase 2.*superponerse/);
  assert.throws(()=>validateCaptionCues([...overlap].reverse(),40,50),/orden de tiempo/);
  assert.deepEqual(overlap,original);
  assert.throws(()=>validateCaptionCues([{startSeconds:40,endSeconds:40.005,text:'Muy breve'}],40,50),/0,01/);
  assert.equal(validateCaptionCues([{startSeconds:40,endSeconds:43,text:'Primera'},{startSeconds:43,endSeconds:44,text:'Continúa'}],40,50).length,2);
});
test('empty, overlong and out-of-clip caption edits are rejected with an actionable message', () => {
  assert.throws(()=>validateCaptionCues([],40,50),/Añade/);
  assert.throws(()=>validateCaptionCues([{startSeconds:0,endSeconds:3,text:'Fuera del clip'}],40,50),/frase 1/);
  assert.throws(()=>validateCaptionCues([{startSeconds:42,endSeconds:42,text:'Sin duración'}],40,50),/terminar después/);
  assert.throws(()=>validateCaptionCues([{startSeconds:42,endSeconds:44,text:' '.repeat(3)}],40,50),/caracteres/);
  assert.throws(()=>validateCaptionCues([{startSeconds:42,endSeconds:44,text:'a'.repeat(501)}],40,50),/500/);
});
