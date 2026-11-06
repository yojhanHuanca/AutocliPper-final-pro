import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cookieName,digest} from '@autoclipper/http-security';
import {IdentityService} from '../apps/autoclipper-identity-service/dist/application/identity.service.js';

const ownerId='0c71c343-b530-49a9-959a-3915cdb96764';
const otherId='32e9f34a-d65c-4af6-8105-f246f5b98827';
const requestId='390d0e90-83c0-4cf6-8eaf-7b627625fef5';
const correlationId='fa9cfe11-9bf9-42c1-8d29-cae62f81f301';
const createdAt=new Date('2026-10-29T12:00:00.000Z');
const ownerToken='owner-status-fixture-token'.padEnd(43,'a');
const otherToken='other-status-fixture-token'.padEnd(43,'b');

function fixture(records){
  const tokenOwners=new Map([
    [digest(ownerToken),{id:ownerId,email:'owner@example.test',name:'Owner fixture'}],
    [digest(otherToken),{id:otherId,email:'other@example.test',name:'Other fixture'}],
  ]);
  const lookups=[],audits=[];let connections=0;
  const client={
    async query(sql,values=[]){
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
      if(sql.startsWith('SELECT id,state,created_at FROM privacy_requests')){
        lookups.push({sql,values});
        const row=records.find(value=>value.id===values[0]&&value.user_id===values[1]&&value.kind==='deletion');
        return{rows:row?[{id:row.id,state:row.state,created_at:row.created_at}]:[]};
      }
      if(sql.startsWith('INSERT INTO security_audit')){audits.push({sql,values});return{rows:[]};}
      throw new Error(`Unexpected client query: ${sql}`);
    },
    release(){},
  };
  const service=Object.create(IdentityService.prototype);
  service.pool={
    async query(sql,values=[]){
      if(sql.includes('FROM access_tokens a')){const user=tokenOwners.get(values[0]);return{rows:user?[user]:[]};}
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect(){connections++;return client;},
  };
  const request=token=>({headers:{cookie:`${cookieName('access')}=${token}`},res:{locals:{correlationId}}});
  return{service,request,lookups,audits,get connections(){return connections;}};
}

test('owner can read an audited deletion status that explicitly remains pending',async()=>{
  const f=fixture([{id:requestId,user_id:ownerId,kind:'deletion',state:'requested',created_at:createdAt,internal_note:'fixture-only internal note',token:'fixture-only secret'}]);
  const result=await f.service.privacyDeletionStatus(f.request(ownerToken),requestId);
  assert.deepEqual(result,{id:requestId,kind:'deletion',requestState:'requested',fulfillment:'pending',purgeCompleted:false,deletionExecutor:'not_implemented',createdAt:createdAt.toISOString()});
  assert.equal(f.lookups.length,1);
  assert.match(f.lookups[0].sql,/id=\$1 AND user_id=\$2 AND kind='deletion'/);
  assert.deepEqual(f.lookups[0].values,[requestId,ownerId]);
  assert.equal(f.audits.length,1);
  assert.equal(f.audits[0].values[1],ownerId);
  assert.equal(f.audits[0].values[2],'privacy.deletion_status_viewed');
  assert.equal(f.audits[0].values[3],correlationId);
  assert.equal(JSON.stringify(result).includes('internal_note'),false);
  assert.equal(JSON.stringify(result).includes('fixture-only'),false);
});

test('anonymous and other-user requests cannot read a deletion status',async()=>{
  const f=fixture([{id:requestId,user_id:ownerId,kind:'deletion',state:'requested',created_at:createdAt}]);
  await assert.rejects(f.service.privacyDeletionStatus({headers:{cookie:''}},requestId),error=>error.getStatus?.()===401);
  await assert.rejects(f.service.privacyDeletionStatus(f.request(otherToken),requestId),error=>error.getStatus?.()===404);
  assert.equal(f.lookups.length,1);
  assert.deepEqual(f.lookups[0].values,[requestId,otherId]);
  assert.equal(f.audits.length,0);
  assert.equal(f.connections,1);
});

test('status endpoint does not disclose an own export request as a deletion',async()=>{
  const f=fixture([{id:requestId,user_id:ownerId,kind:'export',state:'requested',created_at:createdAt}]);
  await assert.rejects(f.service.privacyDeletionStatus(f.request(ownerToken),requestId),error=>error.getStatus?.()===404);
  assert.equal(f.audits.length,0);
});
