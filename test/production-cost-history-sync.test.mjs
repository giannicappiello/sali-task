import test from "node:test";
import assert from "node:assert/strict";
import {syncCostHistory,recoverCostDocuments,watchCostHistory} from "../src/features/production-costs/history-sync.js";
import {needsOctRecovery,octRecoverySignature} from "../server/production-oct-refresh.js";
import {action} from "../src/features/production-costs/client.js";

test("all MES pages and the visible list refresh finish before slow optional OC lookups",async()=>{
 const events=[];let unblock;const slow=new Promise(resolve=>{unblock=resolve;});
 const run=syncCostHistory({refresh:async()=>events.push("visible"),request:async(op,body)=>{
  events.push(op+":"+(body.page||body.id));
  if(op==="sync")return {imported:1,total:2,hasMore:body.page===1,octRecoveryIds:[body.page],recoveryIds:body.page===1?[1]:[]};
  assert.deepEqual(events.slice(0,3),["sync:1","sync:2","visible"]);
  if(op==="sync-oct")await slow;
  return {recovered:1};
 }});
 // Both optional lookups may wait indefinitely; the whole MES import is already visible.
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events.slice(0,3),["sync:1","sync:2","visible"]);
 assert.ok(!events.includes("sync-product-sl:1"));unblock();
 const result=await run;assert.equal(result.imported,2);assert.equal(result.slRecovered,1);assert.equal(events.at(-1),"visible");
});
test("one failed or timed out document does not discard imported data or prevent later recovery",async()=>{
 const calls=[];let refreshes=0;
 const result=await recoverCostDocuments({jobs:[{id:1,oct:true,sl:true},{id:2,oct:true},{id:3,oct:true}],refresh:async()=>{refreshes++;},request:async(op,{id},options)=>{
  assert.equal(options.timeoutMs,90000);calls.push(op+id);
  if(id===1&&op==="sync-oct")throw new DOMException("timeout","TimeoutError");
  return {recovered:1,warnings:[]};
 }});
 assert.equal(result.failures,1);assert.equal(result.slRecovered,1);assert.equal(result.ocRecovered,2);assert.ok(calls.includes("sync-product-sl1"));assert.equal(refreshes,1);
});
test("cancellation during document recovery leaves the already refreshed MES data available",async()=>{
 const controller=new AbortController();let visible=false,documents=0;
 await assert.rejects(()=>syncCostHistory({signal:controller.signal,refresh:async()=>{visible=true;},request:async(op)=>{
  if(op==="sync")return {imported:245,total:245,hasMore:false,octRecoveryIds:[1,2,3]};
  documents++;assert.equal(visible,true);controller.abort();controller.signal.throwIfAborted();
 }}),{name:"AbortError"});
 assert.equal(visible,true);assert.equal(documents,1);
});
test("cancellation between pages prevents further imports and lookups",async()=>{
 const controller=new AbortController();const calls=[];
 await assert.rejects(()=>syncCostHistory({signal:controller.signal,refresh:async()=>assert.fail("not complete"),request:async(op)=>{calls.push(op);controller.abort();return {imported:100,total:245,hasMore:true};}}),{name:"AbortError"});
 assert.deepEqual(calls,["sync"]);
});
test("no pending documents means a single list refresh with no Mexal calls",async()=>{
 let refreshed=0;const r=await syncCostHistory({request:async op=>{assert.equal(op,"sync");return {imported:245,total:245,hasMore:false};},refresh:async()=>{refreshed++;}});
 assert.equal(r.imported,245);assert.equal(refreshed,1);
});
test("automatic updates import all MES pages without waiting for OC or SL recovery",async()=>{
 const calls=[];await syncCostHistory({recoverDocuments:false,refresh:async()=>calls.push("visible"),request:async op=>{calls.push(op);return {imported:1,total:1,hasMore:false,octRecoveryIds:[1],recoveryIds:[1]};}});
 assert.deepEqual(calls,["sync","visible"]);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function autoFixture(run,isBusy=()=>false){
 const browser=new EventTarget(),page=new EventTarget();page.hidden=false;let timer;
 const timers={setInterval(fn,ms){assert.equal(ms,60000);timer=fn;return 1;},clearInterval(){timer=null;}};
 const watcher=watchCostHistory({run,isBusy,browser,page,timers});
 return {browser,page,watcher,poll:()=>timer?.()};
}
test("initial load, confirmed closure events, polling and returning to the page refresh automatically",async()=>{
 let runs=0;const f=autoFixture(async()=>{runs++;});await tick();assert.equal(runs,1);
 f.browser.dispatchEvent(new Event("workspace:production-changed"));await tick();assert.equal(runs,2);
 f.poll();await tick();assert.equal(runs,3);
 f.browser.dispatchEvent(new Event("focus"));await tick();assert.equal(runs,4);
 f.page.hidden=true;f.poll();await tick();assert.equal(runs,4);
 f.page.hidden=false;f.page.dispatchEvent(new Event("visibilitychange"));await tick();assert.equal(runs,5);
 f.watcher.dispose();f.browser.dispatchEvent(new Event("workspace:production-changed"));f.poll();await tick();assert.equal(runs,5);
});
test("closure during manual recovery is queued and refreshed as soon as it becomes idle",async()=>{
 let busy=true,runs=0;const f=autoFixture(async()=>{runs++;},()=>busy);await tick();assert.equal(runs,0);
 f.browser.dispatchEvent(new Event("workspace:production-changed"));await tick();assert.equal(runs,0);
 busy=false;f.watcher.idle();await tick();assert.equal(runs,1);f.watcher.dispose();
});
test("rapid closure notifications never overlap imports and are combined into one follow-up",async()=>{
 let runs=0,release;const f=autoFixture(async()=>{runs++;if(runs===1)await new Promise(resolve=>{release=resolve;});});await tick();
 for(let n=0;n<5;n++)f.browser.dispatchEvent(new Event("workspace:production-changed"));await tick();assert.equal(runs,1);
 release();await tick();assert.equal(runs,2);f.watcher.dispose();
});
test("stop reaches the actual HTTP request while preserving the existing operation contract",async()=>{
 const original=globalThis.fetch,controller=new AbortController();let submitted;
 globalThis.fetch=async(_url,options)=>{
  submitted=JSON.parse(options.body);
  return new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true}));
 };
 try{
  const pending=action("test-only","sync",{page:3},{signal:controller.signal,timeoutMs:1000});
  controller.abort();await assert.rejects(()=>pending,{name:"AbortError"});
  assert.deepEqual(submitted,{action:"production_costs",operation:"sync",page:3});
 }finally{globalThis.fetch=original;}
});

