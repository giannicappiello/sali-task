import test from 'node:test';
import assert from 'node:assert/strict';
import { anomalyEmail,buildEmailJobs,claimAnomalyEmail,anomalyEmailAction,anomalyWorkerReady,dispatchAnomalyEmails,enqueueAnomalyEmails } from './delivery.js';

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
