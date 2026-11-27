import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshWorkspaceV4Demand, validateWorkspaceV4ProductionResult } from './workspacemes-v4-api.js';

const old={lineId:'pb9',orderId:'164',commercialArticleCode:'PB0009',productionQuantity:25000};
const added={id:'pb49',ordine_id:'164',codice_articolo:'PB0049',quantita:10000,mexal_attiva:true};
function adminFor(links=[],events=[]) {
  const tables={ordini_righe:[added,{...added,id:'description',riga_descrittiva:true},{...added,id:'inactive',mexal_attiva:false}],
    workspace_production_request_items:links,workspace_production_request_audit:events};
  return {rpc:async()=>({data:[]}),from(name){let filters=[];return {select(){return this;},order(){return this;},range(){return this;},
    eq(k,v){filters.push(r=>r[k]===v);return this;},neq(k,v){filters.push(r=>r[k]!==v);return this;},
    in(k,ids){filters.push(r=>ids.includes(r[k]));return this;},
    then(resolve){return Promise.resolve({data:tables[name].filter(r=>filters.every(f=>f(r)))}).then(resolve);}};}};
}
test('RdP85 includes only added active PB0049 and retains PB0009 identity and quantity',async()=>{
  const original={items:[old],orders:[{orderId:'164'}]}; const frozen=structuredClone(original);
  const result=await refreshWorkspaceV4Demand(adminFor(),original,async({lineIds})=>{
    assert.deepEqual(lineIds,['pb9','pb49']);
    return {items:[old,{...old,lineId:'pb49',commercialArticleCode:'PB0049',productionQuantity:10000}],orders:original.orders};
  },'85');
  assert.equal(result.items[0].productionQuantity,25000);assert.equal(result.items[1].productionQuantity,10000);
  assert.deepEqual(original,frozen);
});
test('an added line assigned to another active RdP cannot be duplicated',async()=>{
  await assert.rejects(refreshWorkspaceV4Demand(adminFor([{ordine_riga_id:'pb49',production_request_id:'other',request:{workspace_status:'CONFIRMED'}}]),
    {items:[old],orders:[{orderId:'164'}]},()=>assert.fail('No MES request'),'85'),{code:'V5_ADDED_LINE_ALREADY_LINKED'});
});
test('cancelled forecasts are not silently reintroduced',async()=>{
  await refreshWorkspaceV4Demand(adminFor([],[{production_request_id:'85',action:'FORECAST_LINE_CANCELLED',details:{workspaceLineId:'pb49'}}]),
    {items:[old],orders:[{orderId:'164'}]},async({lineIds})=>{assert.deepEqual(lineIds,['pb9']);return {items:[old],orders:[{orderId:'164'}]};},'85');
});
test('a mixed MES receipt must cover each preserved OP and added forecast exactly once',()=>{
  const preview={snapshot:{demands:[{workspaceLineId:'pb9'},{workspaceLineId:'pb49'}]}};
  const response={status:'EXTENDED',productionCreated:true,productionOrders:[{id:6495,number:'RDP85'}],
    preservedProductionLines:['pb9'],forecastLines:['pb49']};
  assert.equal(validateWorkspaceV4ProductionResult(preview,response)[0].id,6495);
  for(const patch of [{forecastLines:[]},{forecastLines:['pb9']},{preservedProductionLines:[]},{productionOrders:[{id:0,number:'bad'}]}])
    assert.throws(()=>validateWorkspaceV4ProductionResult(preview,{...response,...patch}),{code:'V5_EXTENSION_INCOMPLETE'});
});

test('a confirmed RdP without OPs can append forecasts without claiming production was created',()=>{
  const preview={snapshot:{demands:[{workspaceLineId:'old'},{workspaceLineId:'added'}]}};
  const response={status:'EXTENDED',productionCreated:false,productionOrders:[],
    preservedProductionLines:[],forecastLines:['old','added']};
  assert.deepEqual(validateWorkspaceV4ProductionResult(preview,response),[]);
  for(const patch of [{productionCreated:true},{forecastLines:['old']},{forecastLines:['old','old']},
    {productionOrders:[{id:6495,number:'RDP85'}]}])
    assert.throws(()=>validateWorkspaceV4ProductionResult(preview,{...response,...patch}),{code:'V5_EXTENSION_INCOMPLETE'});
});
