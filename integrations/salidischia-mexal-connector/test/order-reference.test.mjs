import test from'node:test';import assert from'node:assert/strict';
import{syncVerifiedOrderReference,ORDER_REFERENCE_META_KEY}from'../src/order-reference.mjs';
const source={id:13730,status:'processing',currency:'EUR',total:'2.67',total_tax:'0.48',shipping_total:'0.00',meta_data:[]};
const plan={orderId:'13730',company:'GRE',year:'2026',hash:'hash'},record={status:'verified',plan_hash:'hash',document_ref:'OC+1+17359'};
test('pubblica solo riferimento verificato e riconferma importi e stato con GET',async()=>{
 let saved;const woo={publishMexalOrderReference:async(id,value)=>{assert.equal(id,13730);saved=value;},order:async()=>({...source,meta_data:[{key:ORDER_REFERENCE_META_KEY,value:saved}]})};
 assert.equal(await syncVerifiedOrderReference({source,plan,record,woo}),'updated');
 assert.equal(saved.reference,'OC+1+17359');assert.equal(saved.source_order_id,'13730');
 assert.equal(await syncVerifiedOrderReference({source:{...source,meta_data:[{key:ORDER_REFERENCE_META_KEY,value:saved}]},plan,record,woo}),'unchanged');
});
test('rifiuta OC incerto, ordine diverso e piano modificato senza scrivere',async()=>{
 for(const changed of [{status:'reconciliation_required'},{plan_hash:'other'},{document_ref:'OCX+1+3'}])await assert.rejects(syncVerifiedOrderReference({source,plan,record:{...record,...changed},woo:{}}),/non verificato/);
 await assert.rejects(syncVerifiedOrderReference({source:{...source,id:9},plan,record,woo:{}}),/non verificato/);
});
