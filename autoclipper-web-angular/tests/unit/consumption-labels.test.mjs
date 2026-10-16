import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumptionKindLabel, consumptionStageLabel, pipelineShortId } from '../../.local/tests/client.mjs';

test('consumption ledger translates known API vocabulary and keeps full IDs available', () => {
  assert.deepEqual(['audio','analysis','render','other'].map(consumptionStageLabel), ['Audio','Transcripción','Renderizado','other']);
  assert.deepEqual(['reserve','consume','release','other'].map(consumptionKindLabel), ['Reserva','Consumo','Liberación','other']);
  assert.equal(pipelineShortId('12345678-1234-1234-1234-123456789abc'),'12345678…9abc');
});
