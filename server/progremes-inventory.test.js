import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleInventorySnapshot,INVENTORY_PATH,validateInventorySnapshot} from './progremes-inventory.js';
import {signProductionMessage,HMAC_HEADERS} from './progremes-production-hmac.js';
const env={PROGREMES_PRODUCTION_CALLBACKS_ENABLED:'true',PROGREMES_INTEGRATION_SECRET:'test-secret'};
const snapshot=()=>({schemaVersion:1,capturedAt:new Date().toISOString(),rows:[1,8].map(warehouse_number=>({
 article_code:'MP2317',warehouse_number,on_hand:100,committed:10,available:90,unit_cost:1,unit_of_measure:'KG'}))});
function request(body=snapshot()){
 const timestamp=String(Math.floor(Date.now()/1000));const eventId=randomUUID();const raw=typeof body==='string'?body:JSON.stringify(body);
 return {method:'POST',body,headers:{[HMAC_HEADERS.timestamp]:timestamp,[HMAC_HEADERS.eventId]:eventId,
  [HMAC_HEADERS.signature]:signProductionMessage({method:'POST',path:INVENTORY_PATH,timestamp,eventId,body:raw,secret:env.PROGREMES_INTEGRATION_SECRET})}};
}
const response=()=>({status(code){this.code=code;return this;},json(value){this.value=value;return this;}});
test('legacy signed stock deliveries are acknowledged as retired without modifying Workspace stock',async()=>{
 const res=response();await handleInventorySnapshot(request(),res,{env,admin:{rpc(){assert.fail('legacy data must never be applied');}}});
 assert.equal(res.code,200);assert.equal(res.value.status.retired,true);assert.equal(res.value.status.source,'MEXAL_DIRECT');assert.equal(res.value.status.applied,undefined);
});
test('signature and production module gates remain unchanged',async()=>{
 const req=request();req.body.rows[0].on_hand=999;const bad=response();await handleInventorySnapshot(req,bad,{env});assert.equal(bad.code,401);
 const disabled=response();await handleInventorySnapshot(request(),disabled,{env:{...env,PROGREMES_PRODUCTION_CALLBACKS_ENABLED:'false'}});assert.equal(disabled.code,403);
});
test('signed text payloads preserve decimal formatting and whitespace at the HMAC boundary',async()=>{
 const raw=JSON.stringify(snapshot()).replace('100','100.000')+' ';const res=response();await handleInventorySnapshot(request(raw),res,{env});
 assert.equal(res.code,200);assert.equal(res.value.status.retired,true);
});
test('invalid stock pairs and quantities are rejected even though the old channel is retired',()=>{
 const partial=snapshot();partial.rows.pop();assert.equal(validateInventorySnapshot(partial),false);
 const duplicate=snapshot();duplicate.rows.push(duplicate.rows[0]);assert.equal(validateInventorySnapshot(duplicate),false);
 const invalid=snapshot();invalid.rows[0].on_hand=NaN;assert.equal(validateInventorySnapshot(invalid),false);
});
