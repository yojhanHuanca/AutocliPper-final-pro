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
  assert.ok(catalog.outsideSql.some(item=>item.system.includes('Backups')));assert.ok(catalog.outsideSql.some(item=>item.system.includes('Redis')));
});
