import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumptionKindLabel, consumptionLedgerEmptyStateMessage, consumptionLedgerKindCount, consumptionLedgerStageCount, consumptionPlanLabel, consumptionQuotaProgress, consumptionQuotaTotal, consumptionStageLabel, filterLedger, filterLedgerByStage, pipelineShortId } from '../../.local/tests/client.mjs';

test('consumption ledger translates known API vocabulary and keeps full IDs available', () => {
  assert.deepEqual(['audio','analysis','render','other'].map(consumptionStageLabel), ['Audio','Transcripción','Renderizado','other']);
  assert.deepEqual(['reserve','consume','release','other'].map(consumptionKindLabel), ['Reserva','Consumo','Liberación','other']);
  assert.equal(pipelineShortId('12345678-1234-1234-1234-123456789abc'),'12345678…9abc');
});

test('stage filters organize only the ledger entries already returned by the API', () => {
  const entries = [{ id: 'a', stage: 'audio' }, { id: 'b', stage: 'analysis' }, { id: 'c', stage: 'render' }, { id: 'd', stage: 'audio' }];
  assert.deepEqual(filterLedgerByStage(entries, 'audio'), [entries[0], entries[3]]);
  assert.deepEqual(filterLedgerByStage(entries, 'analysis'), [entries[1]]);
  assert.deepEqual(filterLedgerByStage(entries, 'render'), [entries[2]]);
  assert.deepEqual(filterLedgerByStage(entries, 'all'), entries);
  assert.equal(consumptionLedgerStageCount(entries, 'audio'), 2);
  assert.equal(consumptionLedgerStageCount(entries, 'all'), 4);
  assert.equal(consumptionLedgerStageCount([], 'audio'), 0, 'Counts describe loaded ledger rows only; they do not fabricate a stage total.');
});

test('ledger stage and movement filters combine without implying historical totals', () => {
  const entries = [
    { id: 'a', stage: 'audio', kind: 'reserve' },
    { id: 'b', stage: 'audio', kind: 'consume' },
    { id: 'c', stage: 'analysis', kind: 'release' },
    { id: 'd', stage: 'render', kind: 'reserve' },
  ];
  assert.deepEqual(filterLedger(entries, 'audio', 'consume'), [entries[1]]);
  assert.deepEqual(filterLedger(entries, 'all', 'reserve'), [entries[0], entries[3]]);
  assert.equal(consumptionLedgerKindCount(entries, 'release'), 1);
  assert.equal(consumptionLedgerKindCount([], 'all'), 0);
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

test('versioned development limits come from the assigned plan and include reserved usage in progress', () => {
  const usage = {
    consumedSeconds: 25,
    reservedSeconds: 15,
    availableSeconds: 10,
    plan: { kind: 'development', processingSecondsPerMonth: 100, activePipelines: 4, version: 'digest-v2' },
  };
  assert.equal(consumptionQuotaTotal(usage), 100);
  assert.equal(consumptionQuotaProgress(usage), 40);
});

test('ledger empty state does not repeat the alert when an empty page failed', () => {
  assert.equal(consumptionLedgerEmptyStateMessage(true,false,true),'Consultando movimientos…');
  assert.equal(consumptionLedgerEmptyStateMessage(false,true,false),'Sin acceso confirmado a los movimientos.');
  assert.equal(consumptionLedgerEmptyStateMessage(false,false,true),null,'The alert is the only error announcement.');
  assert.equal(consumptionLedgerEmptyStateMessage(false,false,false),'No hay movimientos registrados en este espacio.');
  assert.equal(consumptionLedgerEmptyStateMessage(false,false,false,false,false),'Consultando espacios…');
  assert.equal(consumptionLedgerEmptyStateMessage(false,false,false,false,true),'No hay espacios disponibles para consultar.');
  assert.equal(consumptionLedgerEmptyStateMessage(false,false,false,false,true,true),'Selecciona un espacio de trabajo en la barra lateral para consultar sus movimientos.');
});
