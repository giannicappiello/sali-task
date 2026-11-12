import test from 'node:test';
import assert from 'node:assert/strict';
import { anomalyEmail,buildEmailJobs,claimAnomalyEmail,anomalyEmailAction,anomalyWorkerReady,dispatchAnomalyEmails,enqueueAnomalyEmails,verifyAnomalyReadiness,authorizedRecipients } from './delivery.js';

test('excluded commercial departments never resolve managers or saved overrides; production managers remain eligible', async () => {
 const names = [' Beauty   Consultant ', 'CLIENTE PRIVATE', 'Field Force Estero', 'Field Force Farmacie', 'Field Force Professional', 'Produzione'];
 const departments = names.map((nome, i) => ({ id: `d${i}`, nome }));
 const users = names.map((_, i) => ({ id: `m${i}`, auth_user_id: `auth${i}`, attivo: true, email: `m${i}@example.test` }));
 const memberships = departments.map((d, i) => ({ reparto_id: d.id, utente_id: `member${i}` }));
 const members = names.map((_, i) => ({ id: `member${i}`, attivo: true, responsabile_utente_id: `m${i}` }));
 const db = {
  from(table) { const q = { select() { return q; }, eq() { return q; }, in() { return q; }, then(resolve) { return Promise.resolve({ data: table === 'utenti' ? [...users, ...members] : table === 'reparti' ? departments : memberships }).then(resolve); } }; return q; },
  async rpc(name) { return { data: name === 'workspace_area_access_codes' ? ['anomalie'] : true }; },
 };
 const policy = { departmentManager: true, workspaceAdmins: false, additionalUserIds: [], departmentOverrides: {} };
 const ids = departments.map(d => d.id);
 assert.deepEqual((await authorizedRecipients(db, policy, ids)).map(p => p.userId), ['m5']);
 policy.departmentOverrides = Object.fromEntries(departments.slice(0, 5).map(d => [d.id, 'm0']));
 assert.deepEqual((await authorizedRecipients(db, policy, ids)).map(p => p.userId), ['m5']);
 policy.departmentManager = false; policy.additionalUserIds = ['m1'];
 assert.deepEqual((await authorizedRecipients(db, policy, ids)).map(p => p.userId), ['m1']);
});

test('daily text email makes incomplete coverage and no-auto-change policy explicit',()=>{
 const result=anomalyEmail({day:'2026-11-10',window:{from:'2026-11-10',toExclusive:'2026-12-08'},findings:[{severity:'high',title:'Carenza',description:'Materiale insufficiente',evidence:{article:'MP1',shortage:2,unit:'KG'}}],coverage:{movements:{complete:false,reason:'cutoff non verificato'}},runUrl:'https://workspace.progre.it/anomalie?run=1'});
 assert.match(result.body,/INCOMPLETO/);assert.match(result.body,/cutoff non verificato/);assert.match(result.body,/carenza 2 KG/);assert.match(result.body,/nessun ordine/i);assert.match(result.body,/workspace\.progre\.it/);
});

test('per-department email excludes other departments and includes every assigned department once',()=>{
 const jobs=buildEmailJobs({recipients:[{userId:'a',email:'a@example.test',departmentIds:['d1','d3']}],day:'2026-11-10',window:{from:'2026-11-10',toExclusive:'2026-12-08'},findings:[{severity:'high',title:'In scope',description:'x',department_id:'d1'},{severity:'warning',title:'Second assigned scope',description:'x',department_id:'d3'},{severity:'critical',title:'Private other',description:'y',department_id:'d2'}],coverage:{},runUrl:'https://workspace.progre.it/anomalie'});
 assert.match(jobs[0].body,/In scope/);assert.doesNotMatch(jobs[0].body,/Private other/);
 assert.match(jobs[0].body,/Second assigned scope/);assert.deepEqual(jobs[0].scope_department_ids,['d1','d3']);
 assert.match(jobs[0].body,/Ambito destinatario: reparti assegnati/);
});

