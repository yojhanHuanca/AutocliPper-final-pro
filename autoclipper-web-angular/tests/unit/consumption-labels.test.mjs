import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumptionKindLabel, consumptionPlanLabel, consumptionQuotaProgress, consumptionQuotaTotal, consumptionStageLabel, pipelineShortId } from '../../.local/tests/client.mjs';

test('consumption ledger translates known API vocabulary and keeps full IDs available', () => {
  assert.deepEqual(['audio','analysis','render','other'].map(consumptionStageLabel), ['Audio','Transcripción','Renderizado','other']);
  assert.deepEqual(['reserve','consume','release','other'].map(consumptionKindLabel), ['Reserva','Consumo','Liberación','other']);
  assert.equal(pipelineShortId('12345678-1234-1234-1234-123456789abc'),'12345678…9abc');
});

test('consumption explains the local development allocation and its period balance', () => {
  const usage = { consumedSeconds: 3, reservedSeconds: 0, availableSeconds: 3597 };
  assert.equal(consumptionPlanLabel({kind:'development',label:'Local development allocation; not a commercial offer'}), 'Asignación local de desarrollo');
  assert.equal(consumptionPlanLabel(null), 'Sin asignación de desarrollo');
  assert.equal(consumptionQuotaTotal(usage), 3600);
  assert.ok(Math.abs(consumptionQuotaProgress(usage) - 3 / 36) < 1e-12);
  assert.equal(consumptionQuotaProgress({consumedSeconds:5000,reservedSeconds:10,availableSeconds:0}), 100);
  assert.equal(consumptionQuotaProgress({consumedSeconds:0,reservedSeconds:0,availableSeconds:0}), 0);
});
