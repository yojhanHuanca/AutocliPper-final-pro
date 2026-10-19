import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { body, digest } from '@autoclipper/http-security';
import { privacyWorkspaceData, privacyWorkspaceExport } from '@autoclipper/api-contracts';

export async function prepareWorkspaceExport(pool:pg.Pool,userId:string,requestId:string,key:string,correlationId:string){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`privacy-workspace:${userId}`]);
    // All projected business fields share this single PostgreSQL statement snapshot.
    const source=(await client.query<{captured_at:Date;memberships:unknown[]}>(
      `SELECT statement_timestamp() AS captured_at,coalesce(jsonb_agg(jsonb_build_object(
        'workspaceId',x.id,'kind',x.kind,'role',x.role,'isOwner',x.role='owner',
        'workspaceCreatedAt',to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'joinedAt',to_char(x.joined_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY x.id),'[]'::jsonb) AS memberships
        FROM (SELECT w.id,w.kind,w.created_at,m.role,m.created_at AS joined_at FROM memberships m
          JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY w.id LIMIT 501) x`,[userId])).rows[0]!;
    if(source.memberships.length>500){await client.query('COMMIT');return {state:'limit_exceeded' as const,requestId};}
    const data=body(privacyWorkspaceData,{schemaVersion:1,subjectId:userId,memberships:source.memberships}),sha256=digest(JSON.stringify(data));
    type Receipt={id:string;content_sha256:string;snapshot_at:Date;created_at:Date};
    let receipt=(await client.query<Receipt>('SELECT id,content_sha256,snapshot_at,created_at FROM privacy_export_receipts WHERE request_id=$1 AND user_id=$2 AND idempotency_key=$3',[requestId,userId,key])).rows[0];
    const action=receipt?(receipt.content_sha256===sha256?'replayed':'snapshot_changed'):'prepared';
    if(!receipt)receipt=(await client.query<Receipt>("INSERT INTO privacy_export_receipts(id,request_id,user_id,idempotency_key,scope,content_sha256,snapshot_at) VALUES($1,$2,$3,$4,'workspace-memberships-v1',$5,$6) RETURNING id,content_sha256,snapshot_at,created_at",[randomUUID(),requestId,userId,key,sha256,source.captured_at])).rows[0]!;
    await client.query('INSERT INTO privacy_export_audit(id,receipt_id,actor_user_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),receipt.id,userId,action,correlationId]);
    const result=action==='snapshot_changed'?{state:'snapshot_changed' as const,requestId}:body(privacyWorkspaceExport,{requestId,receiptId:receipt.id,scope:'workspace-memberships-v1',state:'prepared',fulfillment:'partial',globalFulfillment:'pending',createdAt:receipt.created_at.toISOString(),capturedAt:receipt.snapshot_at.toISOString(),sha256,data});
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
