import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {body,digest} from '@autoclipper/http-security';
import {privacyAnalysisData,privacyAnalysisExport} from '@autoclipper/api-contracts';

type JobRow={id:string;workspace_id:string;status:string;created_at:Date;finished_at:Date|null;error_code:string|null;transcript_present:boolean;selection_present:boolean;provider_attempts:number};
type Receipt={id:string;content_sha256:string;snapshot_at:Date;created_at:Date};
export async function prepareAnalysisExport(pool:pg.Pool,userId:string,requestId:string,key:string,correlationId:string){
  for(let attempt=0;attempt<3;attempt++){
   const client=await pool.connect();
   try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`privacy-analysis:${userId}`]);
    const capturedAt=(await client.query<{captured_at:Date}>('SELECT statement_timestamp() AS captured_at')).rows[0]!.captured_at;
    const jobs=(await client.query<JobRow>(`SELECT j.id,j.workspace_id,j.status,j.created_at,j.finished_at,j.error_code,
       EXISTS(SELECT 1 FROM transcripts t WHERE t.job_id=j.id) AS transcript_present,
       EXISTS(SELECT 1 FROM segment_selections s WHERE s.job_id=j.id) AS selection_present,
       (SELECT count(*)::int FROM provider_attempts p WHERE p.job_id=j.id) AS provider_attempts
       FROM analysis_jobs j WHERE j.creator_id=$1 ORDER BY j.id LIMIT 501`,[userId])).rows;
    if(jobs.length>500||jobs.some(row=>row.provider_attempts>1000)){await client.query('COMMIT');return{state:'limit_exceeded' as const,requestId};}
    const data=body(privacyAnalysisData,{schemaVersion:1,subjectId:userId,jobs:jobs.map(row=>({id:row.id,workspaceId:row.workspace_id,status:row.status,createdAt:row.created_at.toISOString(),finishedAt:row.finished_at?.toISOString()??null,errorCode:row.error_code,transcriptPresent:row.transcript_present,selectionPresent:row.selection_present,providerAttempts:row.provider_attempts}))}),sha256=digest(JSON.stringify(data));
    let receipt=(await client.query<Receipt>('SELECT id,content_sha256,snapshot_at,created_at FROM privacy_export_receipts WHERE request_id=$1 AND user_id=$2 AND idempotency_key=$3',[requestId,userId,key])).rows[0];
    const action=receipt?(receipt.content_sha256===sha256?'replayed':'snapshot_changed'):'prepared';
    if(!receipt)receipt=(await client.query<Receipt>("INSERT INTO privacy_export_receipts(id,request_id,user_id,idempotency_key,scope,content_sha256,snapshot_at) VALUES($1,$2,$3,$4,'analysis-attribution-v1',$5,$6) RETURNING id,content_sha256,snapshot_at,created_at",[randomUUID(),requestId,userId,key,sha256,capturedAt])).rows[0]!;
    await client.query('INSERT INTO privacy_export_audit(id,receipt_id,actor_user_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),receipt.id,userId,action,correlationId]);
    const result=action==='snapshot_changed'?{state:'snapshot_changed' as const,requestId}:body(privacyAnalysisExport,{requestId,receiptId:receipt.id,scope:'analysis-attribution-v1',state:'prepared',fulfillment:'partial',globalFulfillment:'pending',createdAt:receipt.created_at.toISOString(),capturedAt:receipt.snapshot_at.toISOString(),sha256,data});
    await client.query('COMMIT');return result;
   }catch(error){await client.query('ROLLBACK');if(!['23505','40001'].includes((error as {code?:string}).code??'')||attempt===2)throw error;}finally{client.release();}
  }
  throw new Error('ANALYSIS_PRIVACY_RETRY_EXHAUSTED');
}
