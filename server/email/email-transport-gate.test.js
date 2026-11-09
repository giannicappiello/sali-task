import test from 'node:test';
import assert from 'node:assert/strict';
import {getActivityEmailTransport,requireActivityEmailTransport,triggerActivityEmailWorker} from './activity-email-worker.js';
import {chatEmailTools} from '../second-brain/chat-email-tools.js';
import {handleSecondBrain,createReceipt} from '../second-brain/handler.js';
import {activityEmailRequest,dispatchActivityEmailSafely,scheduleActivityEmailDispatch} from './activity-email-handler.js';
const id='11111111-1111-4111-8111-111111111111', hash='a'.repeat(64),key='unit-test';
const auth={profile:{id},capabilities:{internal_data:true,role_ai_level:'conferma'}};
const environment={ARUBA_EMAIL_WORKER_URL:'https://example.invalid/worker.php',ARUBA_EMAIL_WORKER_SECRET:'unit-test'};
const unavailable=['not_configured','unsupported','paused','unavailable'];
const never=()=>assert.fail('must not write or schedule');
const row={id,author_id:id,source_kind:'chat',via_ai:true,status:'proposed',payload_hash:hash,policy_hash:hash,policy_version:'chat-email-v1'};

test('read-only readiness and dispatcher never POST for unready transports',async()=>{
 for(const status of unavailable){
  const methods=[];
  const options={environment:status==='not_configured'?{}:environment,fetchImpl:async(_url,options)=>{
   methods.push(options.method);assert.equal(options.method,'GET');
   if(status==='unavailable')throw Error('private provider diagnostic');
   return Response.json(status==='unsupported'?{report_protocol:1}:{activity_email_protocol:1,queue_enabled:false});
  }};
  assert.deepEqual(await getActivityEmailTransport(options),{ready:false,status});
  assert.deepEqual(await triggerActivityEmailWorker(options),{status});
  assert.equal(methods.includes('POST'),false);
 }
 const result=await getActivityEmailTransport({environment,fetchImpl:async(_url,options)=>{assert.equal(options.method,'GET');return Response.json({activity_email_protocol:1,queue_enabled:true});}});
 assert.deepEqual(result,{ready:true,status:'ready'});
});

for(const status of unavailable){
 const transport=async()=>({ready:false,status});
 test(`${status}: chat capability fails closed; send cannot write or schedule; history/status work`,async()=>{
  const tools=chatEmailTools(auth,{transport,schedule:never,service:{getChatEmailCapability:async()=>({enabled:true,canSend:true}),sendChatEmail:never,getChatEmail:async()=>row,listChatEmails:async()=>({emails:[row]})}});
  const capability=await tools.WORKSPACE_EMAIL_CAPABILITY.execute({});
  assert.equal(capability.canSend,false);assert.deepEqual(capability.transport,{ready:false,status});
  await assert.rejects(tools.WORKSPACE_EMAIL_SEND.execute({id,expectedHash:hash}),e=>e.code==='EMAIL_TRANSPORT_NOT_READY'&&e.status===409);
  assert.equal((await tools.WORKSPACE_EMAIL_STATUS.execute({id})).id,id);
  assert.equal((await tools.WORKSPACE_EMAIL_HISTORY.execute({})).emails.length,1);
 });
 test(`${status}: human email and delegation confirmations cannot write or schedule`,async()=>{
  for(const kind of ['email','email-delegation']){
   const deps={transport,authorize:async()=>auth,catalog:()=>({}),receiptKey:key,schedule:never,dispatchActivityEmail:never,
    emailService:{getActivityEmail:async()=>row,hashActivityEmail:()=>hash,decideActivityEmail:never},
    chatService:{getChatEmail:async()=>row,getChatEmailDelegation:async()=>row,hashChatEmailDelegation:()=>hash,decideChatEmailDelegation:never,decideChatEmailHuman:never}};
   const preview=await handleSecondBrain({method:'POST',body:{action:'confirmation',kind,id}},deps);
   await assert.rejects(handleSecondBrain({method:'POST',body:{action:'decide',receipt:preview.receipt,decision:'confirm'}},deps),e=>e.code==='EMAIL_TRANSPORT_NOT_READY');
  }
  const manual={...row,source_kind:'activity',via_ai:false};
  await assert.rejects(activityEmailRequest({method:'POST',body:{action:'decide',decision:'confirm',receipt:createReceipt({userId:id,kind:'activity-email',id,hash,expires:Date.now()+10000},key)}},
   {transport,authorize:async()=>auth,receiptKey:key,schedule:never,dispatch:never,services:{getActivityEmail:async()=>manual,hashActivityEmail:()=>hash,decideActivityEmail:never}}),e=>e.code==='EMAIL_TRANSPORT_NOT_READY');
 });
 test(`${status}: human revoke and email rejection do not require readiness`,async()=>{
  let written=0;
  const deps={transport:never,authorize:async()=>auth,catalog:()=>({}),receiptKey:key,schedule:never,
   chatService:{getChatEmailDelegation:async()=>({...row,status:'active'}),hashChatEmailDelegation:()=>hash,decideChatEmailDelegation:async()=>{written++;return {...row,status:'revoked'};}}};
  const preview=await handleSecondBrain({method:'POST',body:{action:'confirmation',kind:'email-delegation',id}},deps);
  const result=await handleSecondBrain({method:'POST',body:{action:'decide',receipt:preview.receipt,decision:'reject'}},deps);
  assert.equal(result.delegation.status,'revoked');assert.equal(written,1);
  const manual={...row,via_ai:false};
  const rejected=await activityEmailRequest({method:'POST',body:{action:'decide',decision:'reject',receipt:createReceipt({userId:id,kind:'activity-email',id,hash,expires:Date.now()+10000},key)}},
   {transport:never,authorize:async()=>auth,receiptKey:key,schedule:never,services:{getActivityEmail:async()=>manual,hashActivityEmail:()=>hash,decideActivityEmail:async()=>({...manual,status:'rejected'})}});
  assert.equal(rejected.email.status,'rejected');
 });
}
test('unexpected readiness errors fail closed and never leak diagnostics',async()=>{
 const tools=chatEmailTools(auth,{transport:async()=>{throw Error('private value');},service:{getChatEmailCapability:async()=>({canSend:true}),getChatEmail:async()=>row,sendChatEmail:never},schedule:never});
 const capability=await tools.WORKSPACE_EMAIL_CAPABILITY.execute({});assert.equal(capability.canSend,false);assert.equal(capability.transport.status,'unavailable');
 await assert.rejects(tools.WORKSPACE_EMAIL_SEND.execute({id,expectedHash:hash}),e=>e.code==='EMAIL_TRANSPORT_NOT_READY'&&!e.message.includes('private value'));
});