test('configured administrators receive global findings even without mapped departments',async()=>{
 const admin={id:'11111111-1111-4111-8111-111111111111',auth_user_id:'auth-admin',attivo:true,email:'admin@example.test',ruoli:{amministratore_workspace:true}};
 const calls=[];
 const db={from(table){const q={select(){return q;},eq(){return q;},in(){return q;},then(resolve){return Promise.resolve({data:table==='utenti'?[admin]:[]}).then(resolve);}};return q;},async rpc(name,args){calls.push({name,args});return {data:name==='workspace_area_access_codes'?['anomalie']:name==='anomaly_queue_email'?args.p_jobs.length:true};}};
 const result=await enqueueAnomalyEmails(db,{actorId:admin.id,run:{id:'run-1'},window:{from:'2026-11-11',toExclusive:'2026-12-09'},findings:[{title:'Lacuna globale',description:'cutoff',severity:'warning',department_id:null}],coverage:{},departmentIds:[],policy:{workspaceAdmins:true,departmentManager:false}});
 assert.equal(result.queued,1);
 const job=calls.find(x=>x.name==='anomaly_queue_email').args.p_jobs[0];
 assert.equal(job.recipient_id,admin.id);assert.equal(job.scope_department_ids,null);assert.match(job.body,/Lacuna globale/);
});

test('claimed delivery stays uncertain on ambiguous transport and cannot be replayed',async()=>{
 const calls=[];const db={async rpc(name,args){calls.push({name,args});if(name==='anomaly_claim_email')return {data:[{id:'11111111-1111-4111-8111-111111111111',lock_token:'lock',recipient_email:'a@example.test',subject:'s',body:'b'}]};return {data:true};}};
 const claim=await claimAnomalyEmail(db,'worker');assert.equal(claim.attachments.length,0);
 const result=await anomalyEmailAction(db,{email_id:claim.email.id,worker_id:claim.worker_id,lock_token:claim.email.lock_token,action:'retry',definitive:false});
 assert.equal(result.status,'uncertain');assert.equal(calls.at(-1).args.p_status,'uncertain');
});

test('email readiness and dispatch require the dedicated text-only worker protocol',async()=>{
 const env={ARUBA_EMAIL_WORKER_URL:'https://worker.example.test/worker.php',ARUBA_EMAIL_WORKER_SECRET:'test-secret'};const calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url:String(url),options});if(options.method==='GET')return new Response(JSON.stringify({anomaly_email_protocol:1,queue_enabled:true,attachments_enabled:false,text_only:true,from_email:'progre@example.test'}),{status:200});return new Response(JSON.stringify({status:'ok',results:[{status:'sent',attachments:0}]}),{status:200});};
 const ready=await anomalyWorkerReady(fetchImpl,env);assert.equal(ready.anomaly_email_protocol,1);assert.match(calls[0].url,/action=anomaly_email_capabilities/);
 const result=await dispatchAnomalyEmails({fetchImpl,env});assert.equal(result.status,'dispatch_completed');assert.equal(JSON.parse(calls[2].options.body).action,'run_anomalies');
 await assert.rejects(anomalyWorkerReady(async()=>new Response(JSON.stringify({report_protocol:1,queue_enabled:true,from_email:'x@y.z'}),{status:200}),env),{code:'EMAIL_WORKER_NOT_READY'});
});

test('readiness verifies the configured scheduled owner and persisted recipient policy',async()=>{
 const admin={id:'admin',auth_user_id:'auth-admin',attivo:true,email:'admin@example.test',ruoli:{amministratore_workspace:true}};
 const actor={...admin,id:'actor'};
 const agent={enabled:false,config_version:3,recipient_policy:{workspaceAdmins:true,departmentManager:false}};
 let verifiedOwner;
 const db={from(table){let target;const q={select(){return q;},eq(key,value){if(key==='id')target=value;return q;},in(){return q;},single:async()=>({data:agent}),maybeSingle:async()=>({data:target==='actor'?actor:admin}),then(resolve){return Promise.resolve({data:table==='utenti'?[admin]:table==='reparti'?[{id:'dept-with-no-manager'}]:[]}).then(resolve);}};return q;},async rpc(name){return {data:name==='workspace_area_access_codes'?['anomalie']:true};}};
 const env={FABBISOGNI_OWNER_PROFILE_ID:'scheduled-owner',ARUBA_EMAIL_WORKER_URL:'https://worker.example.test',ARUBA_EMAIL_WORKER_SECRET:'fixture'};
 const result=await verifyAnomalyReadiness(db,{ownerId:'actor',env,collectSnapshot:async(_db,id)=>{verifiedOwner=id;return {coverage:{}};},fetchImpl:async()=>Response.json({anomaly_email_protocol:1,queue_enabled:true,attachments_enabled:false,text_only:true,from_email:'a@example.test'})});
 assert.equal(verifiedOwner,'scheduled-owner');assert.equal(result.readiness.ready,true);assert.equal(result.readiness.recipients.ready,true);assert.equal(result.enabled,false);
 await assert.rejects(verifyAnomalyReadiness(db,{ownerId:'actor',env:{}}),{code:'SCHEDULED_OWNER_NOT_CONFIGURED'});
});

