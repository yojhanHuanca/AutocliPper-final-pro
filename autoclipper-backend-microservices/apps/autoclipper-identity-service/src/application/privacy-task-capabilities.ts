import {ConflictException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {digest,opaqueToken} from '@autoclipper/http-security';

export type TaskPrivacyScope='media-task-attribution-v1'|'analysis-attribution-v1';
export async function issueTaskPrivacyCapability(client:pg.PoolClient,userId:string,requestId:string,accessToken:string,key:string,correlationId:string,scope:TaskPrivacyScope){
  const request=(await client.query<{kind:string;state:string}>('SELECT kind,state FROM privacy_requests WHERE id=$1 AND user_id=$2 FOR SHARE',[requestId,userId])).rows[0];
  if(!request)throw new NotFoundException();
  if(request.kind!=='export'||!['requested','processing'].includes(request.state))throw new ConflictException({code:'PRIVACY_EXPORT_NOT_PENDING'});
  const accessHash=digest(accessToken),session=(await client.query<{session_id:string}>('SELECT a.session_id FROM access_tokens a JOIN sessions s ON s.id=a.session_id WHERE a.token_hash=$1 AND s.user_id=$2 AND a.expires_at>now() AND s.expires_at>now() AND s.revoked_at IS NULL',[accessHash,userId])).rows[0];
  if(!session)throw new UnauthorizedException();
  const capability=opaqueToken();
  await client.query('INSERT INTO privacy_task_export_capabilities(token_hash,request_id,session_id,access_token_hash,scope,idempotency_key,correlation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval \'30 seconds\')',[digest(capability),requestId,session.session_id,accessHash,scope,key,correlationId]);
  await client.query('INSERT INTO security_audit(id,user_id,action,correlation_id) VALUES($1,$2,$3,$4)',[randomUUID(),userId,scope==='media-task-attribution-v1'?'privacy.media_export_authorized':'privacy.analysis_export_authorized',correlationId]);
  return capability;
}
export async function authorizeTaskPrivacyCapability(pool:pg.Pool,input:{capability:string;scope:TaskPrivacyScope;idempotencyKey:string;correlationId:string}){
  const row=(await pool.query<{user_id:string;request_id:string;scope:TaskPrivacyScope}>(
    `SELECT p.user_id,c.request_id,c.scope FROM privacy_task_export_capabilities c
     JOIN privacy_requests p ON p.id=c.request_id JOIN sessions s ON s.id=c.session_id
     JOIN access_tokens a ON a.token_hash=c.access_token_hash AND a.session_id=s.id
     WHERE c.token_hash=$1 AND c.scope=$2 AND c.idempotency_key=$3 AND c.correlation_id=$4
     AND c.expires_at>now() AND a.expires_at>now() AND s.expires_at>now() AND s.revoked_at IS NULL
     AND s.user_id=p.user_id AND p.kind='export' AND p.state IN ('requested','processing')`,
    [digest(input.capability),input.scope,input.idempotencyKey,input.correlationId])).rows[0];
  if(!row)throw new UnauthorizedException();
  return{userId:row.user_id,requestId:row.request_id,scope:row.scope};
}
