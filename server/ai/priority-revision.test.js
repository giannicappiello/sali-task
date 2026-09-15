import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { assertPriorityConfirmation, priorityCall, reconcilePriority, simulatePriority, priorityRequestSchema } from './priority-revision.js';

const id='00000000-0000-4000-8000-000000000001', hash='a'.repeat(64);
const revision=()=>({id,expectedHash:hash,status:'PROPOSED',createdAt:new Date().toISOString(),snapshot:{input:{orderNumber:'RDP1'}}});
function environment(t) {
  for (const [key,value] of Object.entries({PROGREMES_URL:'https://mes.example.test',PROGREMES_INTEGRATION_SECRET:'test-only'})) {
    const previous=process.env[key]; process.env[key]=value;
    t.after(()=>{if(previous===undefined) delete process.env[key]; else process.env[key]=previous;});
  }
}
test('confirmation uses server evidence, not a fabricated client simulation',()=>{
  const evidence=revision(); assert.equal(assertPriorityConfirmation({targetId:id,expectedHash:hash,evidence:{bad:true}},evidence).evidence,evidence);
  for(const patch of [{status:'MES_APPLIED'},{id:'other'},{expectedHash:'b'.repeat(64)},{createdAt:'invalid'},{createdAt:'2000-01-01'}])
    assert.throws(()=>assertPriorityConfirmation({targetId:id,expectedHash:hash},{...evidence,...patch}));
});
test('no MES call without operational permission or for an unsupported operation',async()=>{
  const auth={scoped:{rpc:async()=>({data:false})}};
  await assert.rejects(priorityCall(auth,'lookup',{},()=>{throw Error('must not call');}),/Permesso/);
  await assert.rejects(priorityCall(auth,'apply'),/non valida/);
});
test('signed request overwrites actor and handles old MES versions clearly',async(t)=>{
  environment(t);
  const auth={scoped:{rpc:async()=>({data:true})},profile:{id:'owner'}};
  const result=await priorityCall(auth,'lookup',{query:'RDP1',actor:'forged'},async(url,request)=>{
    assert.equal(url.pathname,'/api/workspace/ai/priority/lookup'); assert.equal(JSON.parse(request.body).actor,'workspace:owner');
    assert.equal(request.method,'POST'); return new Response(JSON.stringify({orders:[]}));
  });
  assert.deepEqual(result,{orders:[]});
  await assert.rejects(priorityCall(auth,'lookup',{},async()=>new Response('{}',{status:404})),/Aggiornare MES/);
});
test('reconciliation only reads MES, reports mirror failure, and never reapplies transfer',async(t)=>{
  environment(t);
  let calls=0; t.mock.method(globalThis,'fetch',async(url)=>{assert.equal(url.pathname,'/api/workspace/ai/priority/get'); calls++; return new Response(JSON.stringify({...revision(),status:'MES_APPLIED',applied:true}));});
  const auth={profile:{id:'owner'},scoped:{rpc:async()=>({data:true})},admin:{rpc:async(name)=>{assert.equal(name,'reconcile_workspace_priority_revision');return {error:{message:'unavailable'}};}}};
  assert.equal((await reconcilePriority(auth,id)).status,'RECONCILIATION_REQUIRED');
  auth.admin.rpc=async()=>({error:null}); assert.equal((await reconcilePriority(auth,id)).status,'COMPLETED'); assert.equal(calls,2);
});
test('AI simulation accepts packaging release beyond missing and never applies without confirmation',async(t)=>{
  environment(t);
  const operations=[];
  const input={orderNumber:'RDP139',startAt:'2026-09-16T09:00',reason:'Priorità confermata in simulazione',materials:[{articleCode:'330X230X195',transfers:[{sourceOrderId:2,quantity:361}]}]};
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    operations.push(url.pathname.split('/').at(-1));
    if(url.pathname.endsWith('/materials')) return new Response(JSON.stringify({reservationReleaseVersion:2,materials:[{articleCode:'330X230X195',missing:0,minimumRelease:361}]}));
    assert.deepEqual(JSON.parse(request.body).input,input);
    return new Response(JSON.stringify(revision()));
  });
  const auth={profile:{id:'owner'},scoped:{rpc:async()=>({data:true})},admin:{rpc:async()=>({error:null})}};
  assert.equal((await simulatePriority(auth,input)).confirmable,true);
  assert.deepEqual(operations,['materials','simulate']);
  assert.equal(priorityRequestSchema.properties.materials.maxItems,200);
});
test('old MES cannot silently interpret disimpegno as a simple transfer',async(t)=>{
  environment(t); let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({materials:[]}));});
  const auth={profile:{id:'owner'},scoped:{rpc:async()=>({data:true})}};
  await assert.rejects(simulatePriority(auth,{orderNumber:'RDP139'}),/Aggiornare MES/);
  assert.equal(calls,1);
});
