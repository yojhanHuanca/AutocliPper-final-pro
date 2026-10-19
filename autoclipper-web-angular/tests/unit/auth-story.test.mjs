import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_STORY_ACCENTS, AUTH_STORY_SCENES, createAuthStoryCycle } from '../../.local/tests/client.mjs';

test('login story has five concrete, honest stages and coordinated accents', () => {
  assert.deepEqual(AUTH_STORY_SCENES.map(({ label }) => label), [
    'Sube tu grabación', 'Transcribe y busca', 'Elige el momento', 'Ajusta el encuadre', 'Exporta tu clip',
  ]);
  assert.equal(AUTH_STORY_ACCENTS.length, AUTH_STORY_SCENES.length);
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const accent of AUTH_STORY_ACCENTS) assert.ok(1.05 / (luminance(accent) + .05) >= 4.5, accent);
  for (const accent of AUTH_STORY_ACCENTS) {
    const [red, green, blue] = accent.slice(1).match(/../g).map(value => parseInt(value, 16));
    assert.ok(blue > red && blue > green, `${accent} stays in the approved cobalt family`);
  }
  assert.ok(AUTH_STORY_SCENES[0].file.endsWith('.mp4'));
  assert.match(AUTH_STORY_SCENES[2].micro, /MANUAL/);
  assert.match(AUTH_STORY_SCENES[4].cue, /privada/);
});

test('login story advances every three seconds, pauses, resets for reduced motion and disposes its timer', () => {
  let tick; let active = 0; let index = 0;
  const cycle = createAuthStoryCycle(() => index, value => index = value, (callback, ms) => {
    assert.equal(ms, 3000); tick = callback; active++;
    return () => active--;
  });

  cycle.configure(false, false);
  tick(); assert.equal(index, 1);
  index = 4; tick(); assert.equal(index, 0);
  cycle.configure(true, false); assert.equal(active, 0);
  index = 2;
  cycle.configure(false, true); assert.equal(active, 0); assert.equal(index, 0);
  cycle.configure(false, false); assert.equal(active, 1);
  cycle.destroy(); assert.equal(active, 0);
  cycle.configure(false, false); assert.equal(active, 0);
});
