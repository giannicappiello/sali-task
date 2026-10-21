import test from 'node:test';
import assert from 'node:assert/strict';
import { postOrderJson } from '../src/modules/orders/services/orderApiRequest.js';
import { loadOrderWithRecovery } from '../src/modules/orders/services/orderDetailRecovery.js';
function auth({refreshFails=false}={}) {
 const calls=[];
 const client={auth:{
  getSession:async()=>{calls.push('get');return {data:{session:{access_token:'old'}}};},
  refreshSession:async()=>{calls.push('refresh');return refreshFails ? {error:new Error('expired')} : {data:{session:{access_token:'new'}}};},
 }};
 return {calls,client};
}
const response=(status,payload)=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
test('401 renews session once and retries same order request with fresh bearer',async()=>{
 const a=auth();const requests=[];
 const result=await postOrderJson('/api/mexal/orders/recover-sync',{orderId:'test'}, {supabase:a.client,fetchImpl:async(url,init)=>{requests.push({url,...init});return requests.length===1?response(401,{error:'Sessione non valida.'}):response(200,{recovered:false});}});
 assert.deepEqual(a.calls,['get','refresh']);assert.equal(requests.length,2);assert.equal(requests[0].headers.Authorization,'Bearer old');assert.equal(requests[1].headers.Authorization,'Bearer new');assert.equal(requests[0].body,requests[1].body);assert.deepEqual(result,{recovered:false});
});
test('permission denial and server failure do not renew or retry mutations',async()=>{
 for(const status of [403,409,500,503]) {const a=auth();let calls=0;await assert.rejects(postOrderJson('/orders',{}, {supabase:a.client,fetchImpl:async()=>{calls++;return response(status,{error:'denied'});}}),e=>e.status===status);assert.equal(calls,1);assert.deepEqual(a.calls,['get']);}
});
test('invalid refreshed session fails after bounded retry, never loops',async()=>{
 const a=auth();let calls=0;await assert.rejects(postOrderJson('/orders',{}, {supabase:a.client,fetchImpl:async()=>{calls++;return response(401,{error:'Sessione non valida.'});}}),e=>e.status===401);assert.equal(calls,2);assert.deepEqual(a.calls,['get','refresh']);
});
test('failed refresh never sends another authenticated request',async()=>{
 const a=auth({refreshFails:true});let calls=0;await assert.rejects(postOrderJson('/orders',{}, {supabase:a.client,fetchImpl:async()=>{calls++;return response(401,{});}}),/Sessione scaduta/);assert.equal(calls,1);
});
test('opening normal PR orders never calls maintenance API regardless of sync configuration',async()=>{
 for(const stato_sincronizzazione of ['non_avviato','non_inviato','completato','errore','arrestato']) {const result={order:{id:'order',stato_sincronizzazione}};assert.equal(await loadOrderWithRecovery({loadDetail:async()=>result,recoverSync:async()=>assert.fail('unnecessary API'),moduleCode:'prof',canRecover:true}),result);}
});
test('maintenance failure cannot block an order read authorized by database RLS',async()=>{
 const result={order:{id:'order',stato_sincronizzazione:'in_corso'}};const error=new Error('Sessione non valida.');let reads=0;
 const loaded=await loadOrderWithRecovery({loadDetail:async()=>{reads++;return result;},recoverSync:async()=>{throw error;},moduleCode:'prof',canRecover:true});assert.equal(reads,1);assert.equal(loaded.order,result.order);assert.equal(loaded.syncRecoveryError,error);
});
test('successful stale-sync recovery reloads order; PH and read-only agents skip maintenance',async()=>{
 let reads=0;await loadOrderWithRecovery({loadDetail:async()=>{reads++;return {order:{stato_sincronizzazione:'in_corso'}};},recoverSync:async()=>({recovered:true}),moduleCode:'prof',canRecover:true});assert.equal(reads,2);
 for(const options of [{moduleCode:'ph',canRecover:true},{moduleCode:'prof',canRecover:false}])await loadOrderWithRecovery({...options,loadDetail:async()=>({order:{stato_sincronizzazione:'in_corso'}}),recoverSync:async()=>assert.fail('no maintenance allowed')});
});
test('real database permission failure is propagated, not replaced with stale data',async()=>{
 await assert.rejects(loadOrderWithRecovery({moduleCode:'prof',canRecover:true,loadDetail:async()=>{throw new Error('RLS denied');},recoverSync:async()=>assert.fail('no API')}),/RLS denied/);
});
