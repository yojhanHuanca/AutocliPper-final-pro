import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privacyProfileProof, privacyIdentityProfile, privacyProfileExport,privacyWorkspaceOwnerRequest,privacyWorkspaceAuthorityRequest,privacyWorkspaceData } from '@autoclipper/api-contracts';

test('privacy contribution proof cannot select a different user, scope, state or stored artifact',()=>{
  assert.equal(privacyProfileProof.safeParse({password:'proof',factor:'123456'}).success,true);
  for(const extra of [{userId:randomUUID()},{scope:'all'},{state:'completed'},{artifactUrl:'https://example.test/private'}])assert.equal(privacyProfileProof.safeParse({password:'proof',...extra}).success,false);
  assert.equal(privacyProfileProof.safeParse({password:'proof',factor:'arbitrary-token'}).success,false);
});

test('Workspace privacy authority is narrow and membership ownership cannot be forged from a creator field',()=>{
  const request={capability:'a'.repeat(43),idempotencyKey:randomUUID(),correlationId:randomUUID()};
  assert.equal(privacyWorkspaceOwnerRequest.safeParse(request).success,true);
  for(const extra of[{userId:randomUUID()},{requestId:randomUUID()},{workspaceIds:[randomUUID()]},{scope:'all'}])assert.equal(privacyWorkspaceOwnerRequest.safeParse({...request,...extra}).success,false);
  assert.equal(privacyWorkspaceAuthorityRequest.safeParse({...request,scope:'workspace-memberships-v1'}).success,true);
  assert.equal(privacyWorkspaceAuthorityRequest.safeParse({...request,scope:'identity-profile-v1'}).success,false);
  const membership={workspaceId:randomUUID(),kind:'team',role:'reader',isOwner:false,workspaceCreatedAt:new Date().toISOString(),joinedAt:new Date().toISOString()};
  const data={schemaVersion:1,subjectId:randomUUID(),memberships:[membership]};
  assert.equal(privacyWorkspaceData.safeParse(data).success,true);
  for(const extra of[{isOwner:true},{creatorId:data.subjectId},{name:'shared-team'},{ownerEmail:'peer@example.test'}])assert.equal(privacyWorkspaceData.safeParse({...data,memberships:[{...membership,...extra}]}).success,false);
  assert.equal(privacyWorkspaceData.safeParse({...data,memberships:Array.from({length:501},()=>membership)}).success,false);
});
test('partial identity export is bounded and refuses credentials, global completion and unrelated content',()=>{
  const data={schemaVersion:1,user:{id:randomUUID(),email:'fixture@example.test',name:'Fixture',createdAt:new Date().toISOString(),verifiedAt:null,profileVersion:1,preferences:{locale:'es',timezone:'America/Lima',emailNotifications:true,theme:'system'},mfaEnabled:false},externalIdentities:[]};
  assert.equal(privacyIdentityProfile.safeParse(data).success,true);
  for(const secret of['passwordHash','mfaSecret','sessions','adminGrants','recoveryCodes'])assert.equal(privacyIdentityProfile.safeParse({...data,user:{...data.user,[secret]:'forbidden'}}).success,false);
  const receipt={requestId:randomUUID(),receiptId:randomUUID(),scope:'identity-profile-v1',state:'prepared',fulfillment:'partial',globalFulfillment:'pending',createdAt:new Date().toISOString(),sha256:'a'.repeat(64),data};
  assert.equal(privacyProfileExport.safeParse(receipt).success,true);
  for(const extra of[{globalFulfillment:'completed'},{fulfillment:'completed'},{scope:'all-services'},{data:{...data,workspaceVideos:['private']}}])assert.equal(privacyProfileExport.safeParse({...receipt,...extra}).success,false);
});
