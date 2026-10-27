import test from'node:test';import assert from'node:assert/strict';import{publishOrderStatus,syncErrorCode,SYNC_STATUS_META_KEY}from'../src/order-status.mjs';
test('stato blocco usa fase ed errore originari senza diffondere dati cliente',async()=>{
 const source={id:13738,status:'processing',total:'31.10',meta_data:[]},record={status:'reconciliation_required',last_phase:'customer_pending',last_error:'Richiesta API non riuscita (HTTP 400). Mexal 6001, campo cod_alternativo.'};let value;
 const woo={async publishMexalSyncStatus(id,v){assert.equal(id,source.id);value=v;},async order(){return{...source,meta_data:[{key:SYNC_STATUS_META_KEY,value}]};}};
 assert.equal(await publishOrderStatus({source,result:{mode:'attention-required'},record,error:new Error('incerto'),woo}),'updated');
 assert.equal(value.error_code,'mexal_6001_cod_alternativo');assert.equal(value.phase,'customer_pending');assert.equal(value.reference,null);
 assert.equal(syncErrorCode(new Error('dati cliente riservati')),'validation_failed');
});
test('stato invariato non riscrive il sito nello stesso intervallo orario',async()=>{
 const record={status:'verified',document_ref:'OC+1+17395'},source={id:13738,meta_data:[]};let value,calls=0;
 const woo={async publishMexalSyncStatus(id,v){calls++;value=v;},async order(){return{...source,meta_data:[{key:SYNC_STATUS_META_KEY,value}]};}};
 await publishOrderStatus({source,result:{mode:'already-imported'},record,woo,now:'2026-10-26T08:01:00Z'});
 source.meta_data=[{key:SYNC_STATUS_META_KEY,value}];
 assert.equal(await publishOrderStatus({source,result:{mode:'already-imported'},record,woo,now:'2026-10-26T08:04:00Z'}),'unchanged');assert.equal(calls,1);
 await publishOrderStatus({source,result:{mode:'already-imported'},record,woo,now:'2026-10-26T09:01:00Z'});assert.equal(calls,2);
});
