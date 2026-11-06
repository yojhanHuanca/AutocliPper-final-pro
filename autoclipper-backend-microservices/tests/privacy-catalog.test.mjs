import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('privacy inventory classifies every SQL table in all six owners and leaves retention undecided',async()=>{
  const catalog=JSON.parse(await readFile(new URL('../privacy/data-map.json',import.meta.url),'utf8'));
  assert.equal(catalog.retentionPolicy,'undecided');assert.equal(catalog.deletionExecutor,'not-implemented');assert.equal(catalog.services.length,6);
  const applications=await readdir(new URL('../apps/',import.meta.url));
  const mapped=new Set(catalog.services.map(service=>service.application));
  for(const app of applications){
    let files;
    try{files=await readdir(new URL(`../apps/${app}/migrations/`,import.meta.url));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    assert.ok(mapped.has(app),`Data owner missing from privacy inventory: ${app}`);
    const actual=[];
    for(const file of files.filter(file=>file.endsWith('.sql'))){
      const sql=await readFile(new URL(`../apps/${app}/migrations/${file}`,import.meta.url),'utf8');
      for(const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_]+)"?/giu))actual.push(match[1]);
    }
    const service=catalog.services.find(service=>service.application===app),listed=service.groups.flatMap(group=>group.tables);
    assert.equal(listed.length,new Set(listed).size,`${app}: ambiguous table classification`);
    assert.deepEqual([...listed].sort(),[...actual].sort(),`${app}: review new/removed tables and their subject ownership`);
    for(const group of service.groups)for(const field of['subjectPath','projection','blocker'])assert.ok(typeof group[field]==='string'&&group[field].length>0,`${app}: missing privacy decision context`);
  }
  const identity=catalog.services.find(service=>service.application==='autoclipper-identity-service');
  const capabilityTables=['privacy_export_capabilities','privacy_project_export_capabilities','privacy_billing_export_capabilities','privacy_task_export_capabilities'];
  const capabilityGroups=identity.groups.filter(group=>group.tables.some(table=>capabilityTables.includes(table)));
  assert.deepEqual(capabilityGroups.flatMap(group=>group.tables.filter(table=>capabilityTables.includes(table))).sort(),[...capabilityTables].sort());
  assert.ok(capabilityGroups.every(group=>group.projection.includes('reaped in bounded batches by migration 0012')),'catalog must describe implemented capability expiry cleanup');
  assert.ok(capabilityGroups.every(group=>/business retention/i.test(group.blocker)),'technical TTL cleanup must not imply a business retention policy');
  const cleanup=await readFile(new URL('../apps/autoclipper-identity-service/migrations/0012_expired_privacy_capability_cleanup.sql',import.meta.url),'utf8');
  assert.match(cleanup,/SECURITY DEFINER/u);assert.match(cleanup,/FOR UPDATE SKIP LOCKED/u);assert.match(cleanup,/REVOKE ALL ON FUNCTION/u);assert.match(cleanup,/GRANT EXECUTE ON FUNCTION/u);
  const deleteTargets=[...cleanup.matchAll(/DELETE\s+FROM\s+public\.([a-z_]+)/giu)].map(match=>match[1]);
  assert.deepEqual(deleteTargets,capabilityTables,'expiry cleanup may delete only the four short-lived capability tables');
  assert.equal([...cleanup.matchAll(/expires_at\s*<=\s*clock_timestamp\(\)/giu)].length,capabilityTables.length,'every deletion must be gated by capability expiry');
  assert.match(cleanup,/max_rows\s*<\s*1\s+OR\s+max_rows\s*>\s*250/u,'cleanup batch size must remain bounded');
  const identitySource=await readFile(new URL('../apps/autoclipper-identity-service/src/application/identity.service.ts',import.meta.url),'utf8');
  assert.match(identitySource,/reap_expired_privacy_capabilities\(\$1\)/u);assert.match(identitySource,/\},60000\)/u);
  assert.ok(catalog.outsideSql.some(item=>item.system.includes('Backups')));assert.ok(catalog.outsideSql.some(item=>item.system.includes('Redis')));
});
