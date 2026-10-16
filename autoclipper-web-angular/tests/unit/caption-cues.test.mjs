import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptionCues } from '../../.local/tests/client.mjs';
test('caption edits use absolute source times and preserve user text without mutating the form', () => {
  const form=[{startSeconds:42,endSeconds:44,text:'Una frase con intención.'}];
  const result=validateCaptionCues(form,40,50);assert.deepEqual(result,form);assert.notEqual(result[0],form[0]);
});
test('empty, overlong and out-of-clip caption edits are rejected with an actionable message', () => {
  assert.throws(()=>validateCaptionCues([],40,50),/Añade/);
  assert.throws(()=>validateCaptionCues([{startSeconds:0,endSeconds:3,text:'Fuera del clip'}],40,50),/frase 1/);
  assert.throws(()=>validateCaptionCues([{startSeconds:42,endSeconds:42,text:'Sin duración'}],40,50),/terminar después/);
  assert.throws(()=>validateCaptionCues([{startSeconds:42,endSeconds:44,text:' '.repeat(3)}],40,50),/caracteres/);
  assert.throws(()=>validateCaptionCues([{startSeconds:42,endSeconds:44,text:'a'.repeat(501)}],40,50),/500/);
});
