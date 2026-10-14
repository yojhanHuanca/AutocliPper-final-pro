import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {eventually} from "@autoclipper/testing";
import {account} from "../helpers/accounts.mjs";
const execute=promisify(execFile);

test("authorized user-specified clips, real burned subtitles, WAV extraction and temporary downloads",{timeout:180000},async t=>{
  const alice=await account(),bob=await account();
  const workspace=await alice.c.request("/workspaces","POST",{kind:"personal",name:"Render acceptance"},{"idempotency-key":randomUUID()});assert.equal(workspace.status,201);
  const project=await alice.c.request("/projects","POST",{workspaceId:workspace.value.id,name:"Explicit clips"},{"idempotency-key":randomUUID()});assert.equal(project.status,201);
  const root=process.env.TEST_TEMP_DIR??".local";await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,"derivatives-"));
  let uploadId,clipId,audioId;
  const spec={version:1,kind:"clip",startSeconds:0.5,endSeconds:2,aspect:"square",subtitles:{provenance:"user",cues:[{startSeconds:0.6,endSeconds:1.8,text:"User supplied acceptance subtitle"}]}};
  async function terminal(id){let current;await eventually(async()=>{current=await alice.c.request(`/processing/${id}`);return current.status===200&&["succeeded","failed","cancelled"].includes(current.value.status);},60000);return current.value;}
  try {
    await t.test("confirmed and inspected source video is required",async()=>{
      const path=join(directory,"source.mp4");
      await execute(process.env.FFMPEG_PATH??"ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:s=320x240:r=30","-f","lavfi","-i","sine=frequency=440:sample_rate=48000","-t","3","-c:v","libx264","-threads","1","-pix_fmt","yuv420p","-c:a","aac",path],{timeout:30000,windowsHide:true});
      const bytes=await readFile(path);
      const intent=await alice.c.request(`/projects/${project.value.id}/uploads`,"POST",{mode:"put",bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),contentType:"video/mp4"},{"idempotency-key":randomUUID()});assert.equal(intent.status,201);uploadId=intent.value.id;
      assert.equal((await alice.c.request(`/uploads/${uploadId}/processing`,"POST",spec,{"idempotency-key":randomUUID()})).status,409);
      const stored=await fetch(intent.value.url,{method:"PUT",headers:intent.value.headers,body:bytes});assert.ok(stored.ok);
      assert.equal((await alice.c.request(`/uploads/${uploadId}/confirm`,"POST")).status,200);
      await eventually(async()=>{const status=await alice.c.request(`/uploads/${uploadId}`);return status.value.inspection?.status==="succeeded";},30000);
    });
    await t.test("cross-user source access, invalid timestamps and fabricated AI provenance are rejected",async()=>{
      assert.equal((await bob.c.request(`/uploads/${uploadId}/processing`,"POST",spec,{"idempotency-key":randomUUID()})).status,403);
      for(const invalid of [{...spec,endSeconds:4,subtitles:undefined},{...spec,startSeconds:-1},{...spec,subtitles:{provenance:"ai",cues:spec.subtitles.cues}},{...spec,subtitles:{provenance:"user",cues:[{startSeconds:0,endSeconds:1,text:"Outside clip"}]}}])assert.equal((await alice.c.request(`/uploads/${uploadId}/processing`,"POST",invalid,{"idempotency-key":randomUUID()})).status,400);
    });
    await t.test("idempotent request creates one clip with actual MP4 SRT and VTT artifacts",async()=>{
      const key=randomUUID();const requests=await Promise.all([1,2].map(()=>alice.c.request(`/uploads/${uploadId}/processing`,"POST",spec,{"idempotency-key":key})));
      assert.equal(requests[0].status,201);assert.equal(requests[1].status,201);assert.equal(requests[0].value.id,requests[1].value.id);clipId=requests[0].value.id;
      assert.equal((await alice.c.request(`/uploads/${uploadId}/processing`,"POST",{...spec,aspect:"vertical"},{"idempotency-key":key})).status,409);
      const result=await terminal(clipId);assert.equal(result.status,"succeeded",JSON.stringify(result));assert.equal(result.width,720);assert.equal(result.height,720);assert.ok(Math.abs(result.durationSeconds-1.5)<0.2);
      assert.deepEqual(result.artifacts.map(a=>a.kind),["video","srt","vtt"]);assert.equal(result.spec.subtitles.provenance,"user");
      for(const kind of ["video","srt","vtt"]){
        const download=await alice.c.request(`/processing/${clipId}/download?kind=${kind}`);assert.equal(download.status,200);assert.equal(download.value.expiresInSeconds,120);
        const response=await fetch(download.value.url);assert.ok(response.ok);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,download.value.bytes);assert.equal(createHash("sha256").update(bytes).digest("hex"),download.value.sha256);
        if(kind==="video")await writeFile(join(directory,"clip.mp4"),bytes);else{const text=bytes.toString();assert.match(text,/User supplied acceptance subtitle/);assert.match(text,/00:00:00[,.]100 --> 00:00:01[,.]300/);}
        const unsigned=new URL(download.value.url);unsigned.search="";assert.equal((await fetch(unsigned)).status,403);
      }
      // A blue source must contain bright glyphs in the subtitle region of the
      // encoded video. This checks burning text, beyond exporting sidecar files.
      const frame=await execute(process.env.FFMPEG_PATH??"ffmpeg",["-v","error","-ss","0.5","-i",join(directory,"clip.mp4"),"-vf","crop=720:150:0:570","-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{encoding:"buffer",timeout:15000,maxBuffer:1048576,windowsHide:true});
      let bright=0;for(let i=0;i<frame.stdout.length;i+=3)if(frame.stdout[i]>180&&frame.stdout[i+1]>180&&frame.stdout[i+2]>180)bright++;assert.ok(bright>20,"Subtitles were not visibly encoded in the frame");
    });
    await t.test("audio extraction yields a real mono 16kHz WAV and quota settles once",async()=>{
      const before=await alice.c.request(`/projects/storage?workspaceId=${workspace.value.id}`);
      const created=await alice.c.request(`/uploads/${uploadId}/processing`,"POST",{version:1,kind:"audio"},{"idempotency-key":randomUUID()});assert.equal(created.status,201);audioId=created.value.id;
      const result=await terminal(audioId);assert.equal(result.status,"succeeded",JSON.stringify(result));assert.equal(result.sampleRate,16000);
      const download=await alice.c.request(`/processing/${audioId}/download?kind=audio`);assert.equal(download.status,200);const bytes=Buffer.from(await(await fetch(download.value.url)).arrayBuffer());assert.equal(bytes.toString("ascii",0,4),"RIFF");assert.equal(bytes.toString("ascii",8,12),"WAVE");
      await writeFile(join(directory,"audio.wav"),bytes);
      const metadata=JSON.parse((await execute(process.env.FFPROBE_PATH??"ffprobe",["-v","error","-show_streams","-of","json",join(directory,"audio.wav")],{timeout:10000,windowsHide:true})).stdout);assert.equal(metadata.streams[0].sample_rate,"16000");assert.equal(metadata.streams[0].channels,1);
      const after=await alice.c.request(`/projects/storage?workspaceId=${workspace.value.id}`);assert.equal(after.value.reservedBytes,0);assert.equal(after.value.usedBytes-before.value.usedBytes,result.artifacts[0].bytes);
      await alice.c.request(`/processing/${audioId}`);const repeat=await alice.c.request(`/projects/storage?workspaceId=${workspace.value.id}`);assert.equal(repeat.value.usedBytes,after.value.usedBytes);
    });
    await t.test("cancellation settles its reservation once without charging an export",async()=>{
      const before=await alice.c.request(`/projects/storage?workspaceId=${workspace.value.id}`);
      const created=await alice.c.request(`/uploads/${uploadId}/processing`,"POST",{...spec,endSeconds:2.9},{"idempotency-key":randomUUID()});assert.equal(created.status,201);
      assert.equal((await alice.c.request(`/processing/${created.value.id}`,"DELETE")).status,200);
      const cancelled=await terminal(created.value.id);assert.equal(cancelled.status,"cancelled",JSON.stringify(cancelled));
      const after=await alice.c.request(`/projects/storage?workspaceId=${workspace.value.id}`);assert.equal(after.value.reservedBytes,0);assert.equal(after.value.usedBytes,before.value.usedBytes);
      assert.equal((await alice.c.request(`/processing/${created.value.id}`,"DELETE")).status,409);
    });
    await t.test("unconfigured analysis is explicit and cannot accept another user's audio",async()=>{
      const providers=await alice.c.request('/analyses/providers');assert.equal(providers.status,200);assert.equal(providers.value.transcription.deepgram.configured,false);assert.equal(providers.value.paidExecutionEnabled,false);
      const spec={version:1,provider:'deepgram',language:'auto',selection:{mode:'none'}};
      assert.equal((await bob.c.request(`/processing/${audioId}/analyses`,'POST',spec,{'idempotency-key':randomUUID()})).status,403);
      const result=await alice.c.request(`/processing/${audioId}/analyses`,'POST',spec,{'idempotency-key':randomUUID()});assert.equal(result.status,503);assert.equal(result.value.code,'TRANSCRIPTION_NOT_CONFIGURED');assert.ok(result.value.correlationId);
      assert.equal((await alice.c.request(`/processing/${clipId}/analyses`,'POST',spec,{'idempotency-key':randomUUID()})).status,409);
    });
    await t.test("another user cannot inspect, cancel, list or sign a download; trash blocks new URLs",async()=>{
      for(const id of [clipId,audioId]){
        assert.equal((await bob.c.request(`/processing/${id}`)).status,403);
        assert.equal((await bob.c.request(`/processing/${id}/download?kind=video`)).status,403);
        assert.equal((await bob.c.request(`/processing/${id}`,"DELETE")).status,403);
      }
      assert.equal((await bob.c.request(`/projects/${project.value.id}/processing`)).status,403);
      assert.equal((await alice.c.request(`/projects/${project.value.id}/processing`)).value.items.length,3);
      assert.equal((await alice.c.request(`/projects/${project.value.id}`,"DELETE")).status,200);
      assert.equal((await alice.c.request(`/processing/${clipId}/download?kind=video`)).status,404);
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});
