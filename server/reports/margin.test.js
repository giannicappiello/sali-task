import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {PDFDocument} from 'pdf-lib';
import {MARGIN_POLICY,MARGIN_POLICY_HASH,marginPeriod,checkMarginPeriod,marginEnvelope} from './margin-policy.js';
import {marginArtifact,marginReportTools,marginWorkerAction} from './margin-service.js';
import {marginHumanRequest} from './margin-handler.js';
import {validateInput} from '../second-brain/schema.js';
const id='35cc0e58-9bad-48a4-9980-0904dd63fc7b',runId='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
function fixture(){
 const tables={commercial_report_settings:[{singleton:true,owner_id:id,token_encrypted:'opaque-test-value'}],margin_report_plans:[{owner_id:id,policy_hash:MARGIN_POLICY_HASH,enabled:false}],margin_report_runs:[{id:runId,owner_id:id,policy_hash:MARGIN_POLICY_HASH,period:marginPeriod(),status:'draft',notes:''}],margin_report_chunks:[],utenti:[{id,attivo:true,ruoli:{amministratore_workspace:true}}]};
 const db={from(name){let filters=[],mode='read',payload,single=false;const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},order(){return q;},limit(){return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},insert(v){mode='insert';payload=v;return q;},update(v){mode='update';payload=v;return q;},delete(){mode='delete';return q;},then(resolve,reject){try{const match=r=>filters.every(f=>f(r));let data=tables[name].filter(match);if(mode==='insert'){tables[name].push(payload);data=[payload];}if(mode==='update')data.forEach(r=>Object.assign(r,payload));if(mode==='delete')tables[name]=tables[name].filter(r=>!match(r));return Promise.resolve({data:single?data[0]||null:data,error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;},rpc:async(name)=>{if(name==='margin_report_activate'){tables.margin_report_plans[0].enabled=true;tables.margin_report_runs[0].status='queued';return {data:true};}throw Error('unexpected RPC');}};
 const auth={profile:{id,ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true},admin:db,scoped:{rpc:async n=>({data:n==='workspace_user_is_admin'?true:{mode:'tutti'}})}};
 return {db,auth,tables};
}
test('period resets at new year only after previous December report; recipients fixed',()=>{
 assert.equal(marginPeriod(new Date('2027-01-10T10:00Z')),'2026-12-01');assert.equal(marginPeriod(new Date('2027-02-10T10:00Z')),'2027-01-01');
 assert.deepEqual(checkMarginPeriod('2026-12-01',new Date('2027-01-10')),{from:'2026-01-01',to:'2026-12-31'});
 assert.throws(()=>checkMarginPeriod('2026-10-01',new Date('2027-01-10')));assert.deepEqual(MARGIN_POLICY.recipients,['giovanni.cappiello@progre.it','roberto.profili@progre.it']);assert(!marginEnvelope('2026-10-01').recipient.includes('ordini@'));
});
test('cannot add arbitrary recipients, activate from artifact tool, or skip admin',async()=>{
 const f=fixture(),schema=marginReportTools(f.auth).MARGIN_REPORT_ARTIFACT.inputSchema;
 assert.throws(()=>validateInput(schema,{action:'activate'}));assert.throws(()=>validateInput(schema,{action:'start',recipient:'other@example.test'}));
 assert.deepEqual(marginReportTools({...f.auth,capabilities:{}}),{});
 await assert.rejects(marginArtifact({...f.auth,scoped:{rpc:async()=>({data:false})}},{action:'status',runId}));
 await assert.rejects(marginArtifact(f.auth,{action:'dispatch',runId}),/Attivazione umana/);
});
test('verified PDF is staged before approval; chunks and finalize idempotent, first upload never sends',async()=>{
 const f=fixture(),pdf=await PDFDocument.create();for(let i=0;i<3;i++)pdf.addPage();const bytes=await pdf.save(),base64=Buffer.from(bytes).toString('base64'),sha256=createHash('sha256').update(bytes).digest('hex');
 await marginArtifact(f.auth,{action:'chunk',runId,part:0,total:1,base64});await marginArtifact(f.auth,{action:'chunk',runId,part:0,total:1,base64});assert.equal(f.tables.margin_report_chunks.length,1);
 await assert.rejects(marginArtifact(f.auth,{action:'finalize',runId,verified:true,sha256:'f'.repeat(64)}),/Integrità/);
 const r=await marginArtifact(f.auth,{action:'finalize',runId,verified:true,sha256});assert.equal(r.run.status,'staged');assert.equal(r.sent,false);assert.equal(r.requiresHumanActivation,true);
 const second=await marginArtifact(f.auth,{action:'finalize',runId,verified:true,sha256});assert.equal(second.alreadyFinalized,true);
});
test('human confirmation binds user, purpose, policy and exact PDF before queueing',async()=>{
 const f=fixture();Object.assign(f.tables.margin_report_runs[0],{status:'staged',sha256:'a'.repeat(64)});let dispatched=0;
 const deps={authorize:async()=>f.auth,key:'test-key-not-a-secret',checkWorker:async()=>({ready:true}),dispatch:async()=>{dispatched++;},schedule:async p=>await p};
 const r=await marginHumanRequest({method:'POST',body:{action:'confirmation',runId}},deps);
 assert.equal(dispatched,0);f.tables.margin_report_runs[0].sha256='b'.repeat(64);
 await assert.rejects(marginHumanRequest({method:'POST',body:{action:'activate',confirmPlan:true,receipt:r.receipt}},deps),/cambiato/);assert.equal(dispatched,0);
 f.tables.margin_report_runs[0].sha256='a'.repeat(64);
 const activated=await marginHumanRequest({method:'POST',body:{action:'activate',confirmPlan:true,receipt:r.receipt}},deps);assert.equal(activated.sent,false);assert.equal(activated.status,'queued');assert.equal(dispatched,1);
 await assert.rejects(marginHumanRequest({method:'POST',body:{action:'activate',confirmPlan:true,receipt:r.receipt}},deps));assert.equal(dispatched,1);
});
test('uncertain outcome never retries, and worker cannot fetch other attachments',async()=>{
 const f=fixture();f.tables.margin_report_plans[0].enabled=true;Object.assign(f.tables.margin_report_runs[0],{status:'uncertain',worker_id:'w',lock_token:'l'});
 const body={email_id:'report:margin:'+runId,worker_id:'w',lock_token:'l'};
 assert.equal((await marginWorkerAction(f.db,{...body,action:'retry'})).status,'uncertain_requires_review');assert.equal(f.tables.margin_report_runs[0].status,'uncertain');
 await assert.rejects(marginWorkerAction(f.db,{...body,action:'attachment',report_artifact_key:'other'}),/fuori/);
 f.tables.margin_report_plans[0].enabled=false;await assert.rejects(marginWorkerAction(f.db,{...body,action:'retry'}),/non attivo/);
});
