import test from 'node:test';import assert from 'node:assert/strict';
import {MARGIN_AGENT,MARGIN_AGENT_HASH,MARGIN_POLICY_HASH,marginTriggerDue} from './margin-policy.js';
import {triggerMarginReports,marginAgentConnection} from './margin-trigger.js';
import {sealToken} from './commercial-policy.js';
const owner='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',secret='test-only-encryption-key',now=new Date('2026-12-10T09:00:00Z');
function fixture(){
 const tables={margin_report_plans:[{owner_id:owner,enabled:true,approved_by:owner,approved_at:'2026-11-09T10:00Z',policy_hash:MARGIN_POLICY_HASH,agent_hash:MARGIN_AGENT_HASH}],margin_report_runs:[],margin_report_triggers:[],commercial_report_settings:[{singleton:true,owner_id:owner,token_encrypted:sealToken('test-only-chatgpt-access-token',secret,owner)}],utenti:[{id:owner,attivo:true,ruoli:{amministratore_workspace:true}}]};
 const db={from(name){let filters=[],mode='read',payload,single=false;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},maybeSingle(){single=true;return q},single(){single=true;return q},insert(v){mode='insert';payload=v;return q},update(v){mode='update';payload=v;return q},then(resolve,reject){try{let data=tables[name].filter(r=>filters.every(f=>f(r)));if(mode==='insert'){if(tables[name].some(r=>r.owner_id===payload.owner_id&&r.period===payload.period))return Promise.resolve({error:{code:'23505'}}).then(resolve,reject);const row={id:'trigger-1',...payload};tables[name].push(row);data=[row];}if(mode==='update')data.forEach(r=>Object.assign(r,payload));return Promise.resolve({data:single?data[0]||null:data}).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q}};
 return {db,tables};
}
test('monthly timing follows Rome through winter, summer and year boundary',()=>{
 assert(marginTriggerDue(now));assert(marginTriggerDue(new Date('2027-07-10T08:00Z')));
 assert(!marginTriggerDue(new Date('2027-07-10T09:00Z')));assert(!marginTriggerDue(new Date('2026-12-09T09:00Z')));
});
test('disabled or changed plan cannot start ChatGPT and matching owner is required',async()=>{
 const f=fixture();f.tables.margin_report_plans[0].enabled=false;
 const deps={now,secret,fetchImpl:()=>{throw Error('must not call')}};
 assert.equal((await triggerMarginReports(f.db,deps)).status,'no_active_plan');
 f.tables.margin_report_plans[0].enabled=true;f.tables.margin_report_plans[0].policy_hash='outdated-policy';
 assert.equal((await triggerMarginReports(f.db,deps)).status,'no_active_plan');
 assert.equal((await marginAgentConnection(f.db,'other-owner')).ready,false);
 f.tables.margin_report_plans[0].policy_hash=MARGIN_POLICY_HASH;f.tables.commercial_report_settings[0].owner_id='other-owner';
 await assert.rejects(triggerMarginReports(f.db,deps),/Collegamento/);assert.equal(f.tables.margin_report_triggers.length,0);
});
test('one ChatGPT invocation per owner/period, precise YTD and separate key from commercial',async()=>{
 const f=fixture();let calls=0;
 const deps={now,secret,fetchImpl:async(url,o)=>{calls++;assert.equal(url,`https://api.chatgpt.com/v1/workspace_agents/${MARGIN_AGENT.channel}/trigger`);assert.equal(o.headers.Authorization,'Bearer test-only-chatgpt-access-token');assert.match(o.headers['Idempotency-Key'],/^progre-margin-/);const body=JSON.parse(o.body);assert.match(body.input,/2026-01-01 al 2026-11-30/);return {status:202,json:async()=>({conversation_url:'https://chatgpt.com/c/test-run',agent_trigger_run_id:'apirun_test'})}}};
 const r=await triggerMarginReports(f.db,deps);assert.equal(r.results[0].status,'requested');assert.equal(f.tables.margin_report_triggers[0].trigger_run_id,'apirun_test');
 await triggerMarginReports(f.db,deps);assert.equal(calls,1);
});
test('accepted or timed-out requests cannot be retriggered automatically; existing PDF prevents regeneration',async()=>{
 const f=fixture();let calls=0;const deps={now,secret,fetchImpl:async()=>{calls++;throw Error('timeout')}};
 await assert.rejects(triggerMarginReports(f.db,deps));assert.equal(f.tables.margin_report_triggers[0].status,'attention');
 await triggerMarginReports(f.db,deps);assert.equal(calls,1);
 f.tables.margin_report_triggers=[];f.tables.margin_report_runs=[{id:'pdf',owner_id:owner,period:'2026-11-01',status:'uncertain'}];
 assert.equal((await triggerMarginReports(f.db,deps)).results[0].status,'existing_report');assert.equal(calls,1);
 f.tables.margin_report_runs[0].status='queued';let dispatches=0;await triggerMarginReports(f.db,{...deps,dispatch:async()=>{dispatches++}});assert.equal(dispatches,1);assert.equal(calls,1);
});
