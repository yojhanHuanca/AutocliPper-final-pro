import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesPage, focusMain, containTab } from '../../.local/tests/client.mjs';

test('page focus changes on route transitions without stealing focus from filters or anchors',()=>{
  assert.equal(changesPage('/app/projects','/app/settings'),true);
  assert.equal(changesPage('/login?returnUrl=a','/register'),true);
  assert.equal(changesPage('/app/projects?search=a','/app/projects?search=b'),false);
  assert.equal(changesPage('/','/#features'),false);
  assert.equal(changesPage('','/login'),true);
});

test('skip/page focus moves to main without smooth motion and remains safe before main exists',()=>{
  const calls=[];
  const main={focus:options=>calls.push(['focus',options]),scrollIntoView:options=>calls.push(['scroll',options])};
  focusMain({getElementById:id=>{assert.equal(id,'main');return main;}},true);
  assert.equal(main.tabIndex,-1);
  assert.deepEqual(calls,[['focus',{preventScroll:true}],['scroll',{block:'start',behavior:'instant'}]]);
  focusMain({getElementById:()=>null},true);
});

test('mobile drawer contains forward/backward Tab, ignores hidden targets and preserves interior navigation',()=>{
  let focused='';
  const target=(id,visible=true)=>({getClientRects:()=>visible?[{}]:[],focus:()=>focused=id});
  const first=target('first'),middle=target('middle'),last=target('last');
  const container={querySelectorAll:()=>[target('hidden',false),first,middle,last],contains:el=>[first,middle,last].includes(el)};
  const key=(shift=false)=>({key:'Tab',shiftKey:shift,prevented:false,preventDefault(){this.prevented=true;}});
  let event=key(); containTab(event,container,last); assert.equal(focused,'first'); assert.equal(event.prevented,true);
  event=key(true); containTab(event,container,first); assert.equal(focused,'last'); assert.equal(event.prevented,true);
  event=key(); containTab(event,container,middle); assert.equal(event.prevented,false);
  event=key(); containTab(event,container,null); assert.equal(focused,'first'); assert.equal(event.prevented,true);
});

test('an empty navigation drawer retains focus instead of sending Tab behind the overlay',()=>{
  let focused=false; let prevented=false;
  containTab({key:'Tab',preventDefault(){prevented=true;}},{querySelectorAll:()=>[],focus(){focused=true;}},null);
  assert.equal(focused,true); assert.equal(prevented,true);
});
