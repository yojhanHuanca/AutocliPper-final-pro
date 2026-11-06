import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {body,digest} from '@autoclipper/http-security';
import {privacyMediaData,privacyMediaExport} from '@autoclipper/api-contracts';

type TaskRow={id:string;workspace_id:string;inspection_id?:string;status:string;created_at:Date;finished_at:Date|null;error_code:string|null};
type Receipt={id:string;content_sha256:string;snapshot_at:Date;created_at:Date};
export async function prepareMediaExport(pool:pg.Pool,userId:string,requestId:string,key:string,correlationId:string){
  for(let attempt=0;attempt<3;attempt++){
   const client=await pool.connect();
   try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`privacy-media:${userId}`]);
    const capturedAt=(await client.query<{captured_at:Date}>('SELECT statement_timestamp() AS captured_at')).rows[0]!.captured_at;
    const unattributed=(await client.query<{missing:boolean}>('SELECT EXISTS(SELECT 1 FROM inspection_tasks WHERE creator_id IS NULL) OR EXISTS(SELECT 1 FROM processing_tasks WHERE creator_id IS NULL) AS missing')).rows[0]!.missing;
    if(unattributed){await client.query('COMMIT');return{state:'attribution_missing' as const,requestId};}
    const inspections=(await client.query<TaskRow>('SELECT id,workspace_id,status,created_at,finished_at,error_code FROM inspection_tasks WHERE creator_id=$1 ORDER BY id LIMIT 501',[userId])).rows;
    const processing=(await client.query<TaskRow>('SELECT id,workspace_id,inspection_id,status,created_at,finished_at,error_code FROM processing_tasks WHERE creator_id=$1 ORDER BY id LIMIT 501',[userId])).rows;
    if(inspections.length+processing.length>500){await client.query('COMMIT');return{state:'limit_exceeded' as const,requestId};}
    const project=(row:TaskRow)=>({id:row.id,workspaceId:row.workspace_id,status:row.status,createdAt:row.created_at.toISOString(),finishedAt:row.finished_at?.toISOString()??null,errorCode:row.error_code});
    const data=body(privacyMediaData,{schemaVersion:1,subjectId:userId,inspections:inspections.map(project),processing:processing.map(row=>({...project(row),inspectionId:row.inspection_id}))}),sha256=digest(JSON.stringify(data));
    let receipt=(await client.query<Receipt>('SELECT id,content_sha256,snapshot_at,created_at FROM privacy_export_receipts WHERE request_id=$1 AND user_id=$2 AND idempotency_key=$3',[requestId,userId,key])).rows[0];
    const action=receipt?(receipt.content_sha256===sha256?'replayed':'snapshot_changed'):'prepared';
    if(!receipt)receipt=(await client.query<Receipt>("INSERT INTO privacy_export_receipts(id,request_id,user_id,idempotency_key,scope,content_sha256,snapshot_at) VALUES($1,$2,$3,$4,'media-task-attribution-v1',$5,$6) RETURNING id,content_sha256,snapshot_at,created_at",[randomUUID(),requestId,userId,key,sha256,capturedAt])).rows[0]!;
    await client.query('INSERT INTO privacy_export_audit(id,receipt_id,actor_user_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),receipt.id,userId,action,correlationId]);
    const result=action==='snapshot_changed'?{state:'snapshot_changed' as const,requestId}:body(privacyMediaExport,{requestId,receiptId:receipt.id,scope:'media-task-attribution-v1',state:'prepared',fulfillment:'partial',globalFulfillment:'pending',createdAt:receipt.created_at.toISOString(),capturedAt:receipt.snapshot_at.toISOString(),sha256,data});
    await client.query('COMMIT');return result;
   }catch(error){await client.query('ROLLBACK');if(!['23505','40001'].includes((error as {code?:string}).code??'')||attempt===2)throw error;}finally{client.release();}
  }
  throw new Error('MEDIA_PRIVACY_RETRY_EXHAUSTED');
}
