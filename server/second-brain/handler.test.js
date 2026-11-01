import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceipt, verifyReceipt, handleSecondBrain } from './handler.js';
import { createBrainCatalog } from './catalog.js';
import { validateInput, objectSchema } from './schema.js';

const auth = { profile:{ id:'11111111-1111-4111-8111-111111111111', nome:'Uno', ruoli:{} }, capabilities:{ internal_data:true,role_ai_level:'analisi' }, access:{ modules:[],module_levels:{} } };
test('confirmation is bound to identity, signature and expiry', () => {
  const payload = { userId:auth.profile.id,kind:'brain',id:auth.profile.id,hash:'a',expires:2000 };
  const token = createReceipt(payload,'test-key');
  assert.equal(verifyReceipt(token,'test-key',auth.profile.id,1000).hash,'a');
  assert.throws(() => verifyReceipt(token,'test-key','another-user',1000), /altro utente/);
  assert.throws(() => verifyReceipt(token,'wrong-key',auth.profile.id,1000), /non valida/);
  assert.throws(() => verifyReceipt(token,'test-key',auth.profile.id,3000), /scaduta/);
  assert.throws(() => verifyReceipt(token+'.extra','test-key',auth.profile.id,1000), /non valida/);
});
test('analysis user cannot see operational mutation tools or generative delegates', () => {
  const tools = createBrainCatalog(auth);
  assert(!tools.MES_PLAN_APPLY);
  assert(!tools.ACTIVITY_CREATE);
  for (const name of ['chat','CODE_CHANGE_REQUEST','PRODUCTION_COST_PROPOSE','DATABASE_APPLY_MIGRATIONS','ORDER_AI_GENERATE']) assert(!tools[name]);
});
test('catalog does not execute any tool and advertises no external generation', async () => {
  let calls=0;
  const output=await handleSecondBrain({method:'POST',body:{action:'catalog'}},{authorize:async()=>auth,catalog:()=>({READ:{description:'read',effect:'read',inputSchema:objectSchema(),execute:()=>calls++}})});
  assert.equal(calls,0); assert.equal(output.externalModelCalls,false);
  assert.equal(output.orderAiGeneration,'unchanged-external-api');
  assert.equal(output.tools[0].annotations.readOnlyHint,true);
});
test('unknown and malformed tools are rejected before audit or execution', async () => {
  let called=false;
  const dependencies={authorize:async()=>auth,catalog:()=>({READ:{inputSchema:objectSchema({id:{type:'integer'}},['id']),execute:()=>{called=true;}}})};
  await assert.rejects(handleSecondBrain({method:'POST',body:{action:'call',name:'UNKNOWN'}},dependencies),/non disponibile/);
  await assert.rejects(handleSecondBrain({method:'POST',body:{action:'call',name:'READ',arguments:{id:'bad'}}},dependencies),/Parametri/);
  assert.equal(called,false);
});
test('operational calls fail closed when durable audit cannot be started', async () => {
  let called=false;
  const audited={...auth,admin:{from:()=>({insert:async()=>({error:{message:'offline'}})})}};
  await assert.rejects(handleSecondBrain({method:'POST',body:{action:'call',name:'READ',arguments:{}}},{authorize:async()=>audited,catalog:()=>({READ:{inputSchema:objectSchema(),execute:()=>{called=true;}}})}),/Nessuna operazione/);
  assert.equal(called,false);
});
test('schema rejects additional properties and unbounded identifiers',()=>{
  assert.throws(()=>validateInput(objectSchema({id:{type:'string',format:'uuid'}},['id']),{id:auth.profile.id,sql:'drop table'}));
});
