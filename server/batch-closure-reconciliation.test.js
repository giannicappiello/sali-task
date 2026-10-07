import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBatchClosure } from './batch-closure-reconciliation.js';
import { handleBatchSheet } from './batch-sheet.js';
const phaseId='11111111-1111-1111-1111-111111111111';
const input={productionOrderId:42,kind:'packaging',phaseId,requestedBy:'operator'};
const wait=async()=>{};

test('timeout readback observes completion and reads archive without another write',async()=>{
 const calls=[]; let reads=0;
 const client={batchSheet:async request=>{
  calls.push(request);
  if(request.operation==='archive-status') return {result:{message:'Lavorazione chiusa. PDF salvato sul NAS.'}};
  assert.equal(request.operation,'list');
  return {result:{phases:[{id:phaseId,executionStatus:++reads===1?'CLOSING':'COMPLETED'}]}};
 }};
 const result=await reconcileBatchClosure(client,input,{wait});
 assert.equal(result.closed,true); assert.equal(result.verifiedAfterTimeout,true);
 assert.match(result.message,/PDF salvato/); assert.equal(calls.length,3);
 assert.ok(calls.every(row=>row.requestedBy==='operator' && row.productionOrderId===42 && !row.actual));
});
test('completed closure remains successful when the archive read is unavailable',async()=>{
 const result=await reconcileBatchClosure({batchSheet:async request=>{
  if(request.operation==='archive-status') throw new Error('NAS offline');
  return {result:{phases:[{id:phaseId,executionStatus:'COMPLETED'}]}};
 }},input,{wait});
 assert.equal(result.closed,true); assert.match(result.message,/NAS da verificare/);
});
test('pending closure is not reported as a failure or a completed operation',async()=>{
 let reads=0;
 const result=await reconcileBatchClosure({batchSheet:async request=>{
  reads++; assert.equal(request.operation,'list');
  return {result:{phases:[{id:phaseId,executionStatus:'CLOSING'}]}};
 }},input,{wait});
 assert.equal(reads,3); assert.equal(result.closed,false); assert.equal(result.pending,true);
});
test('a different completed phase cannot verify the selected closure',async()=>{
 await assert.rejects(reconcileBatchClosure({batchSheet:async()=>({result:{phases:[{id:'22222222-2222-2222-2222-222222222222',executionStatus:'COMPLETED'}]}})},input,{wait}),{code:'CLOSURE_OUTCOME_UNVERIFIED'});
});
test('timeout on submit is reconciled by the gateway; business errors are not retried',async()=>{
 for(const status of [504,409]){
  const calls=[];
  const promise=handleBatchSheet({}, {...input,operation:'complete-sheet',contentHash:'a'.repeat(64),actual:{produced:100}}, {
   authorize:async()=>({profile:{id:'operator'},scope:{mode:'team'}}),wait,
   clientFactory:()=>({batchSheet:async request=>{
    calls.push(request.operation);
    if(request.operation==='complete-sheet') throw Object.assign(new Error('Original failure'),{status});
    if(request.operation==='list') return {result:{phases:[{id:phaseId,executionStatus:'COMPLETED'}]}};
    return {result:{message:'Lavorazione chiusa correttamente.'}};
   }})
  });
  if(status===504){assert.equal((await promise).closed,true);assert.deepEqual(calls,['complete-sheet','list','archive-status']);}
  else {await assert.rejects(promise,{status:409}); assert.deepEqual(calls,['complete-sheet']);}
 }
});