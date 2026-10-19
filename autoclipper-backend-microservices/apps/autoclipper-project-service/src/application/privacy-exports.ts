import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { body, digest } from '@autoclipper/http-security';
import { privacyProjectData, privacyProjectExport } from '@autoclipper/api-contracts';

const safeError=(value:unknown)=>typeof value==='string'&&/^[A-Z0-9_]{1,100}$/u.test(value)?value:null;
export async function prepareProjectExport(pool:pg.Pool,userId:string,requestId:string,key:string,correlationId:string){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`privacy-project:${userId}`]);
    // A single statement snapshot covers every Project-owned reference in this contribution.
    const source=(await client.query<Record<string,unknown>>(
      `SELECT statement_timestamp() AS captured_at,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'version',x.version,'createdAt',to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'deleted',x.deleted_at IS NOT NULL) ORDER BY x.id) FROM (SELECT id,version,created_at,deleted_at FROM projects WHERE creator_id=$1 ORDER BY id LIMIT 501) x),'[]'::jsonb) AS projects,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'projectId',x.project_id,'bytes',x.expected_bytes,'contentType',x.content_type,'state',x.state,'createdAt',to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'cleaned',x.cleaned_at IS NOT NULL) ORDER BY x.id) FROM (SELECT id,project_id,expected_bytes,content_type,state,created_at,cleaned_at FROM uploads WHERE creator_id=$1 ORDER BY id LIMIT 501) x),'[]'::jsonb) AS uploads,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'uploadId',x.upload_id,'projectId',x.project_id,'status',x.status,'createdAt',to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'finishedAt',CASE WHEN x.finished_at IS NULL THEN NULL ELSE to_char(x.finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'errorCode',x.error_code) ORDER BY x.id) FROM (SELECT id,upload_id,project_id,status,created_at,finished_at,error_code FROM processing_requests WHERE creator_id=$1 ORDER BY id LIMIT 501) x),'[]'::jsonb) AS processing,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'uploadId',x.upload_id,'projectId',x.project_id,'createdAt',to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'finishedAt',CASE WHEN x.finished_at IS NULL THEN NULL ELSE to_char(x.finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) ORDER BY x.id) FROM (SELECT id,upload_id,project_id,created_at,finished_at FROM analysis_requests WHERE creator_id=$1 ORDER BY id LIMIT 501) x),'[]'::jsonb) AS analyses,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'uploadId',x.upload_id,'projectId',x.project_id,'status',x.status,'createdAt',to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'finishedAt',CASE WHEN x.finished_at IS NULL THEN NULL ELSE to_char(x.finished_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'errorCode',x.error_code) ORDER BY x.id) FROM (SELECT id,upload_id,project_id,status,created_at,finished_at,error_code FROM pipelines WHERE creator_id=$1 ORDER BY id LIMIT 501) x),'[]'::jsonb) AS pipelines,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'draftId',x.draft_id,'version',x.version,'action',x.action,'createdAt',to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'restoredFromVersion',x.restored_from_version) ORDER BY x.id) FROM (SELECT r.id,r.draft_id,r.version,r.action,r.created_at,r.restored_from_version FROM editor_revisions r WHERE r.author_id=$1 ORDER BY r.id LIMIT 501) x),'[]'::jsonb) AS revisions`,[userId])).rows[0]!;
    const arrays=['projects','uploads','processing','analyses','pipelines','revisions'] as const;
    const total=arrays.reduce((sum,name)=>sum+(Array.isArray(source[name])?source[name].length:501),0);
    if(total>500){await client.query('COMMIT');return {state:'limit_exceeded' as const,requestId};}
    if(Array.isArray(source.processing))source.processing=source.processing.map((row:{errorCode:unknown})=>({...row,errorCode:safeError(row.errorCode)}));
    if(Array.isArray(source.pipelines))source.pipelines=source.pipelines.map((row:{errorCode:unknown})=>({...row,errorCode:safeError(row.errorCode)}));
    const data=body(privacyProjectData,{schemaVersion:1,subjectId:userId,...Object.fromEntries(arrays.map(name=>[name,source[name]]))});
    const sha256=digest(JSON.stringify(data));
    type Receipt={id:string;content_sha256:string;snapshot_at:Date;created_at:Date};
    let receipt=(await client.query<Receipt>('SELECT id,content_sha256,snapshot_at,created_at FROM privacy_export_receipts WHERE request_id=$1 AND user_id=$2 AND idempotency_key=$3',[requestId,userId,key])).rows[0];
    const action=receipt?(receipt.content_sha256===sha256?'replayed':'snapshot_changed'):'prepared';
    if(!receipt)receipt=(await client.query<Receipt>("INSERT INTO privacy_export_receipts(id,request_id,user_id,idempotency_key,scope,content_sha256,snapshot_at) VALUES($1,$2,$3,$4,'project-attribution-v1',$5,$6) RETURNING id,content_sha256,snapshot_at,created_at",[randomUUID(),requestId,userId,key,sha256,source.captured_at])).rows[0]!;
    await client.query('INSERT INTO privacy_export_audit(id,receipt_id,actor_user_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),receipt.id,userId,action,correlationId]);
    const result=action==='snapshot_changed'?{state:'snapshot_changed' as const,requestId}:body(privacyProjectExport,{requestId,receiptId:receipt.id,scope:'project-attribution-v1',state:'prepared',fulfillment:'partial',globalFulfillment:'pending',createdAt:receipt.created_at.toISOString(),capturedAt:receipt.snapshot_at.toISOString(),sha256,data});
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
