import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConsumptionSections } from '../../.local/tests/client.mjs';

test('consumption sections settle independently so one API failure preserves the successful result', async () => {
  const overview={consumedSeconds:12,consumedMinutes:0.2,reservedSeconds:2,availableSeconds:98};
  const api={overview:async id=>{assert.equal(id,'workspace-1');return overview;},ledger:async()=>{throw new Error('Ledger unavailable');}};
  const [summary,ledger]=await loadConsumptionSections(api,'workspace-1');
  assert.deepEqual(summary,{status:'fulfilled',value:overview});
  assert.equal(ledger.status,'rejected');
  assert.match(ledger.reason.message,/Ledger unavailable/);
});
