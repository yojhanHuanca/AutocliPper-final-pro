import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {eventually} from '@autoclipper/testing';
import {account,client,emailToken} from '../helpers/accounts.mjs';
const execute=promisify(execFile),ffmpeg=process.env.FFMPEG_PATH??'ffmpeg';
test('revision-bound collaboration protects roles, approvals, audit and limited expiring review links',{timeout:180000},async t=>{
  const alice=await account(),bob=await account(),anonymous=client();
  const workspace=await alice.c.request('/workspaces','POST',{kind:'team',name:'Synthetic review team'},{'idempotency-key':randomUUID()});assert.equal(workspace.status,201);const workspaceId=workspace.value.id;
  const project=await alice.c.request('/projects','POST',{workspaceId,name:'Private revision review'},{'idempotency-key':randomUUID()});assert.equal(project.status,201);
  const root=process.env.TEST_TEMP_DIR??'.local';await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'collaboration-'));
  const pool=new pg.Pool({connectionString:process.env.PROJECT_DATABASE_URL,connectionTimeoutMillis:3000});
  const original={version:1,kind:'clip',startSeconds:0,endSeconds:2,aspect:'square',subtitles:{source:'none'}};let editId,aliceComment,bobComment,renderId,textLink,videoLink,expiredLink,bobLink;const tokens=[];
  const headers=()=>({'idempotency-key':randomUUID()});
  async function createLink(user,data){const result=await user.c.request(`/edits/${editId}/review-links`,'POST',data);assert.equal(result.status,201,JSON.stringify(result.value));tokens.push(result.value.token);return result.value;}
  try{
    const source=join(directory,'source.mp4');await execute(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',source],{timeout:30000,windowsHide:true});const bytes=await readFile(source);
    const intent=await alice.c.request(`/projects/${project.value.id}/uploads`,'POST',{mode:'put',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:'video/mp4'},headers());assert.equal(intent.status,201);const uploadId=intent.value.id;assert.ok((await fetch(intent.value.url,{method:'PUT',headers:intent.value.headers,body:bytes})).ok);assert.equal((await alice.c.request(`/uploads/${uploadId}/confirm`,'POST')).status,200);await eventually(async()=>(await alice.c.request(`/uploads/${uploadId}`)).value.inspection?.status==='succeeded',30000);
    const edit=await alice.c.request(`/uploads/${uploadId}/edits`,'POST',{name:'Immutable content review',spec:original},headers());assert.equal(edit.status,201);editId=edit.value.id;
    assert.equal((await bob.c.request(`/edits/${editId}/review`)).status,403);
    assert.equal((await alice.c.request(`/workspaces/${workspaceId}/invitations`,'POST',{email:bob.email,role:'reader'},headers())).status,201);assert.equal((await bob.c.request('/workspaces/invitations/accept','POST',{token:await emailToken(bob.email,'invitation')})).status,200);
    await t.test('a reader can read but cannot write comments, request review, approve or create links',async()=>{
      assert.equal((await bob.c.request(`/edits/${editId}/review`)).status,200);assert.equal((await bob.c.request(`/edits/${editId}/comments`)).status,200);
      for(const [path,input] of [['comments',{revisionVersion:1,timeSeconds:0.5,text:'Reader cannot write'}],['review',{version:1,reviewVersion:1}],['approvals',{version:1,reviewVersion:1}],['review-links',{revisionVersion:1}]])assert.equal((await bob.c.request(`/edits/${editId}/${path}`,'POST',input,headers())).status,403);
      const key=randomUUID(),input={revisionVersion:1,timeSeconds:0.5,text:'Synthetic owner comment'};const made=await alice.c.request(`/edits/${editId}/comments`,'POST',input,{'idempotency-key':key});assert.equal(made.status,201);aliceComment=made.value;
      assert.equal((await alice.c.request(`/edits/${editId}/comments`,'POST',input,{'idempotency-key':key})).value.id,aliceComment.id);assert.equal((await alice.c.request(`/edits/${editId}/comments`,'POST',{...input,text:'Changed intent'},{'idempotency-key':key})).status,409);
    });
    await t.test('editor comments validate relative time, preserve author permissions and delete with CAS',async()=>{
      assert.equal((await alice.c.request(`/workspaces/${workspaceId}/members/${bob.id}`,'PATCH',{role:'editor'})).status,200);
      assert.equal((await bob.c.request(`/edits/${editId}/comments`,'POST',{revisionVersion:1,timeSeconds:2.1,text:'Past clip end'},headers())).status,400);
      assert.equal((await bob.c.request(`/edits/${editId}/comments`,'POST',{revisionVersion:1,timeSeconds:0,text:'No forged author',authorId:alice.id},headers())).status,400);
      assert.equal((await bob.c.request(`/edits/${editId}/comments`,'POST',{revisionVersion:1,timeSeconds:0,text:'CSRF enforced'},{...headers(),origin:'https://untrusted.invalid'})).status,403);
      const made=await bob.c.request(`/edits/${editId}/comments`,'POST',{revisionVersion:1,timeSeconds:1,text:'Synthetic editor comment'},headers());assert.equal(made.status,201);bobComment=made.value;
      assert.equal((await bob.c.request(`/edits/${editId}/comments/${aliceComment.id}`,'DELETE',{version:1})).status,403);assert.equal((await bob.c.request(`/edits/${editId}/comments/${bobComment.id}`,'DELETE',{version:2})).status,412);
      const removed=await bob.c.request(`/edits/${editId}/comments/${bobComment.id}`,'DELETE',{version:1});assert.equal(removed.status,200);assert.equal(removed.value.text,null);assert.equal(removed.value.version,2);assert.equal((await bob.c.request(`/edits/${editId}/comments/${bobComment.id}`,'DELETE',{version:1})).status,412);
      const page=await bob.c.request(`/edits/${editId}/comments?revisionVersion=1`);assert.deepEqual(page.value.items.map(row=>row.id),[bobComment.id,aliceComment.id]);assert.equal((await bob.c.request(`/edits/${editId}/comments?revisionVersion=1&beforeId=${bobComment.id}`)).value.items[0].id,aliceComment.id);
    });
    await t.test('review and approval serialize concurrent transitions; an editor cannot approve',async()=>{
      const requests=await Promise.all([alice,bob].map(user=>user.c.request(`/edits/${editId}/review`,'POST',{version:1,reviewVersion:1})));assert.deepEqual(requests.map(row=>row.status).sort(),[201,412]);
      assert.equal((await bob.c.request(`/edits/${editId}/approvals`,'POST',{version:1,reviewVersion:2})).status,403);
      const approvals=await Promise.all([1,2].map(()=>alice.c.request(`/edits/${editId}/approvals`,'POST',{version:1,reviewVersion:2})));assert.deepEqual(approvals.map(row=>row.status).sort(),[201,412]);
      const state=await alice.c.request(`/edits/${editId}/review`);assert.equal(state.value.status,'approved');assert.equal(state.value.reviewVersion,3);assert.equal(state.value.approvedRevisionVersion,1);assert.equal(state.value.approvals.length,1);assert.equal(state.value.approvals[0].revisionVersion,1);
      assert.equal((await alice.c.request(`/edits/${editId}/review`,'POST',{version:1,reviewVersion:3})).status,409);
    });
    await t.test('new content and restoration reset approval without changing historical approval records',async()=>{
      assert.equal((await bob.c.request(`/edits/${editId}`,'PATCH',{version:1,spec:{...original,endSeconds:1.5}})).status,200);
      let state=(await alice.c.request(`/edits/${editId}/review`)).value;assert.equal(state.status,'draft');assert.equal(state.reviewVersion,4);assert.equal(state.approvedRevisionVersion,null);assert.equal(state.approvals[0].revisionVersion,1);
      assert.equal((await alice.c.request(`/edits/${editId}/approvals`,'POST',{version:1,reviewVersion:3})).status,412);
      assert.equal((await bob.c.request(`/edits/${editId}/review`,'POST',{version:2,reviewVersion:4})).status,201);assert.equal((await alice.c.request(`/edits/${editId}/approvals`,'POST',{version:1,reviewVersion:5})).status,412);assert.equal((await alice.c.request(`/edits/${editId}/approvals`,'POST',{version:2,reviewVersion:5})).status,201);
      assert.equal((await bob.c.request(`/edits/${editId}/restore`,'POST',{version:2,revisionVersion:1})).status,201);state=(await alice.c.request(`/edits/${editId}/review`)).value;assert.equal(state.version,3);assert.equal(state.status,'draft');assert.equal(state.reviewVersion,7);assert.equal(state.approvedRevisionVersion,null);assert.deepEqual(state.approvals.map(row=>row.revisionVersion),[2,1]);
      assert.equal((await bob.c.request(`/edits/${editId}/review`,'POST',{version:3,reviewVersion:7})).status,201);assert.equal((await bob.c.request(`/edits/${editId}/review`,'DELETE',{version:3,reviewVersion:8})).status,403);const returned=await alice.c.request(`/edits/${editId}/review`,'DELETE',{version:3,reviewVersion:8});assert.equal(returned.status,200);assert.equal(returned.value.status,'draft');assert.equal(returned.value.reviewVersion,9);assert.equal((await alice.c.request(`/edits/${editId}/review`,'DELETE',{version:3,reviewVersion:8})).status,412);
    });
    await t.test('anonymous links expose only the chosen revision and optional matching video export',async()=>{
      const render=await alice.c.request(`/edits/${editId}/renders`,'POST',{revisionVersion:1},headers());assert.equal(render.status,201);renderId=render.value.id;let result;await eventually(async()=>{result=(await alice.c.request(`/processing/${renderId}`)).value;return['succeeded','failed','cancelled'].includes(result.status);},60000);assert.equal(result.status,'succeeded',JSON.stringify(result));
      assert.equal((await alice.c.request(`/edits/${editId}/review-links`,'POST',{revisionVersion:2,processingId:renderId,expiresInSeconds:60})).status,404);
      assert.equal((await alice.c.request(`/edits/${editId}/review-links`,'POST',{revisionVersion:1,expiresInSeconds:604801})).status,400);
      textLink=await createLink(alice,{revisionVersion:1,expiresInSeconds:60});assert.match(textLink.token,/^[A-Za-z0-9_-]{43}$/);
      const stored=(await pool.query('SELECT * FROM editor_review_links WHERE id=$1',[textLink.id])).rows[0];assert.equal(stored.token_hash,createHash('sha256').update(textLink.token).digest('hex'));assert.equal(JSON.stringify(stored).includes(textLink.token),false);
      const view=await anonymous.request(`/review-links/${textLink.token}`);assert.equal(view.status,200);assert.equal(view.value.revisionVersion,1);assert.equal(view.value.status,'superseded');assert.equal(view.value.videoEnabled,false);assert.equal(view.value.comments.items.length,2);
      for(const privateValue of [alice.email,bob.email,alice.id,bob.id,workspaceId,project.value.id,uploadId,renderId])assert.equal(JSON.stringify(view.value).includes(privateValue),false);assert.ok(view.value.comments.items.every(row=>row.authorId===undefined));
      assert.equal((await anonymous.request(`/review-links/${textLink.token}/video`)).status,404);assert.equal((await anonymous.request(`/projects/${project.value.id}`,'GET',undefined,{authorization:`Bearer ${textLink.token}`})).status,401);assert.equal((await anonymous.request(`/review-links/${textLink.token}/comments`,'POST',{text:'No anonymous writes'})).status,404);
      videoLink=await createLink(alice,{revisionVersion:1,processingId:renderId,expiresInSeconds:60});const signed=await anonymous.request(`/review-links/${videoLink.token}/video`);assert.equal(signed.status,200);assert.ok(signed.value.expiresInSeconds>0&&signed.value.expiresInSeconds<=60);const response=await fetch(signed.value.url);assert.ok(response.ok);const actual=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(actual).digest('hex'),signed.value.sha256);
      const query=new URL(signed.value.url).searchParams,date=query.get('X-Amz-Date'),signedAt=Date.UTC(Number(date.slice(0,4)),Number(date.slice(4,6))-1,Number(date.slice(6,8)),Number(date.slice(9,11)),Number(date.slice(11,13)),Number(date.slice(13,15)));assert.ok(signedAt+Number(query.get('X-Amz-Expires'))*1000<=new Date(videoLink.expiresAt).getTime(),'Actual S3 signature cannot outlive the review grant');
      const listed=await alice.c.request(`/edits/${editId}/review-links`);assert.ok(listed.value.items.every(row=>row.token===undefined&&row.tokenHash===undefined&&row.token_hash===undefined));
    });
    await t.test('revocation, expiry and creator role loss invalidate new public access',async()=>{
      const revoked=await Promise.all([1,2].map(()=>alice.c.request(`/edits/${editId}/review-links/${videoLink.id}`,'DELETE')));assert.deepEqual(revoked.map(row=>row.status),[200,200]);assert.equal((await anonymous.request(`/review-links/${videoLink.token}`)).status,404);assert.equal((await anonymous.request(`/review-links/${videoLink.token}/video`)).status,404);
      expiredLink=await createLink(alice,{revisionVersion:1,expiresInSeconds:60});await pool.query("UPDATE editor_review_links SET expires_at=now()-interval '1 second' WHERE id=$1",[expiredLink.id]);assert.equal((await anonymous.request(`/review-links/${expiredLink.token}`)).status,404);
      assert.equal((await anonymous.request(`/review-links/${randomBytes(32).toString('base64url')}`)).status,404);
      bobLink=await createLink(bob,{revisionVersion:1});assert.equal((await anonymous.request(`/review-links/${bobLink.token}`)).status,200);assert.equal((await alice.c.request(`/workspaces/${workspaceId}/members/${bob.id}`,'PATCH',{role:'reader'})).status,200);assert.equal((await anonymous.request(`/review-links/${bobLink.token}`)).status,404);assert.equal((await bob.c.request(`/edits/${editId}/review-links`)).status,403);assert.equal((await alice.c.request(`/edits/${editId}/review-links/${bobLink.id}`,'DELETE')).status,200);
    });
    await t.test('audit is immutable, scoped and free of comment bodies, tokens and team emails; trash blocks links',async()=>{
      const audit=await alice.c.request(`/edits/${editId}/audit`);assert.equal(audit.status,200);for(const action of ['revision.created','revision.updated','revision.restored','comment.created','comment.deleted','review.requested','review.approved','review.returned','link.created','link.revoked'])assert.ok(audit.value.items.some(row=>row.action===action),action);
      const encoded=JSON.stringify(audit.value);for(const sensitive of [...tokens,alice.email,bob.email,'Synthetic owner comment','Synthetic editor comment'])assert.equal(encoded.includes(sensitive),false);
      assert.equal(audit.value.items.filter(row=>row.action==='link.revoked'&&row.details.linkId===videoLink.id).length,1);assert.equal((await bob.c.request(`/edits/${editId}/audit`)).status,403);
      const before=await alice.c.request(`/edits/${editId}/audit?beforeId=${audit.value.items[0].id}`);assert.equal(before.status,200);assert.equal(before.value.items.some(row=>row.id===audit.value.items[0].id),false);
      await assert.rejects(pool.query("UPDATE editor_audit SET action='link.revoked' WHERE id=$1",[audit.value.items[0].id]),error=>error.code==='23514');await assert.rejects(pool.query('UPDATE editor_approvals SET approver_id=$1 WHERE draft_id=$2',[bob.id,editId]),error=>error.code==='23514');
      assert.equal((await alice.c.request(`/projects/${project.value.id}`,'DELETE')).status,200);assert.equal((await anonymous.request(`/review-links/${textLink.token}`)).status,404);assert.equal((await alice.c.request(`/edits/${editId}/audit`)).status,404);
      const denied=[];for(let index=0;index<51;index++)denied.push((await anonymous.request(`/review-links/${randomBytes(32).toString('base64url')}`)).status);assert.ok(denied.includes(429));assert.ok(denied.every(status=>status===404||status===429));
    });
  }finally{await pool.end();await rm(directory,{recursive:true,force:true});}
});
