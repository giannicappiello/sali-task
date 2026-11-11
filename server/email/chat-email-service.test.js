import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareChatEmail,sendChatEmail,decideChatEmailDelegation,decideChatEmailHuman,hashChatEmailDelegation,getChatEmail,proposeChatEmailDelegation} from './chat-email-service.js';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const input={recipient:'one@example.test',subject:'Hello',body:'Text',idempotencyKey:'request_123'};
test('chat prepare is task-free, explicit single-recipient text; rejects bypass fields',async()=>{
 const calls=[];const auth={scoped:{rpc:async(...args)=>{calls.push(args);return {data:{id}};}}};
 assert.deepEqual(await prepareChatEmail(auth,input),{id});
 assert.equal(calls[0][0],'workspace_prepare_chat_email');assert.ok(!('p_task' in calls[0][1]));
 for(const extra of [{taskId:id},{userConfirmed:true},{attachments:[]},{viaAI:false},{recipient:'one@example.test,two@example.test'},{subject:'X\nBcc: nope'}]) await assert.rejects(prepareChatEmail(auth,{...input,...extra}));
 assert.equal(calls.length,1);
});
test('delegated send never falls back to human/admin, propagates activation requirement',async()=>{
 const auth={scoped:{rpc:async()=>({error:{message:'EMAIL_DELEGATION_REQUIRED'}})},admin:{rpc:()=>assert.fail('No fallback')}};
 await assert.rejects(sendChatEmail(auth,{id,expectedHash:'a'.repeat(64)}),e=>e.code==='EMAIL_DELEGATION_REQUIRED'&&e.status===403);
});
test('human decision actor always comes from authenticated profile; stable hash',async()=>{
 const calls=[];const auth={profile:{id},admin:{rpc:async(...args)=>{calls.push(args);return {data:{id}};}}};
 await decideChatEmailDelegation(auth,{id:other,confirm:true,expectedHash:'a'.repeat(64),actor:other});
 await decideChatEmailHuman(auth,{id:other,confirm:false,expectedHash:'b'.repeat(64),actor:other});
 assert.equal(calls[0][1].p_actor,id);assert.equal(calls[1][1].p_actor,id);
 assert.equal(hashChatEmailDelegation({policy_hash:'a'.repeat(64)}),'a'.repeat(64));
 await assert.rejects(decideChatEmailDelegation(auth,{id,confirm:'true',expectedHash:'a'.repeat(64)}));
});
test('chat reads constrain source and author, hide worker tokens, not-found is 404',async()=>{
 const filters=[];const q={select:columns=>{assert.ok(!columns.includes('lock_token'));return q;},eq:(...pair)=>{filters.push(pair);return q;},maybeSingle:async()=>({data:null})};
 await assert.rejects(getChatEmail({profile:{id},scoped:{from:()=>q}},other),e=>e.status===404);
 assert.deepEqual(filters,[['id',other],['source_kind','chat'],['author_id',id]]);
});

test('To and CC use a separate v2 RPC with canonical complete recipients', async()=>{
 const calls=[];const auth={scoped:{rpc:async(...args)=>{calls.push(args);return {data:{id}};}}};
 const multi={to:[' One@Example.Test ','two@example.test'],cc:['COPY@example.test'],subject:'Subject',body:'Body',idempotencyKey:'request_multi'};
 await prepareChatEmail(auth,multi);
 assert.deepEqual(calls[0],['workspace_prepare_chat_email_v2',{p_to:['one@example.test','two@example.test'],p_cc:['copy@example.test'],p_subject:'Subject',p_body:'Body',p_idempotency_key:'request_multi'}]);
 for(const bad of [{recipient:'one@example.test'},{to:[]},{cc:'copy@example.test'},{cc:['ONE@example.test']},{to:['one@example.test','ONE@example.test']},{to:['one@example.test\r\n']},{to:Array.from({length:31},(_,i)=>`user${i}@example.test`)},{bcc:[]}]) await assert.rejects(prepareChatEmail(auth,{...multi,...bad}));
 assert.equal(calls.length,1);
});

test('v3 proposal routes explicitly without changing legacy defaults',async()=>{
 const calls=[];const auth={scoped:{rpc:async name=>{calls.push(name);return {data:{status:'proposed'}};}}};
 await proposeChatEmailDelegation(auth);await proposeChatEmailDelegation(auth,{policyVersion:'chat-email-v2'});await proposeChatEmailDelegation(auth,{policyVersion:'chat-email-v3'});
 assert.deepEqual(calls,['workspace_propose_email_delegation','workspace_propose_email_delegation_v2','workspace_propose_email_delegation_v3']);
 await assert.rejects(proposeChatEmailDelegation(auth,{policyVersion:'chat-email-v4'}));
});
