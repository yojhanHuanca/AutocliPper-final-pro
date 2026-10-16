import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccentCycle, LANDING_ACCENTS } from '../../.local/tests/client.mjs';

test('landing cycles every three seconds, pauses, reduces motion and disposes its timer', () => {
  let tick; let active = 0; let index = 0;
  const cycle = createAccentCycle(value => index = value, (callback, ms) => {
    assert.equal(ms, 3000); tick = callback; active++;
    return () => active--;
  });
  cycle.configure(false, false);
  tick(); assert.equal(index, 1);
  tick(); assert.equal(index, 2);
  tick(); assert.equal(index, 0);
  cycle.configure(true, false); assert.equal(active, 0);
  cycle.configure(false, false); tick(); assert.equal(index, 1);
  cycle.configure(false, true); assert.equal(active, 0); assert.equal(index, 0);
  cycle.configure(false, false); assert.equal(active, 1);
  cycle.destroy(); assert.equal(active, 0);
  cycle.configure(false, false); assert.equal(active, 0);
});

test('all landing accent and hover colors support white normal text', () => {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const accent of LANDING_ACCENTS) for (const color of [accent.color, accent.hover]) {
    assert.ok(1.05 / (luminance(color) + .05) >= 4.5, color);
  }
});
