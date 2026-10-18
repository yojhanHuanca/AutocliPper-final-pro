import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {adminGrant,adminPage,adminUsersPage,adminJobsPage,adminReauth} from '@autoclipper/api-contracts';
test('administration contracts require explicit bounded grants and reject private fields or privilege injection',()=>{
  const id=randomUUID(),reference='explicit-unit-fixture';
  assert.equal(adminGrant.safeParse({userId:id,permissions:['jobs.read'],workspaceIds:[id],operatorReference:reference}).success,true);
  for(const patch of [{permissions:['owner']},{workspaceIds:[]},{workspaceIds:Array.from({length:51},randomUUID)},{permissions:['users.read']},{operatorReference:'operator@example.test'},{role:'admin'}])assert.equal(adminGrant.safeParse({userId:id,permissions:['jobs.read'],workspaceIds:[id],operatorReference:reference,...patch}).success,false);
  assert.equal(adminGrant.safeParse({userId:id,permissions:['users.read'],workspaceIds:null,operatorReference:reference}).success,true);
  for(const query of [{limit:51},{beforeId:'1;SELECT'},{scope:'global'},{workspaceIds:[id]}])assert.equal(adminPage.safeParse(query).success,false);
  assert.equal(adminReauth.safeParse({password:'explicit-fixture',factor:'000000',permissions:['users.read']}).success,false);
  const user={id,verified:true,mfaEnabled:false,createdAt:new Date().toISOString()};
  assert.equal(adminUsersPage.safeParse({items:[user],nextBeforeId:null}).success,true);
  for(const key of ['email','name','password_hash','token'])assert.equal(adminUsersPage.safeParse({items:[{...user,[key]:'PRIVATE'}],nextBeforeId:null}).success,false);
  const job={id,workspaceId:id,kind:'analysis',status:'succeeded',createdAt:user.createdAt,finishedAt:user.createdAt,errorCode:null};
  for(const key of ['source','transcript','spec','result','url'])assert.equal(adminJobsPage.safeParse({items:[{...job,[key]:'PRIVATE'}],nextBeforeId:null}).success,false);
});
