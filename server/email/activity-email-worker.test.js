import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {claimActivityForHttpWorker,activityWorkerAction,processNextActivityEmailJob,triggerActivityEmailWorker} from './activity-email-worker.js';
const job={id:'11111111-1111-4111-8111-111111111111',lock_token:'22222222-2222-4222-8222-222222222222',recipient:'private@example.test',subject:'private subject',body:'private body'};
function dbMock({finishError=false,idle=false}={}) {
  const calls=[];
  return {calls,async rpc(name,args) {
    calls.push({name,args});
    if(name==='workspace_claim_email') return {data:idle?[]:[job]};
    if(name==='workspace_finish_email' && finishError) return {error:{message:job.body}};
    return {data:name==='workspace_expire_email_claims'?0:true};
  }};
}
test('SMTP accepts without attachments, sending claim before handoff',async()=>{
 const db=dbMock();
 const result=await processNextActivityEmailJob({supabase:db,workerId:'test',smtp:{async send(payload){
   assert.equal(db.calls.at(-1).name,'workspace_claim_email');
   assert.deepEqual(payload,{to:job.recipient,subject:job.subject,text:job.body,attachments:[]});
   return {messageId:'provider-id'};
 }}});
 assert.equal(result.status,'accepted');
 assert.equal(db.calls.at(-1).args.p_status,'accepted');
 assert.equal(db.calls.at(-1).args.p_provider_message_id,'provider-id');
});
test('ambiguous SMTP response is uncertain, no content in errors and no retry',async()=>{
 const db=dbMock();let sends=0;
 const result=await processNextActivityEmailJob({supabase:db,workerId:'test',smtp:{async send(){sends++;throw new Error(job.body);}}});
 assert.equal(result.status,'uncertain');assert.equal(sends,1);
 assert.equal(db.calls.at(-1).args.p_status,'uncertain');
 assert.ok(!JSON.stringify(db.calls).includes(job.body));
});
test('definitive SMTP rejection fails, never queues again',async()=>{
 const db=dbMock();
 const result=await processNextActivityEmailJob({supabase:db,workerId:'test',smtp:{async send(){throw Object.assign(new Error('private'),{code:'EENVELOPE'});}}});
 assert.equal(result.status,'failed');assert.equal(db.calls.at(-1).args.p_status,'failed');
});
test('lost acceptance acknowledgement remains uncertain without SMTP retry',async()=>{
 const db=dbMock({finishError:true});let sends=0;
 const result=await processNextActivityEmailJob({supabase:db,workerId:'test',smtp:{async send(){sends++;return {messageId:'id'};}}});
 assert.equal(sends,1);assert.equal(result.status,'uncertain');
 assert.equal(db.calls.at(-1).args.p_status,'uncertain');
});
test('idle SMTP does not send',async()=>{
 assert.deepEqual(await processNextActivityEmailJob({supabase:dbMock({idle:true}),workerId:'test',smtp:{send(){assert.fail();}}}),{status:'idle'});
});
test('HTTP claim uses activity namespace and empty attachments',async()=>{
 const payload=await claimActivityForHttpWorker(dbMock(),'test');
 assert.equal(payload.email.id,`activity:${job.id}`);assert.deepEqual(payload.attachments,[]);
});
test('HTTP completion requires protocol, validates UUID, ignores untrusted diagnostics',async()=>{
 const db=dbMock();
 for(const payload of [{activity_email_protocol:0},{email_id:'activity:invalid'},{action:'retry'}]) {
  await assert.rejects(activityWorkerAction(db,{email_id:`activity:${job.id}`,lock_token:job.lock_token,action:'accepted',activity_email_protocol:1,...payload}));
 }
 assert.equal(db.calls.length,0);
 await activityWorkerAction(db,{email_id:`activity:${job.id}`,lock_token:job.lock_token,action:'uncertain',activity_email_protocol:1,error:job.body});
 assert.equal(db.calls[0].args.p_error_code,'transport_uncertain');
});
test('dispatcher capability gates legacy workers and restricts POST to activities',async()=>{
 const oldUrl=process.env.ARUBA_EMAIL_WORKER_URL,oldSecret=process.env.ARUBA_EMAIL_WORKER_SECRET;
 process.env.ARUBA_EMAIL_WORKER_URL='https://example.test/worker.php';process.env.ARUBA_EMAIL_WORKER_SECRET='test';
 try {
  let calls=[];
  assert.deepEqual(await triggerActivityEmailWorker({fetchImpl:async(url,options)=>{calls.push(options);return Response.json({report_protocol:1});}}),{status:'unsupported'});
  assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');calls=[];
  const result=await triggerActivityEmailWorker({fetchImpl:async(url,options)=>{
   calls.push(options);return Response.json(options.method==='GET'?{activity_email_protocol:1,queue_enabled:true}:{status:'ok',results:[{status:'accepted'}]});
  }});
  assert.deepEqual(result,{status:'ok',accepted:1});assert.deepEqual(JSON.parse(calls[1].body),{action:'run_activity'});
 } finally {
  if(oldUrl===undefined)delete process.env.ARUBA_EMAIL_WORKER_URL;else process.env.ARUBA_EMAIL_WORKER_URL=oldUrl;
  if(oldSecret===undefined)delete process.env.ARUBA_EMAIL_WORKER_SECRET;else process.env.ARUBA_EMAIL_WORKER_SECRET=oldSecret;
 }
});

import {createEmailWorkerHandler} from '../../api/mexal/orders/email-worker.js';
import {processNextWorkspaceEmailJob} from '../orders/workspace-email-job.js';
test('HTTP legacy, report-only, shipment and activity-only queues remain isolated',async()=>{
 const old=process.env.ARUBA_EMAIL_WORKER_SECRET;process.env.ARUBA_EMAIL_WORKER_SECRET='unit-test';
 try {
  for(const [body,names] of [
   [{action:'claim'},['claim_next_order_email']],
   [{action:'claim',report_protocol:1,reports_only:true,activity_email_protocol:1},['commercial_report_claim_email']],
   [{action:'claim',shipment_protocol:1},['warehouse_claim_shipment_email','claim_next_order_email']],
   [{action:'claim',activity_only:true,activity_email_protocol:1,report_protocol:1,shipment_protocol:1},['workspace_expire_email_claims','workspace_claim_email']],
  ]) {
   const calls=[];
   const handler=createEmailWorkerHandler({getClient:()=>({rpc:async(name)=>{calls.push(name);return {data:null};}})});
   const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
   await handler({method:'POST',headers:{authorization:'Bearer unit-test','x-worker-source':'test'},body},res);
   assert.equal(res.statusCode,200);assert.equal(res.body.status,'idle');assert.deepEqual(calls,names);
  }
 } finally {if(old===undefined)delete process.env.ARUBA_EMAIL_WORKER_SECRET;else process.env.ARUBA_EMAIL_WORKER_SECRET=old;}
});
test('SMTP dispatcher preserves shipment then order priority before activities',async()=>{
 const calls=[];
 const supabase={rpc:async(name)=>{calls.push(name);return {data:null};}};
 const result=await processNextWorkspaceEmailJob({supabase,smtp:{send(){assert.fail();}},workerId:'test',logger:{log(){},error(){}}});
 assert.equal(result.status,'idle');
 assert.deepEqual(calls,['warehouse_claim_shipment_email','claim_next_order_email','workspace_expire_email_claims','workspace_claim_email']);
});
