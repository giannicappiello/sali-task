import test from 'node:test';
import assert from 'node:assert/strict';
import { chatEmailTools } from './chat-email-tools.js';
import { handleSecondBrain } from './handler.js';
const id='11111111-1111-4111-8111-111111111111', hash='a'.repeat(64);
const auth={profile:{id,nome:'Test',ruoli:{}},capabilities:{internal_data:true,role_ai_level:'conferma',allowed_modules:[]},access:{modules:[],module_levels:{}}};
test('chat email tools do not require tasks or activity access and cannot activate delegation',()=>{
 const tools=chatEmailTools(auth);
 assert(tools.WORKSPACE_EMAIL_SEND);assert(tools.WORKSPACE_EMAIL_PREPARE);
 assert.equal(tools.WORKSPACE_EMAIL_PREPARE.inputSchema.properties.taskId,undefined);
 for(const name of Object.keys(tools))assert(!/ACTIVATE|APPROVE|DECIDE|CONFIRM/.test(name));
 assert(!chatEmailTools({...auth,capabilities:{...auth.capabilities,role_ai_level:'bozza'}}).WORKSPACE_EMAIL_SEND);
 assert(!chatEmailTools({...auth,capabilities:{...auth.capabilities,role_ai_level:'analisi'}}).WORKSPACE_EMAIL_PREPARE);
 assert.deepEqual(chatEmailTools({...auth,capabilities:{internal_data:false}}),{});
});
test('prepare and delegation proposals never dispatch',async()=>{
 let dispatch=0;const tools=chatEmailTools(auth,{service:{prepareChatEmail:async()=>({id,status:'proposed'}),proposeChatEmailDelegation:async()=>({id,status:'proposed'})},schedule:()=>dispatch++});
 const draft=await tools.WORKSPACE_EMAIL_PREPARE.execute({recipient:'user@example.invalid',subject:'S',body:'B',idempotencyKey:id});assert.equal(draft.sent,false);
 const proposal=await tools.WORKSPACE_EMAIL_DELEGATION_PROPOSE.execute({});assert.equal(proposal.enabled,false);assert.equal(proposal.requiresHuman,true);assert.equal(proposal.reviewKind,'email-delegation');assert.equal(dispatch,0);
});
test('denied delegated send does not fall back to a human approval or dispatch',async()=>{
 let dispatch=0;const tools=chatEmailTools(auth,{service:{sendChatEmail:async()=>{throw Object.assign(Error('EMAIL_DELEGATION_REQUIRED'),{status:403});}},schedule:()=>dispatch++});
 await assert.rejects(tools.WORKSPACE_EMAIL_SEND.execute({id,expectedHash:hash}),/DELEGATION_REQUIRED/);assert.equal(dispatch,0);
});
test('delegated send preserves exact id/hash and reports acceptance truthfully',async()=>{
 let observed;const tools=chatEmailTools(auth,{service:{sendChatEmail:async(_auth,input)=>{observed=input;return {id,status:'accepted'};}},schedule:()=>undefined});
 const value=await tools.WORKSPACE_EMAIL_SEND.execute({id,expectedHash:hash});assert.deepEqual(observed,{id,expectedHash:hash});assert.equal(value.accepted,true);assert.equal(value.deliveryVerified,false);
});
function setupDelegation(status='proposed') {
 const row={id,author_id:id,status,policy_version:'chat-email-v1',policy_hash:hash};let decisions=0;
 const dependencies={authorize:async()=>auth,catalog:()=>({}),receiptKey:'test-key',chatService:{getChatEmailDelegation:async()=>row,hashChatEmailDelegation:()=>hash,decideChatEmailDelegation:async(_auth,input)=>{decisions++;return {...row,status:input.confirm?'active':'revoked'};}}};
 return {row,dependencies,count:()=>decisions};
}
test('delegation preview does not activate; signed human decision calls only dedicated service',async()=>{
 const f=setupDelegation();const preview=await handleSecondBrain({method:'POST',body:{action:'confirmation',kind:'email-delegation',id}},f.dependencies);assert.equal(preview.mode,'confirm');assert.equal(f.count(),0);
 const result=await handleSecondBrain({method:'POST',body:{action:'decide',receipt:preview.receipt,decision:'confirm'}},f.dependencies);assert.equal(result.delegation.status,'active');assert.equal(f.count(),1);
});
test('active delegation offers revocation, and changed-state receipts cannot be reused',async()=>{
 const f=setupDelegation('active');const preview=await handleSecondBrain({method:'POST',body:{action:'confirmation',kind:'email-delegation',id}},f.dependencies);assert.equal(preview.mode,'revoke');
 const result=await handleSecondBrain({method:'POST',body:{action:'decide',receipt:preview.receipt,decision:'reject'}},f.dependencies);assert.equal(result.delegation.status,'revoked');
 const old=setupDelegation();const stale=await handleSecondBrain({method:'POST',body:{action:'confirmation',kind:'email-delegation',id}},old.dependencies);old.row.status='active';await assert.rejects(handleSecondBrain({method:'POST',body:{action:'decide',receipt:stale.receipt,decision:'reject'}},old.dependencies),/cambiata/);assert.equal(old.count(),0);
});
test('one-off chat email human review uses no activity permission or task',async()=>{
 const row={id,author_id:id,source_kind:'chat',task_id:null,via_ai:true,status:'proposed',payload_hash:hash};let decided=0;
 const d={authorize:async()=>auth,catalog:()=>({}),receiptKey:'key',emailService:{getActivityEmail:async()=>row,hashActivityEmail:()=>hash,decideActivityEmail:async()=>{throw Error('wrong path');}},chatService:{getChatEmail:async()=>row,decideChatEmailHuman:async()=>{decided++;return {...row,status:'rejected'};}}};
 const preview=await handleSecondBrain({method:'POST',body:{action:'confirmation',kind:'email',id}},d);const outcome=await handleSecondBrain({method:'POST',body:{action:'decide',receipt:preview.receipt,decision:'reject'}},d);assert.equal(outcome.email.status,'rejected');assert.equal(decided,1);
});