const e=()=>({orderNumber:"RDP1",articleCode:"PF1",unit:"PZ",quantity:100,date:"2026-10-01",customerCode:"C1",links:[{lineId:"L1",oct:"OC/2/123",customerCode:"C1",unit:"PZ",quantity:100,date:"2026-10-01"}]});
test("verified matching OC rows are not recovered again during ordinary MES synchronization",()=>{
 const row=e();row.recoveredOctLines=[{targetKey:"L1",reference:"OC+2+123",year:2026,customerCode:"C1",articleCode:"PF1",unit:"PZ",quantity:100,lineValue:500}];
 assert.equal(needsOctRecovery(row),false);
 assert.equal(needsOctRecovery({...row,articleCode:"PF2"}),true);
});
test("unsuccessful OC recovery is cached for one day only for the exact current targets",()=>{
 const row=e(),now=Date.parse("2026-10-27T13:00:00Z");
 row.octRecovery={recoveredAt:"2026-10-27T12:00:00Z",targetSignature:octRecoverySignature(row)};
 assert.equal(needsOctRecovery(row,now),false);
 assert.equal(needsOctRecovery(row,now+86400000),true);
 assert.equal(needsOctRecovery({...row,articleCode:"PF2"},now),true);
 assert.equal(needsOctRecovery({...row,octRecovery:{recoveredAt:row.octRecovery.recoveredAt}},now),true);
 assert.equal(needsOctRecovery({orderNumber:"RDP2"},now),false);
});
