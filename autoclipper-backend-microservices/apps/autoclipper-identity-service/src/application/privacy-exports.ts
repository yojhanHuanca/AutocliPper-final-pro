import { ConflictException, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { privacyIdentityProfile, privacyProfileExport } from '@autoclipper/api-contracts';
import { body, digest } from '@autoclipper/http-security';

// A contribution from this data owner, not fulfillment of the global request.
// Only receipt hashes and audit metadata persist; no second PII artifact is kept.
export async function preparePrivacyProfile(client:pg.PoolClient,userId:string,requestId:string,key:string,correlationId:string){
  const request=(await client.query<{kind:string;state:string}>('SELECT kind,state FROM privacy_requests WHERE id=$1 AND user_id=$2 FOR UPDATE',[requestId,userId])).rows[0];
  if(!request)throw new NotFoundException();
  if(request.kind!=='export'||!['requested','processing'].includes(request.state))throw new ConflictException({code:'PRIVACY_EXPORT_NOT_PENDING'});
  const source=(await client.query<{id:string;email:string;name:string;created_at:Date;verified_at:Date|null;profile_version:number;preferences:unknown;mfa_enabled:boolean;external_identities:unknown}>(
    `SELECT u.id,u.email,u.name,u.created_at,u.verified_at,u.profile_version,u.preferences,
      coalesce(m.enabled,false) AS mfa_enabled,
      coalesce((SELECT jsonb_agg(jsonb_build_object('provider',e.provider,'subject',e.subject,'providerEmail',e.provider_email,'linkedAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY e.provider) FROM external_identities e WHERE e.user_id=u.id),'[]'::jsonb) AS external_identities
      FROM users u LEFT JOIN user_mfa m ON m.user_id=u.id WHERE u.id=$1`,[userId])).rows[0];
  if(!source)throw new NotFoundException();
  const data=body(privacyIdentityProfile,{schemaVersion:1,user:{id:source.id,email:source.email,name:source.name,createdAt:source.created_at.toISOString(),verifiedAt:source.verified_at?.toISOString()??null,profileVersion:source.profile_version,preferences:source.preferences,mfaEnabled:source.mfa_enabled},externalIdentities:source.external_identities});
  const sha256=digest(JSON.stringify(data));
  type Receipt={id:string;content_sha256:string;created_at:Date};
  let receipt=(await client.query<Receipt>('SELECT id,content_sha256,created_at FROM privacy_export_receipts WHERE request_id=$1 AND idempotency_key=$2',[requestId,key])).rows[0];
  const action=receipt?(receipt.content_sha256===sha256?'replayed':'snapshot_changed'):'prepared';
  if(!receipt)receipt=(await client.query<Receipt>("INSERT INTO privacy_export_receipts(id,request_id,idempotency_key,scope,content_sha256) VALUES($1,$2,$3,'identity-profile-v1',$4) RETURNING id,content_sha256,created_at",[randomUUID(),requestId,key,sha256])).rows[0]!;
  await client.query('INSERT INTO privacy_export_audit(id,receipt_id,actor_user_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),receipt.id,userId,action,correlationId]);
  // Return the conflict marker so the caller commits its audit and factor use
  // before returning 409. Never change or silently replace an earlier receipt.
  if(action==='snapshot_changed')return {changed:true as const};
  return {changed:false as const,value:body(privacyProfileExport,{requestId,receiptId:receipt.id,scope:'identity-profile-v1',state:'prepared',fulfillment:'partial',globalFulfillment:'pending',createdAt:receipt.created_at.toISOString(),sha256,data})};
}
