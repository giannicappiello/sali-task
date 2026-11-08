import test from 'node:test';
import assert from 'node:assert/strict';
import { activityEmailTools } from './activity-email-tools.js';
import { handleSecondBrain } from './handler.js';
const id='11111111-1111-4111-8111-111111111111', hash='a'.repeat(64);
const auth={profile:{id,nome:'Test',ruoli:{}},capabilities:{internal_data:true,role_ai_level:'conferma',allowed_modules:['attivita']},access:{modules:['attivita'],module_levels:{attivita:'scrittura'}}};
test('email tools only expose proposal and scoped reads, not direct send/decision',()=>{
 const tools=activityEmailTools(auth);assert(tools.ACTIVITY_EMAIL_PROPOSE);assert.equal(tools.ACTIVITY_EMAIL_PROPOSE.effect,'propose');assert.equal(tools.ACTIVITY_EMAIL_STATUS.effect,'read');assert.deepEqual(Object.keys(tools).sort(),['ACTIVITY_EMAIL_CONTEXT','ACTIVITY_EMAIL_HISTORY','ACTIVITY_EMAIL_PROPOSE','ACTIVITY_EMAIL_STATUS']);
 assert(!activityEmailTools({...auth,capabilities:{...auth.capabilities,role_ai_level:'analisi'}}).ACTIVITY_EMAIL_PROPOSE);
 assert.deepEqual(activityEmailTools({...auth,access:{modules:[],module_levels:{}},capabilities:{...auth.capabilities,allowed_modules:[]}}),{});
});
test('Brain review receipt queues only after human decision and returns no delivery claim',async()=>{
 let sent=0,decisions=0;const row={id,author_id:id,via_ai:true,status:'proposed',payload_hash:hash};
 const dependencies={transport:async()=>({ready:true,status:'ready'}),authorize:async()=>auth,catalog:()=>({}),receiptKey:'test-key',dispatchActivityEmail:async()=>{sent++;return {status:'ok'};},emailService:{getActivityEmail:async()=>row,hashActivityEmail:()=>hash,decideActivityEmail:async(_auth,input)=>{decisions++;assert.equal(input.expectedHash,hash);return {...row,status:'queued'};}}};
 const preview=await handleSecondBrain({method:'POST',body:{action:'confirmation',kind:'email',id}},dependencies);assert(preview.receipt);assert.equal(decisions,0);assert.equal(sent,0);
 const result=await handleSecondBrain({method:'POST',body:{action:'decide',receipt:preview.receipt,decision:'confirm'}},dependencies);assert.equal(result.email.status,'queued');assert.equal(result.sent,false);assert.equal(decisions,1);assert.equal(sent,1);
});
test('Brain review denies someone else email and manual provenance',async()=>{
 for(const row of [{id,author_id:'other',via_ai:true},{id,author_id:id,via_ai:false}])await assert.rejects(handleSecondBrain({method:'POST',body:{action:'confirmation',kind:'email',id}},{authorize:async()=>auth,catalog:()=>({}),receiptKey:'key',emailService:{getActivityEmail:async()=>row}}),/non accessibile/);
});
