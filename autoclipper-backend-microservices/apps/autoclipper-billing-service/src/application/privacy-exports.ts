import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {body,digest} from '@autoclipper/http-security';
import {privacyBillingData,privacyBillingExport} from '@autoclipper/api-contracts';

export async function prepareBillingExport(pool:pg.Pool,userId:string,requestId:string,key:string,correlationId:string){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`privacy-billing:${userId}`]);
    const source=(await client.query<{captured_at:Date;reservations:unknown[];movements:unknown[]}>(
      `SELECT statement_timestamp() AS captured_at,
       coalesce((SELECT jsonb_agg(jsonb_build_object('pipelineId',x.pipeline_id,'workspaceId',x.workspace_id,'periodStart',to_char(x.period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'budgets',x.budgets,'state',x.state,'createdAt',to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'settledAt',CASE WHEN x.settled_at IS NULL THEN NULL ELSE to_char(x.settled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) ORDER BY x.pipeline_id) FROM (SELECT pipeline_id,workspace_id,period_start,budgets,state,created_at,settled_at FROM usage_reservations WHERE creator_id=$1 ORDER BY pipeline_id LIMIT 501) x),'[]'::jsonb) AS reservations,
       coalesce((SELECT jsonb_agg(jsonb_build_object('pipelineId',x.pipeline_id,'workspaceId',x.workspace_id,'periodStart',to_char(x.period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'stage',x.stage,'kind',x.kind,'seconds',x.seconds,'at',to_char(x.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY x.id) FROM (SELECT l.id,l.pipeline_id,l.workspace_id,l.period_start,l.stage,l.kind,l.seconds,l.at FROM usage_ledger l JOIN usage_reservations r ON r.pipeline_id=l.pipeline_id AND r.workspace_id=l.workspace_id AND r.period_start=l.period_start WHERE r.creator_id=$1 ORDER BY l.id LIMIT 501) x),'[]'::jsonb) AS movements`,[userId])).rows[0]!;
    if(source.reservations.length+source.movements.length>500){await client.query('COMMIT');return{state:'limit_exceeded' as const,requestId};}
    const data=body(privacyBillingData,{schemaVersion:1,subjectId:userId,reservations:source.reservations,movements:source.movements}),sha256=digest(JSON.stringify(data));
    type Receipt={id:string;content_sha256:string;snapshot_at:Date;created_at:Date};
    let receipt=(await client.query<Receipt>('SELECT id,content_sha256,snapshot_at,created_at FROM privacy_export_receipts WHERE request_id=$1 AND user_id=$2 AND idempotency_key=$3',[requestId,userId,key])).rows[0];
    const action=receipt?(receipt.content_sha256===sha256?'replayed':'snapshot_changed'):'prepared';
    if(!receipt)receipt=(await client.query<Receipt>("INSERT INTO privacy_export_receipts(id,request_id,user_id,idempotency_key,scope,content_sha256,snapshot_at) VALUES($1,$2,$3,$4,'consumption-attribution-v1',$5,$6) RETURNING id,content_sha256,snapshot_at,created_at",[randomUUID(),requestId,userId,key,sha256,source.captured_at])).rows[0]!;
    await client.query('INSERT INTO privacy_export_audit(id,receipt_id,actor_user_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),receipt.id,userId,action,correlationId]);
    const result=action==='snapshot_changed'?{state:'snapshot_changed' as const,requestId}:body(privacyBillingExport,{requestId,receiptId:receipt.id,scope:'consumption-attribution-v1',state:'prepared',fulfillment:'partial',globalFulfillment:'pending',createdAt:receipt.created_at.toISOString(),capturedAt:receipt.snapshot_at.toISOString(),sha256,data});
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
