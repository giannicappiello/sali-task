import test from 'node:test';
import assert from 'node:assert/strict';
import { activityEmailRequest, dispatchActivityEmailSafely, handleActivityEmail } from './activity-email-handler.js';
import { createReceipt } from '../second-brain/handler.js';
const id='11111111-1111-4111-8111-111111111111';
const taskId='22222222-2222-4222-8222-222222222222';
const hash='a'.repeat(64), key='local-test-key';
function fixture(overrides={}) {
 const email={id,task_id:taskId,author_id:id,via_ai:false,status:'proposed',recipient:'test@example.invalid',subject:'Sollecito',body:'Testo approvato',payload_hash:hash,...overrides};
 const calls=[];
 return {email,calls,deps:{authorize:async(_req,options)=>{calls.push(['authorize',options]);return {profile:{id,nome:'Test'}};},receiptKey:key,dispatch:async()=>{calls.push(['dispatch']);return {status:'ok'};},services:{
  getActivityEmailContext:async()=>({task:{id:taskId},permissions:{canPropose:true,canConfirm:true},emails:[]}),
  listActivityEmails:async()=>({emails:[email],nextOffset:null}),
  getActivityEmail:async()=>email,hashActivityEmail:row=>row.payload_hash,
  proposeActivityEmail:async(_auth,input,options)=>{calls.push(['propose',input,options]);return email;},
  decideActivityEmail:async(_auth,input)=>{calls.push(['decide',input]);return {...email,status:input.confirm?'queued':'rejected'};},
 }}};
}
const request=(body)=>({method:'POST',body,headers:{}});
test('context is read-only, uses normal Workspace authentication and server permissions',async()=>{
 const {deps,calls}=fixture();const value=await activityEmailRequest(request({action:'context',taskId}),deps);
 assert(value.permissions.canPropose);assert.deepEqual(calls,[['authorize',{bypassAIEntitlements:true}]]);
});
test('proposal cannot send and forces manual provenance',async()=>{
 const {deps,calls}=fixture();const value=await activityEmailRequest(request({action:'propose',taskId,recipient:'test@example.invalid',subject:'Sollecito',body:'Testo',idempotencyKey:id}),deps);
 assert.equal(value.sent,false);assert.equal(value.requiresConfirmation,true);assert.deepEqual(calls.at(-1)[2],{viaAI:false});assert(!calls.some(c=>c[0]==='dispatch'));
});
test('additional fields and multiple recipients are rejected before authentication',async()=>{
 const {deps,calls}=fixture();await assert.rejects(activityEmailRequest(request({action:'propose',taskId,recipient:'test@example.invalid',subject:'S',body:'T',idempotencyKey:id,viaAI:true}),deps));
 await assert.rejects(activityEmailRequest(request({action:'propose',taskId,recipient:'a@example.invalid,b@example.invalid',subject:'S',body:'T',idempotencyKey:id}),deps));assert.equal(calls.length,0);
});
test('manual confirmation binds exact hash, identity and receipt purpose',async()=>{
 const {deps,calls}=fixture();const preview=await activityEmailRequest(request({action:'confirmation',id}),deps);assert(preview.receipt);assert(!calls.some(c=>c[0]==='dispatch'));
 const result=await activityEmailRequest(request({action:'decide',receipt:preview.receipt,decision:'confirm'}),deps);assert.equal(result.email.status,'queued');assert.equal(result.sent,false);assert(calls.some(c=>c[0]==='dispatch'));assert.equal(calls.find(c=>c[0]==='decide')[1].expectedHash,hash);
});
test('AI proposal cannot be approved through manual route',async()=>{
 const {deps,calls}=fixture({via_ai:true});await assert.rejects(activityEmailRequest(request({action:'confirmation',id}),deps),/Progre AI/);
 const receipt=createReceipt({userId:id,kind:'activity-email',id,hash,expires:Date.now()+10000},key);await assert.rejects(activityEmailRequest(request({action:'decide',receipt,decision:'confirm'}),deps),/non confermabile/);assert(!calls.some(c=>c[0]==='decide'));
});
test('other author and wrong receipt purpose are rejected',async()=>{
 let f=fixture({author_id:taskId});await assert.rejects(activityEmailRequest(request({action:'confirmation',id}),f.deps),/tua proposta/);
 f=fixture();const receipt=createReceipt({userId:id,kind:'brain',id,hash,expires:Date.now()+10000},key);await assert.rejects(activityEmailRequest(request({action:'decide',receipt,decision:'confirm'}),f.deps),/non valida/);
});
test('changed payload cannot reuse approval and rejection never dispatches',async()=>{
 const f=fixture();const receipt=createReceipt({userId:id,kind:'activity-email',id,hash:'b'.repeat(64),expires:Date.now()+10000},key);await assert.rejects(activityEmailRequest(request({action:'decide',receipt,decision:'confirm'}),f.deps),/cambiata/);
 const preview=await activityEmailRequest(request({action:'confirmation',id}),f.deps);const result=await activityEmailRequest(request({action:'decide',receipt:preview.receipt,decision:'reject'}),f.deps);assert.equal(result.email.status,'rejected');assert(!f.calls.some(c=>c[0]==='dispatch'));
});
test('terminal status has no new receipt and uncertain is never dispatched',async()=>{
 const {deps}=fixture({status:'uncertain'});const value=await activityEmailRequest(request({action:'confirmation',id}),deps);assert.equal(value.terminal,true);assert.equal(value.receipt,undefined);
 let sent=false;assert.equal(await dispatchActivityEmailSafely({status:'uncertain'},async()=>{sent=true;}),undefined);assert.equal(sent,false);
});
test('dispatch failure preserves queued outcome, no provider details leak',async()=>{
 const value=await dispatchActivityEmailSafely({status:'queued'},async()=>{throw Error('secret provider message');});assert.equal(value.status,'error');assert(!JSON.stringify(value).includes('secret'));
});
test('API failure hides backend messages and enforces method',async()=>{
 const f=fixture();await assert.rejects(activityEmailRequest({method:'GET'},f.deps),/Metodo/);
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.value=v;return this;}};
 await handleActivityEmail(request({action:'context',taskId}),res,{...f.deps,services:{getActivityEmailContext:async()=>{throw Error('secret backend');}}});assert.equal(res.statusCode,500);assert(!JSON.stringify(res.value).includes('secret'));assert.equal(res.headers['Cache-Control'],'no-store');
});
