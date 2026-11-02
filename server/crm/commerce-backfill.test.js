import test from 'node:test';import assert from 'node:assert/strict';import{amazonBackfillState,prepareAmazonBackfill}from'./commerce-backfill.js';
const connection={provider_code:'amazon_sp_api',abilitata:true,import_state:{completed:true,to:'2026-11-01T22:00:00Z'}},now=new Date('2026-11-02T14:00:00Z');
test('backfill explicitly reopens only the chosen fixed order window, preserving imported data',()=>{
 const original=structuredClone(connection),s=amazonBackfillState(connection,'2026-10-30',now);
 assert.equal(s.from,'2026-10-30T00:00:00.000Z');assert.equal(s.to,'2026-11-02T13:57:00.000Z');assert.equal(s.phase,'orders');assert.equal(s.priorityImported,true);assert.equal(s.token,null);assert.deepEqual(connection,original);
 for(const date of ['2026-02-30','2024-10-30','2027-01-01','invalid'])assert.throws(()=>amazonBackfillState(connection,date,now));
 for(const patch of [{abilitata:false},{provider_code:'woocommerce'},{import_state:{completed:false}},{amazon_cox_state:{active:true}},{amazon_refund_state:{active:true}}])assert.throws(()=>amazonBackfillState({...connection,...patch},'2026-10-30',now));
});
test('failed lock cannot reset cursor or call provider',async()=>{
 let reads=0;const db={rpc:async()=>({error:new Error('busy')}),from:()=>{reads++;}};
 await assert.rejects(prepareAmazonBackfill(db,'id','actor','2026-10-30',now),/busy/);assert.equal(reads,0);
});
test('persist cursor under the import lock and release it on success or invalid active state',async()=>{
 for(const active of [false,true]){
  const calls=[];let saved;
  const db={rpc:async(name,args)=>{calls.push({name,args});return{data:name==='crm_claim_commerce_import_service'?'run-id':null};},from:()=>{
   let write=false;const query={select:()=>query,eq:()=>query,update:value=>{saved=value;write=true;return query;},single:async()=>({data:write?{id:'id'}:{...connection,amazon_cox_state:{active}}})};return query;
  }};
  const action=prepareAmazonBackfill(db,'id','actor','2026-10-30',now);
  if(active){await assert.rejects(action,/sincronizzazione in corso/);assert.equal(saved,undefined);}
  else{assert.equal((await action).from,'2026-10-30T00:00:00.000Z');assert.deepEqual(Object.keys(saved),['import_state']);assert.equal(saved.import_state.completed,false);}
  assert.equal(calls[0].name,'crm_claim_commerce_import_service');assert.equal(calls.at(-1).name,'crm_complete_sync_run_service');assert.equal(calls.at(-1).args.target_status,active?'failed':'completed');
 }
});
