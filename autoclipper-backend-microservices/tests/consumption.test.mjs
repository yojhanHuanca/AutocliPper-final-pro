import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {usageBudgets,usageReservation,usageReport} from '@autoclipper/api-contracts';
import {BillingService,consumptionPeriod} from '../apps/autoclipper-billing-service/dist/application/billing.service.js';
test('consumption units reserve bounded material seconds, not money or CPU time, and periods use UTC calendar months',()=>{
  assert.deepEqual(usageBudgets({sourceSeconds:13.8,clipSeconds:8}),{audio:15,analysis:15,render:9});
  const period=consumptionPeriod(new Date('2026-12-31T23:59:59Z'));assert.equal(period.start.toISOString(),'2026-12-01T00:00:00.000Z');assert.equal(period.end.toISOString(),'2027-01-01T00:00:00.000Z');
  const reservation={version:1,pipelineId:randomUUID(),workspaceId:randomUUID(),creatorId:randomUUID(),sourceSeconds:13.8,clipSeconds:8};assert.equal(usageReservation.safeParse(reservation).success,true);for(const change of [{sourceSeconds:3601},{clipSeconds:14},{price:1}])assert.equal(usageReservation.safeParse({...reservation,...change}).success,false);
  const report={version:1,eventId:randomUUID(),pipelineId:reservation.pipelineId,workspaceId:reservation.workspaceId,stage:'audio',outcome:'succeeded',actualDurationSeconds:13.8};assert.equal(usageReport.safeParse(report).success,true);for(const change of [{actualDurationSeconds:0},{actualDurationSeconds:3601},{stage:'arbitrary'},{outcome:'cancelled'},{credits:100}])assert.equal(usageReport.safeParse({...report,...change}).success,false);
});

test('a new local MP4 pipeline reserves each material stage and consumes only successful output duration',()=>{
  const reservation={version:1,pipelineId:randomUUID(),workspaceId:randomUUID(),creatorId:randomUUID(),sourceSeconds:13.8,clipSeconds:8};
  const budgets=usageBudgets(reservation);assert.deepEqual(budgets,{audio:15,analysis:15,render:9});
  const reports=[['audio',13.8],['analysis',13.8],['render',8]].map(([stage,actualDurationSeconds])=>({version:1,eventId:randomUUID(),pipelineId:reservation.pipelineId,workspaceId:reservation.workspaceId,stage,outcome:'succeeded',actualDurationSeconds}));
  assert.ok(reports.every(value=>usageReport.safeParse(value).success));
  const reserved=Object.values(budgets).reduce((sum,seconds)=>sum+seconds,0),consumed=reports.reduce((sum,value)=>sum+Math.ceil(value.actualDurationSeconds),0);
  assert.equal(reserved,39);assert.equal(consumed,36);assert.equal(reserved-consumed,3,'unused reservation margin is released after all three successful material stages');
});

test('workspace readers see the configured development quota before the first reservation without a write',async()=>{
  const workspaceId=randomUUID(),reads=[],plan={id:randomUUID(),version:'a'.repeat(64),kind:'development',label:'Local development allocation; not a commercial offer',processing_seconds_per_month:3600,active_pipelines:4};
  const service=Object.create(BillingService.prototype);service.plan=plan;service.authorize=async(_request,id)=>assert.equal(id,workspaceId);service.pool={query:async sql=>{reads.push(sql);assert.match(sql,/^SELECT /);return{rows:[]};}};
  const result=await service.consumption({},workspaceId);
  assert.equal(result.plan.version,plan.version);assert.equal(result.plan.processingSecondsPerMonth,3600);assert.equal(result.availableSeconds,3600);assert.equal(result.consumedSeconds,0);assert.equal(result.reservedSeconds,0);assert.equal(reads.length,2,'quota lookup performs reads only; first reservation persists the entitlement');
});

test('a video just under one hour can reserve and report its actual local processing duration', () => {
  const ids = {pipelineId:randomUUID(),workspaceId:randomUUID()};
  const sourceSeconds = 3244.222;
  const reservation = usageReservation.parse({version:1,...ids,creatorId:randomUUID(),sourceSeconds,clipSeconds:30});
  assert.deepEqual(usageBudgets(reservation), {audio:3245,analysis:3245,render:31});
  assert.equal(usageReport.safeParse({version:1,...ids,eventId:randomUUID(),stage:'analysis',outcome:'succeeded',actualDurationSeconds:sourceSeconds}).success,true);
});
