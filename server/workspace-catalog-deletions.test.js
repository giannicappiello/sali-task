import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverCatalogDeletions } from './workspace-catalog-deletions.js';
const admin = rows => ({from: () => ({select: async () => ({data:rows})})});
const catalog = {modules:[{code:'Planning'},{code:'PlanningProduction'},{code:'Prodotti'}],screens:[
  {code:'Planning',moduleCode:'Planning'}, {code:'PlanningProduction',moduleCode:'PlanningProduction'},
  {code:'ProdottiFiniti',moduleCode:'Prodotti'}, {code:'MateriePrime',moduleCode:'Prodotti'},
]};
process.env.PROGREMES_URL='https://mes.example';
process.env.PROGREMES_INTEGRATION_SECRET='test';

test('sends exact codes and filters deleted module children without hiding new screens',async()=>{
  let body;
  const result=await deliverCatalogDeletions(admin([{kind:'module',external_code:'planning'},{kind:'screen',external_code:'ProdottiFiniti'},{kind:'module',code:'custom'}]),async(url,options)=>{body=JSON.parse(options.body);return {ok:true};},catalog);
  assert.deepEqual(body,{codes:['Planning'],screens:['ProdottiFiniti']});
  assert.deepEqual(result.catalog.modules.map(x=>x.code),['PlanningProduction','Prodotti']);
  assert.deepEqual(result.catalog.screens.map(x=>x.code),['PlanningProduction','MateriePrime']);
});
test('retired deletions do not block importing the new planning screen',async()=>{
  const rows=[{kind:'module',external_code:'RetiredModule'},{kind:'screen',external_code:'RetiredScreen'}];
  const result=await deliverCatalogDeletions(admin(rows),async()=>assert.fail('no deletion request for absent codes'),catalog);
  assert.equal(result.alreadyAbsent,2);
  assert.ok(result.catalog.screens.some(x=>x.code==='PlanningProduction'));
  assert.equal(rows.length,2,'retain tombstones in case an older catalog returns');
});
test('mixed current and obsolete tombstones only send known entries',async()=>{
  let body;
  await deliverCatalogDeletions(admin([{kind:'module',external_code:'RetiredModule'},{kind:'screen',external_code:'ProdottiFiniti'}]),async(url,options)=>{body=JSON.parse(options.body);return {ok:true};},catalog);
  assert.deepEqual(body,{codes:[],screens:['ProdottiFiniti']});
});
test('failed delivery retains tombstones and identifies affected codes',async()=>{
  const rows=[{kind:'module',external_code:'Planning'}];
  await assert.rejects(deliverCatalogDeletions(admin(rows),async()=>({ok:false,status:503}),catalog),/503.*Planning/);
  let calls=0;
  await deliverCatalogDeletions(admin(rows),async()=>{calls++;return {ok:true};},catalog);
  assert.equal(calls,1);assert.equal(rows.length,1);
});
test('empty deletion catalog makes no MES request',async()=>{await deliverCatalogDeletions(admin([]),async()=>assert.fail());});
test('bounds each delivery batch',async()=>{
  const rows=Array.from({length:205},(_,i)=>({kind:'screen',external_code:'screen'+i}));let calls=0;
  await deliverCatalogDeletions(admin(rows),async(u,o)=>{assert.ok(JSON.parse(o.body).screens.length<=100);calls++;return {ok:true};},{modules:[],screens:rows.map(r=>({code:r.external_code}))});
  assert.equal(calls,3);
});
test('standalone deletion reads catalog and treats already removed codes idempotently',async()=>{
  const calls=[];
  const result=await deliverCatalogDeletions(admin([{kind:'screen',external_code:'AlreadyRemoved'}]),async(url,options)=>{
    calls.push([url.pathname,options.method || 'GET']);return {ok:true,json:async()=>catalog};
  });
  assert.deepEqual(calls,[['/api/workspace/modules','GET']]);assert.equal(result.alreadyAbsent,1);
});
test('catalog authentication and format failures never authorize deletion',async()=>{
  const db=admin([{kind:'module',external_code:'Planning'}]);
  await assert.rejects(deliverCatalogDeletions(db,async()=>({ok:false,status:401})),/401/);
  await assert.rejects(deliverCatalogDeletions(db,async()=>assert.fail(),{}),/non valido/);
});