test('v2 readiness rejects legacy transport without ever dispatching a POST',async()=>{
 for(const capability of [{activity_email_protocol:1,queue_enabled:true},{activity_email_protocol:2,queue_enabled:true},{activity_email_protocol:1,activity_email_protocols:[1,2],queue_enabled:true}]){
  const methods=[];const options={environment,requiredProtocol:2,fetchImpl:async(_url,request)=>{
   methods.push(request.method);return Response.json(request.method==='GET'?capability:{status:'ok',results:[]});
  }};
  const supported=capability.activity_email_protocol===2||capability.activity_email_protocols?.includes(2);
  assert.deepEqual(await getActivityEmailTransport(options),supported?{ready:true,status:'ready'}:{ready:false,status:'unsupported'});
  await triggerActivityEmailWorker(options);
  assert.equal(methods.includes('POST'),!!supported);
 }
});
test('require readiness forwards the required protocol and fails closed',async()=>{
 await assert.rejects(requireActivityEmailTransport(async options=>{
  assert.equal(options.requiredProtocol,2);return {ready:false,status:'unsupported'};
 },{requiredProtocol:2}),error=>error.code==='EMAIL_TRANSPORT_NOT_READY');
});

test('post-queue wake-up preserves the row protocol and never POSTs v2 to a downgraded worker',async()=>{
 for(const [version,capability,shouldPost] of [
  [undefined,{activity_email_protocol:1,queue_enabled:true},true],
  [1,{activity_email_protocol:1,queue_enabled:true},true],
  [2,{activity_email_protocol:1,queue_enabled:true},false],
  [2,{activity_email_protocol:1,activity_email_protocols:[1,2],queue_enabled:true},true],
 ]){
  const methods=[];const email={id,status:'queued',transport_protocol_version:version};
  const before=JSON.stringify(email);
  const dispatch=options=>{
   assert.equal(options.requiredProtocol,version||1);
   return triggerActivityEmailWorker({...options,environment,fetchImpl:async(_url,request)=>{
    methods.push(request.method);return Response.json(request.method==='GET'?capability:{status:'ok',results:[]});
   }});
  };
  const result=await dispatchActivityEmailSafely(email,dispatch);
  assert.equal(result.status,shouldPost?'ok':'unsupported');
  assert.equal(methods.includes('POST'),shouldPost);
  assert.equal(JSON.stringify(email),before,'wake-up must not mutate or requeue the message');
 }
});
test('scheduled wake-up forwards protocol2 and terminal messages do not dispatch',async()=>{
 const scheduled=[];let calls=0;
 const dispatch=async options=>{calls++;assert.deepEqual(options,{requiredProtocol:2});return {status:'ok'};};
 assert.deepEqual(scheduleActivityEmailDispatch({status:'queued',transport_protocol_version:2},{dispatch,schedule:work=>scheduled.push(work)}),{status:'scheduled'});
 await Promise.all(scheduled);assert.equal(calls,1);
 for(const status of ['accepted','uncertain','failed']) assert.equal(scheduleActivityEmailDispatch({status,transport_protocol_version:2},{dispatch,schedule:never}),undefined);
 assert.equal(calls,1);
});
