import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {spawn,execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,mkdtemp,readFile,rm,readdir} from "node:fs/promises";
import {join} from "node:path";
import pg from "pg";
import {Queue} from "bullmq";
import {PutObjectCommand,DeleteObjectCommand,GetObjectCommand} from "@aws-sdk/client-s3";
import {loadMediaConfig} from "@autoclipper/configuration";
import {eventually} from "@autoclipper/testing";
import {createS3,redisConnection} from "../../apps/autoclipper-media-processing-service/dist/infrastructure/connections.js";
import {migrateMedia} from "../../apps/autoclipper-media-processing-service/dist/infrastructure/migrate.js";
import {probeLocal} from "../../apps/autoclipper-media-processing-service/dist/infrastructure/probe.js";
const config=loadMediaConfig(),execute=promisify(execFile);
test("persistent derivatives recover a lost queue entry, reject changed media, cancel and clean temporary files",{timeout:180000},async t=>{
  await migrateMedia(process.env.MIGRATION_DATABASE_URL);
  const pool=new pg.Pool({connectionString:config.DATABASE_URL}),s3=createS3(config);
  const queue=new Queue("media-derivatives-v1",{connection:{...redisConnection(config.REDIS_URL),maxRetriesPerRequest:1}});
  const workspace=randomUUID(),sourceId=randomUUID(),objectKey=`workspaces/${workspace}/media/${sourceId}/source.mp4`,tasks=[];
  const root=process.env.TEST_TEMP_DIR??".local";await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,"render-recovery-"));
  let worker,first,body;
  const spec={version:1,kind:"clip",startSeconds:0.2,endSeconds:1.5,aspect:"vertical",subtitles:{provenance:"user",cues:[{startSeconds:0.3,endSeconds:1.2,text:"Explicit recovery fixture"}]}};
  async function stop(){if(!worker||worker.exitCode!==null||worker.signalCode!==null){worker=undefined;return;}const child=worker;const closed=new Promise(resolve=>child.once("exit",resolve));child.kill("SIGTERM");await closed;if(worker===child)worker=undefined;}
  async function start(mode){worker=spawn(process.execPath,["apps/autoclipper-media-processing-service/dist/main.js"],{env:{...process.env,PORT:"3106",HOST:"127.0.0.1",MEDIA_WORKERS:mode,LOG_LEVEL:"silent",TEMP_DIR:join(directory,"temporary")},stdio:["ignore","ignore","pipe"],windowsHide:true});worker.stderr.on("data",()=>{});await eventually(async()=>{if(worker.exitCode!==null)throw new Error(`Worker exited ${worker.exitCode}`);try{return(await fetch("http://127.0.0.1:3106/v1/health/ready")).ok;}catch{return false;}},30000);}
  async function request(path,input){const response=await fetch(`http://127.0.0.1:3106/v1/internal/${path}`,{method:"POST",headers:{"content-type":"application/json","x-service-token":config.INTERNAL_TOKEN},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});return{status:response.status,value:await response.json()};}
  async function submit(custom=spec){const id=randomUUID();tasks.push(id);const result=await request("processing",{id,workspaceId:workspace,inspectionId:sourceId,spec:custom,correlationId:randomUUID()});assert.equal(result.status,200);return id;}
  async function terminal(id){let row;await eventually(async()=>{row=(await pool.query("SELECT * FROM processing_tasks WHERE id=$1",[id])).rows[0];return["succeeded","failed","cancelled"].includes(row.status)&&!row.cleanup_pending;},45000);return row;}
  try {
    const path=join(directory,"source.mp4");await execute(config.FFMPEG_PATH,["-v","error","-f","lavfi","-i","color=c=green:s=320x240:r=30","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","3","-c:v","libx264","-threads","1","-pix_fmt","yuv420p","-c:a","aac",path],{timeout:30000,windowsHide:true});body=await readFile(path);
    const stored=await s3.send(new PutObjectCommand({Bucket:config.S3_BUCKET,Key:objectKey,Body:body}));
    const metadata=await probeLocal(path,config);
    await pool.query("INSERT INTO inspection_tasks(id,workspace_id,object_key,expected_bytes,expected_etag,expected_sha256,correlation_id,status,result,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,'succeeded',$8,now(),now())",[sourceId,workspace,objectKey,body.length,stored.ETag,createHash("sha256").update(body).digest("hex"),randomUUID(),metadata]);
    await t.test("outbox replay restores an acknowledged job lost from Redis and produces real artifacts",async()=>{
      await start("inspection");first=await submit();
      await eventually(async()=>Boolean((await pool.query("SELECT delivered_at FROM processing_outbox WHERE task_id=$1",[first])).rows[0]?.delivered_at),10000);
      await stop();const queued=await queue.getJob(first);assert.ok(queued);await queued.remove();
      await start("render");const result=await terminal(first);assert.equal(result.status,"succeeded",JSON.stringify(result));assert.equal(result.attempts,1);assert.equal(result.result.width,720);assert.equal(result.result.height,1280);assert.equal(result.result.artifacts.length,3);
      const object=await s3.send(new GetObjectCommand({Bucket:config.S3_BUCKET,Key:result.result.artifacts[1].objectKey}));assert.match(await object.Body.transformToString(),/00:00:00,100 --> 00:00:01,000/);
      const duplicate=await request("processing",{id:first,workspaceId:workspace,inspectionId:sourceId,spec,correlationId:randomUUID()});assert.equal(duplicate.status,200);
      const conflict=await request("processing",{id:first,workspaceId:workspace,inspectionId:sourceId,spec:{...spec,aspect:"square"},correlationId:randomUUID()});assert.equal(conflict.status,409);
      await stop();await start("render");assert.equal((await terminal(first)).attempts,1);
    });
    await t.test("invalid timestamps and cross-workspace sources never create a derivative",async()=>{
      for(const input of [{spec:{...spec,endSeconds:4},workspaceId:workspace},{spec,workspaceId:randomUUID()}]){const result=await request("processing",{id:randomUUID(),inspectionId:sourceId,correlationId:randomUUID(),...input});assert.ok([400,409].includes(result.status));}
    });
    await t.test("queued cancellation persists across restart and releases no partial artifact",async()=>{
      await stop();await start("inspection");const id=await submit();assert.equal((await request("processing-cancel",{id,workspaceId:workspace})).status,200);await stop();await start("render");const result=await terminal(id);assert.equal(result.status,"cancelled");assert.equal(result.error_code,"CANCELLED");assert.equal(result.result,null);
    });
    await t.test("running cancellation aborts processing and removes any uploaded partial files",async()=>{
      const id=await submit({...spec,endSeconds:2.9});
      await eventually(async()=> (await pool.query("SELECT status FROM processing_tasks WHERE id=$1",[id])).rows[0]?.status==="running",10000);
      assert.equal((await request("processing-cancel",{id,workspaceId:workspace})).status,200);
      assert.equal((await terminal(id)).status,"cancelled");
    });
    await t.test("a changed object fails permanently; a missing source retries only three times",async()=>{
      await s3.send(new PutObjectCommand({Bucket:config.S3_BUCKET,Key:objectKey,Body:Buffer.from("changed source")}));
      const changed=await terminal(await submit());assert.equal(changed.status,"failed");assert.equal(changed.error_code,"OBJECT_CHANGED");assert.equal(changed.attempts,1);
      await s3.send(new DeleteObjectCommand({Bucket:config.S3_BUCKET,Key:objectKey}));
      const missing=await terminal(await submit());assert.equal(missing.status,"failed");assert.equal(missing.attempts,3);assert.equal(missing.error_code,"STORAGE_OR_NETWORK_ERROR");
    });
    await t.test("all success and failure paths leave the temporary directory empty",async()=>{await stop();assert.deepEqual(await readdir(join(directory,"temporary")),[]);});
  } finally {
    await stop();for(const id of tasks){const job=await queue.getJob(id);if(job)await job.remove();for(const file of ["clip.mp4","audio.wav","captions.srt","captions.vtt"])await s3.send(new DeleteObjectCommand({Bucket:config.S3_BUCKET,Key:`workspaces/${workspace}/media/derivatives/${id}/${file}`}));}
    await pool.query("DELETE FROM processing_tasks WHERE id=ANY($1::uuid[])",[tasks]);await pool.query("DELETE FROM inspection_tasks WHERE id=$1",[sourceId]);await s3.send(new DeleteObjectCommand({Bucket:config.S3_BUCKET,Key:objectKey}));await queue.close();s3.destroy();await pool.end();await rm(directory,{recursive:true,force:true});
  }
});