test('large daily reports remain bounded, counted and linked without mutating findings',()=>{
 const findings=Array.from({length:132},(_,i)=>({fingerprint:String(i).padStart(3,'0'),severity:i<75?'high':'warning',title:`Problema ${i} ${'X'.repeat(400)}`,description:'Dettagli '.repeat(200),evidence:{jobId:i,article:'MP1',shortage:2,unit:'KG'}}));
 const original=structuredClone(findings);
 const input={recipients:[{userId:'a',email:'a@example.test',departmentIds:null}],day:'2026-11-12',window:{from:'2026-11-12',toExclusive:'2026-12-10'},findings,coverage:{bom:{complete:false,reason:'Distinta non verificata'}},runUrl:'https://workspace.progre.it/anomalie?run=1'};
 const [job]=buildEmailJobs(input);
 assert(Array.from(job.body).length<20000);assert.match(job.body,/Segnalazioni totali: 132/);assert.match(job.body,/alte\/critiche: 75/);assert.match(job.body,/10 di 75/);assert.match(job.body,/5 di 57/);assert.match(job.body,/Distinta non verificata/);assert.match(job.body,/Elenco completo/);assert.match(job.body,/anomalie\?run=1/);
 assert.deepEqual(findings,original);
 assert.deepEqual(buildEmailJobs({...input,findings:[...findings].reverse()}),[job]);
});

test('critical priority, bounded Unicode excerpts and coverage limits survive huge data',()=>{
 const input={recipients:[{userId:'a',email:'a@example.test',departmentIds:null}],day:'2026-11-12',window:{from:'2026-11-12',toExclusive:'2026-12-10'},findings:[...Array.from({length:10000},(_,i)=>({fingerprint:`f${i}`,severity:'high',title:'😀'.repeat(1000),description:'D'.repeat(5000)})),{severity:'critical',title:'Priorità assoluta'}],coverage:Object.fromEntries(Array.from({length:100},(_,i)=>[`source${i}`,{complete:false,reason:'Lacuna'.repeat(1000)}])),runUrl:'https://workspace.progre.it/anomalie?run=1'};
 const [job]=buildEmailJobs(input);
 assert(Array.from(job.body).length<20000);assert.match(job.body,/1\. \[CRITICAL\] Priorità assoluta/);assert.match(job.body,/12 di 100 lacune/);assert.doesNotMatch(job.body,/\uFFFD/);
 assert.throws(()=>buildEmailJobs({...input,runUrl:'x'.repeat(20001)}),{code:'ANOMALY_EMAIL_BODY_TOO_LONG'});
});

test('any existing delivery prevents requeue after template changes, including ambiguous attempts',async()=>{
 const admin={id:'11111111-1111-4111-8111-111111111111',auth_user_id:'auth-admin',attivo:true,email:'admin@example.test',ruoli:{amministratore_workspace:true}};
 for(const status of ['pending','accepted','delivered','uncertain','failed']){
  let queued=false;
  const db={from(table){const q={select(){return q;},eq(){return q;},in(){return q;},then(resolve){return Promise.resolve({data:table==='utenti'?[admin]:table==='anomaly_deliveries'?[{recipient_id:admin.id,status}]:[]}).then(resolve);}};return q;},async rpc(name){if(name==='anomaly_queue_email')queued=true;return {data:name==='workspace_area_access_codes'?['anomalie']:true};}};
  const result=await enqueueAnomalyEmails(db,{actorId:admin.id,run:{id:'run'},window:{from:'2026-11-12',toExclusive:'2026-12-10'},findings:[],coverage:{},departmentIds:[],policy:{workspaceAdmins:true,departmentManager:false}});
  assert.equal(result.queued,0);assert.equal(queued,false,status);
 }
});
