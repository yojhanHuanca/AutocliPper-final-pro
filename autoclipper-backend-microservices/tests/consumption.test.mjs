import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {usageBudgets,usageReservation,usageReport} from '@autoclipper/api-contracts';
import {consumptionPeriod} from '../apps/autoclipper-billing-service/dist/application/billing.service.js';
test('consumption units reserve bounded material seconds, not money or CPU time, and periods use UTC calendar months',()=>{
  assert.deepEqual(usageBudgets({sourceSeconds:13.8,clipSeconds:8}),{audio:15,analysis:15,render:9});
  const period=consumptionPeriod(new Date('2026-12-31T23:59:59Z'));assert.equal(period.start.toISOString(),'2026-12-01T00:00:00.000Z');assert.equal(period.end.toISOString(),'2027-01-01T00:00:00.000Z');
  const reservation={version:1,pipelineId:randomUUID(),workspaceId:randomUUID(),creatorId:randomUUID(),sourceSeconds:13.8,clipSeconds:8};assert.equal(usageReservation.safeParse(reservation).success,true);for(const change of [{sourceSeconds:301},{clipSeconds:14},{price:1}])assert.equal(usageReservation.safeParse({...reservation,...change}).success,false);
  const report={version:1,eventId:randomUUID(),pipelineId:reservation.pipelineId,workspaceId:reservation.workspaceId,stage:'audio',outcome:'succeeded',actualDurationSeconds:13.8};assert.equal(usageReport.safeParse(report).success,true);for(const change of [{actualDurationSeconds:0},{actualDurationSeconds:301},{stage:'arbitrary'},{outcome:'cancelled'},{credits:100}])assert.equal(usageReport.safeParse({...report,...change}).success,false);
});
