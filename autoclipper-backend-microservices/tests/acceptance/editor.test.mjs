import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {eventually} from '@autoclipper/testing';
import {account} from '../helpers/accounts.mjs';
const {structuredClone}=globalThis;
const execute=promisify(execFile),ffmpeg=process.env.FFMPEG_PATH??'ffmpeg';
test('editor drafts enforce optimistic concurrency, immutable recoverable revisions and revision-specific real renders',{timeout:180000},async t=>{
  const alice=await account(),bob=await account();
  const workspace=await alice.c.request('/workspaces','POST',{kind:'personal',name:'Editor acceptance'},{'idempotency-key':randomUUID()});assert.equal(workspace.status,201);
  const project=await alice.c.request('/projects','POST',{workspaceId:workspace.value.id,name:'Revision-specific outputs'},{'idempotency-key':randomUUID()});assert.equal(project.status,201);
  const root=process.env.TEST_TEMP_DIR??'.local';await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'editor-acceptance-'));
  const original={version:1,kind:'clip',startSeconds:0,endSeconds:2,aspect:'square',framing:{x:0,y:0.5},subtitles:{source:'user',cues:[{startSeconds:0,endSeconds:1.9,text:'Explicit saved revision fixture'}],style:{template:'clean',fontSize:24,position:'bottom'}}};
  let uploadId,draft,revision2,renderId;
  try{
    const source=join(directory,'source.mp4');await execute(ffmpeg,['-v','error','-f','lavfi','-i','color=c=red:s=640x240:r=30,drawbox=x=320:y=0:w=320:h=240:color=blue:t=fill','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',source],{timeout:30000,windowsHide:true});const bytes=await readFile(source);
    const intent=await alice.c.request(`/projects/${project.value.id}/uploads`,'POST',{mode:'put',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'video/mp4'},{'idempotency-key':randomUUID()});assert.equal(intent.status,201);uploadId=intent.value.id;assert.ok((await fetch(intent.value.url,{method:'PUT',headers:intent.value.headers,body:bytes})).ok);assert.equal((await alice.c.request(`/uploads/${uploadId}/confirm`,'POST')).status,200);await eventually(async()=>(await alice.c.request(`/uploads/${uploadId}`)).value.inspection?.status==='succeeded',30000);
    await t.test('creation is idempotent and rejects unknown edits, source mismatch and CSRF',async()=>{
      const key=randomUUID(),input={name:'Saved clip',spec:original};const created=await alice.c.request(`/uploads/${uploadId}/edits`,'POST',input,{'idempotency-key':key});assert.equal(created.status,201,JSON.stringify(created.value));draft=created.value;assert.equal(draft.version,1);
      assert.equal((await alice.c.request(`/uploads/${uploadId}/edits`,'POST',input,{'idempotency-key':key})).value.id,draft.id);
      assert.equal((await alice.c.request(`/uploads/${uploadId}/edits`,'POST',{...input,name:'Different intent'},{'idempotency-key':key})).status,409);
      assert.equal((await alice.c.request(`/uploads/${uploadId}/edits`,'POST',input,{'idempotency-key':randomUUID(),origin:'https://untrusted.invalid'})).status,403);
      assert.equal((await alice.c.request(`/uploads/${uploadId}/edits`,'POST',{name:'Out of range',spec:{...original,endSeconds:4}},{'idempotency-key':randomUUID()})).status,400);
      assert.equal((await alice.c.request(`/uploads/${uploadId}/edits`,'POST',{name:'Fabricated provenance',spec:{...original,subtitles:{source:'transcript',analysisId:randomUUID(),cues:original.subtitles.cues}}},{'idempotency-key':randomUUID()})).status,400);
    });
    await t.test('stale versions and If-Match cannot overwrite a revision; only one concurrent writer succeeds',async()=>{
      const changed=structuredClone(original);changed.framing.x=1;changed.subtitles.style={template:'bold',fontSize:30,position:'top'};
      const saved=await alice.c.request(`/edits/${draft.id}`,'PATCH',{version:1,spec:changed},{'if-match':'"1"'});assert.equal(saved.status,200,JSON.stringify(saved.value));assert.equal(saved.value.version,2);revision2=saved.value.revision;
      const stale=await alice.c.request(`/edits/${draft.id}`,'PATCH',{version:1,spec:original});assert.equal(stale.status,412);assert.equal(stale.value.code,'VERSION_CONFLICT');
      assert.equal((await alice.c.request(`/edits/${draft.id}`,'PATCH',{version:2,spec:original},{'if-match':'"1"'})).status,412);
      const updates=await Promise.all([original,changed].map(spec=>alice.c.request(`/edits/${draft.id}`,'PATCH',{version:2,spec})));assert.deepEqual(updates.map(value=>value.status).sort(),[200,412]);
      const history=await alice.c.request(`/edits/${draft.id}/revisions`);assert.equal(history.status,200);assert.deepEqual(history.value.items.map(item=>item.version),[3,2,1]);assert.equal(history.value.nextBeforeVersion,null);
      assert.ok(history.value.items.every(item=>item.spec===undefined&&item.renderSpec===undefined),'History is bounded metadata; full snapshots use the revision endpoint');
      const earlier=await alice.c.request(`/edits/${draft.id}/revisions?beforeVersion=2`);assert.deepEqual(earlier.value.items.map(item=>item.version),[1]);assert.equal((await alice.c.request(`/edits/${draft.id}`)).headers.get('etag'),'"3"');
    });
    await t.test('restore creates a new revision and PostgreSQL rejects mutation of an old one',async()=>{
      const restored=await alice.c.request(`/edits/${draft.id}/restore`,'POST',{version:3,revisionVersion:1});assert.equal(restored.status,201,JSON.stringify(restored.value));assert.equal(restored.value.version,4);assert.equal(restored.value.revision.action,'restored');assert.equal(restored.value.revision.restoredFromVersion,1);assert.deepEqual(restored.value.revision.spec,original);
      assert.equal((await alice.c.request(`/edits/${draft.id}/revisions/2`)).value.spec.framing.x,1);
      const pool=new pg.Pool({connectionString:process.env.PROJECT_DATABASE_URL,connectionTimeoutMillis:3000});try{await assert.rejects(pool.query("UPDATE editor_revisions SET action='updated' WHERE id=$1",[revision2.id]),error=>error.code==='23514');}finally{await pool.end();}
    });
    await t.test('rendering a chosen older revision uses its framing and style, not the current draft',async()=>{
      const key=randomUUID(),input={revisionVersion:2};const requests=await Promise.all([1,2].map(()=>alice.c.request(`/edits/${draft.id}/renders`,'POST',input,{'idempotency-key':key})));assert.equal(requests[0].status,201,JSON.stringify(requests[0].value));assert.equal(requests[0].value.id,requests[1].value.id);renderId=requests[0].value.id;
      assert.equal((await alice.c.request(`/edits/${draft.id}/renders`,'POST',{revisionVersion:1},{'idempotency-key':key})).status,409);
      let result;await eventually(async()=>{result=await alice.c.request(`/processing/${renderId}`);return['succeeded','failed','cancelled'].includes(result.value.status);},60000);assert.equal(result.value.status,'succeeded',JSON.stringify(result.value));assert.equal(result.value.editorRevisionId,revision2.id);assert.equal(result.value.spec.framing.x,1);assert.equal(result.value.spec.subtitles.style.template,'bold');
      const signed=await alice.c.request(`/processing/${renderId}/download?kind=video`);assert.equal(signed.status,200);const bytes=Buffer.from(await(await fetch(signed.value.url)).arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),signed.value.sha256);await writeFile(join(directory,'clip.mp4'),bytes);
      const frame=await execute(ffmpeg,['-v','error','-ss','0.5','-i',join(directory,'clip.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',timeout:15000,maxBuffer:2097152,windowsHide:true});const offset=(360*720+360)*3;assert.ok(frame.stdout[offset]<30&&frame.stdout[offset+2]>180,'Rendered crop does not match revision 2');let yellow=0;for(let pos=0;pos<frame.stdout.length/2;pos+=3)if(frame.stdout[pos]>150&&frame.stdout[pos+1]>150&&frame.stdout[pos+2]<120)yellow++;assert.ok(yellow>50,'Saved top/yellow template was not burned');
      const exports=await alice.c.request(`/edits/${draft.id}/exports`);assert.equal(exports.value.items.length,1);assert.equal(exports.value.items[0].editorRevisionId,revision2.id);assert.equal((await alice.c.request(`/edits/${draft.id}`)).value.version,4);
      assert.equal(exports.value.items[0].spec,undefined,'Export listing does not repeat potentially large descriptions');
    });
    await t.test('another user is denied history mutation restore renders and downloads; trash blocks new access',async()=>{
      for(const path of [`/edits/${draft.id}`,`/edits/${draft.id}/revisions`,`/edits/${draft.id}/revisions/1`,`/edits/${draft.id}/exports`,`/projects/${project.value.id}/edits`])assert.equal((await bob.c.request(path)).status,403);
      assert.equal((await bob.c.request(`/edits/${draft.id}`,'PATCH',{version:4,spec:original})).status,403);assert.equal((await bob.c.request(`/edits/${draft.id}/restore`,'POST',{version:4,revisionVersion:1})).status,403);assert.equal((await bob.c.request(`/edits/${draft.id}/renders`,'POST',{revisionVersion:1},{'idempotency-key':randomUUID()})).status,403);assert.equal((await bob.c.request(`/processing/${renderId}/download?kind=video`)).status,403);
      assert.equal((await alice.c.request(`/projects/${project.value.id}/edits`)).value.items.length,1);assert.equal((await alice.c.request(`/projects/${project.value.id}`,'DELETE')).status,200);assert.equal((await alice.c.request(`/edits/${draft.id}`)).status,404);assert.equal((await alice.c.request(`/processing/${renderId}/download?kind=video`)).status,404);
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});
