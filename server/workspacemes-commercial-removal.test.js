import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshWorkspaceV4Demand,validateWorkspaceV4ProductionResult} from './workspacemes-v4-api.js';
const item=(lineId,orderId,code)=>({lineId,orderId,commercialArticleCode:code,productionQuantity:15000,requestedQuantity:15000,requestedUnitOfMeasure:'KG',productionUnitOfMeasure:'KG'});
const original={items:[item('n152','152','FP123N'),item('o153','153','FP123O'),item('m354','354','FP123M'),item('o356','356','FP123O')],
  orders:['152','153','354','356'].map(orderId=>({orderId,versionHash:orderId}))};
const rows=[{id:'m354',ordine_id:'354',codice_articolo:'FP123M',quantita:15000,mexal_attiva:true},
  {id:'o356',ordine_id:'356',codice_articolo:'FP123O',quantita:15000,mexal_attiva:false},
  {id:'n356',ordine_id:'356',codice_articolo:'FP123N',quantita:15000,mexal_attiva:true}];
function admin(source=rows){
  const tables={ordini_righe:source,workspace_production_request_items:[],workspace_production_request_audit:[]};
  return {rpc:async()=>({data:[{order_id:'152',generation:'a'},{order_id:'153',generation:'b'}]}),from(name){const filters=[];return {
    select(){return this;},order(){return this;},range(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},neq(k,v){filters.push(r=>r[k]!==v);return this;},
    in(k,ids){filters.push(r=>ids.includes(r[k]));return this;},then(resolve){return Promise.resolve({data:tables[name].filter(r=>filters.every(f=>f(r)))}).then(resolve);}};}};
}
const reader=async({lineIds})=>{
  assert.deepEqual(lineIds,['m354','n356']);
  return {items:[item('m354','354','FP123M'),item('n356','356','FP123N')],orders:original.orders.filter(o=>['354','356'].includes(o.orderId))};
};
test('RdP124 archives two deleted sources and replaces only the inactive OC356 line',async()=>{
  const before=structuredClone(original);const result=await refreshWorkspaceV4Demand(admin(),original,reader,'124');
  assert.deepEqual(result.excludedCommercialItems.map(x=>x.lineId),['n152','o153']);
  assert.deepEqual(result.retiredCommercialItems.map(x=>x.lineId),['o356']);
  assert.deepEqual(result.items.map(x=>x.lineId),['m354','n356']);assert.deepEqual(original,before);
  assert.deepEqual(await refreshWorkspaceV4Demand(admin(),result,reader,'124'),result);
});
test('missing replacement cannot silently remove a line',async()=>{
  await assert.rejects(refreshWorkspaceV4Demand(admin(rows.filter(r=>r.id!=='n356')),original,()=>assert.fail('No preview'),'124'),{code:'V5_REVISION_SCOPE_CHANGED'});
});
test('a removal receipt must identify exactly the requested retired line',()=>{
  const preview={snapshot:{demands:[{workspaceLineId:'m354'},{workspaceLineId:'n356'}],commercialDemand:{retiredCommercialItems:[{lineId:'o356'}]}}};
  const result={status:'EXTENDED',productionCreated:true,productionOrders:[{id:5388,number:'RDP124-04'}],preservedProductionLines:['m354'],forecastLines:['n356'],retiredCommercialLines:['o356']};
  assert.equal(validateWorkspaceV4ProductionResult(preview,result)[0].id,5388);
  for(const ids of [[],['m354'],['n152'],['o356','o356']])assert.throws(()=>validateWorkspaceV4ProductionResult(preview,{...result,retiredCommercialLines:ids}),{code:'V5_EXTENSION_INCOMPLETE'});
});
