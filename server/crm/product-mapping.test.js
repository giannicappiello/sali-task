import test from 'node:test';
import assert from 'node:assert/strict';
import { persistProductMapping } from './product-mapping.js';
function database({code='IT001',mappingConnection='c'}={}) {
  const writes=[];
  return {writes,from(table){
    const q={select(){return q;},eq(){return q;},upsert(payload,options){writes.push({payload,options});return q;},async single(){
      if(table==='prodotti')return {data:{id:'p',codice:code,codice_mexal:code}};
      if(writes.length)return {data:writes.at(-1).payload};
      return {data:{id:'m',connection_id:mappingConnection}};
    }};return q;
  }};
}
const connection={id:'c',provider_code:'amazon_sp_api'};
const body={mappingId:'m',externalSku:'sku',marketplace:'IT',asin:'ASIN',productId:'p',codiceMexal:'untrusted',status:'matched'};
test('mapping persists the canonical IT product and uses an idempotent marketplace/SKU conflict key',async()=>{
  const db=database(); const saved=await persistProductMapping(db,connection,body,'actor');
  assert.equal(saved.product_id,'p'); assert.equal(saved.codice_mexal,'IT001'); assert.equal(saved.verified_by,'actor');
  assert.equal(db.writes[0].options.onConflict,'connection_id,marketplace,external_sku');
});
test('Amazon cannot reconcile non-IT products or mappings from another connection',async()=>{
  for(const options of [{code:'PH001'},{mappingConnection:'other'}]) {
    const db=database(options); await assert.rejects(persistProductMapping(db,connection,body,'actor'),error=>error.status===400);
    assert.equal(db.writes.length,0);
  }
});
