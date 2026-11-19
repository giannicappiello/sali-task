import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshWorkspaceV4Demand, createWorkspaceV4Preview } from './workspacemes-v4-api.js';

const original={items:[{lineId:'line',orderId:'oct',commercialArticleCode:'IT0099',requestedQuantity:5000,
  requestedUnitOfMeasure:'PZ',productionQuantity:5000,productionUnitOfMeasure:'PZ'}],orders:[{orderId:'oct',versionHash:'old'}]};
test('Aggiorna RdP acquisisce quantità, consegna e hash correnti, conservando lo storico',async()=>{
  const current={items:[{...original.items[0],requestedQuantity:6000,productionQuantity:6000,requestedDeliveryDate:'2026-11-01'}],
    orders:[{orderId:'oct',versionHash:'new'}]};
  const result=await refreshWorkspaceV4Demand({rpc:async()=>({data:[]})},original,async args=>{
    assert.deepEqual(args.lineIds,['line']); return current;
  });
  assert.equal(result.items[0].productionQuantity,6000);
  assert.equal(result.items[0].requestedDeliveryDate,'2026-11-01');
  assert.equal(result.orders[0].versionHash,'new');
  assert.equal(original.items[0].productionQuantity,5000);
});
test('una riga sostituita o spostata ad altro OCT richiede una scelta, senza ricreare OP',async()=>{
  for (const change of [{lineId:'another'},{commercialArticleCode:'OTHER'},{orderId:'another'}])
    await assert.rejects(refreshWorkspaceV4Demand({rpc:async()=>({data:[]})},original,async()=>({items:[{...original.items[0],...change}],orders:original.orders})),
      {code:'V5_REVISION_SCOPE_CHANGED'});
});

test('RdP multi OC esclude solo la sorgente riconciliata e conserva snapshot e ordini validi', async()=>{
  const other={...original.items[0],lineId:'valid-497',orderId:'497'};
  const old={...original,items:[original.items[0],other],orders:[original.orders[0],{orderId:'497',versionHash:'497'}]};
  const frozen=structuredClone(old);
  const admin={rpc:async(name,args)=>{
    assert.equal(name,'workspace_reconciled_oct_sources');
    assert.deepEqual([...args.p_order_ids].sort(),['497','oct']);
    return {data:[{order_id:'oct',generation:'g',deleted_at:'2026-10-07'}]};
  }};
  let calls=0;
  const reader=async args=>{calls++;assert.deepEqual(args.lineIds,['valid-497']);return {items:[other],orders:[old.orders[1]]};};
  const first=await refreshWorkspaceV4Demand(admin,old,reader);
  const second=await refreshWorkspaceV4Demand(admin,first,reader);
  assert.deepEqual(first,second);
  assert.deepEqual(first.items,[other]);
  assert.deepEqual(first.excludedCommercialItems,[old.items[0]]);
  assert.deepEqual(old,frozen);
  assert.equal(calls,2);
});

test('ripristino OCT o nuova generazione obbliga a rivalutare anche la sorgente esclusa', async()=>{
  const old={...original,excludedCommercialItems:[{...original.items[0],lineId:'retired',orderId:'retired'}],
    excludedCommercialOrders:[{orderId:'retired',versionHash:'old'}]};
  await refreshWorkspaceV4Demand({rpc:async()=>({data:[]})},old,async args=>{
    assert.deepEqual(args.lineIds,['line','retired']);
    return {items:[...old.items,...old.excludedCommercialItems],orders:[...old.orders,...old.excludedCommercialOrders]};
  });
});

test('fallisce senza ricevuta accessibile, senza residuo valido o con ricevuta estranea',async()=>{
  const reader=async()=>assert.fail('Non inviare anteprima MES');
  await assert.rejects(refreshWorkspaceV4Demand({rpc:async()=>({error:new Error('offline')})},original,reader),/offline/);
  await assert.rejects(refreshWorkspaceV4Demand({rpc:async()=>({data:[{order_id:'oct'}]})},original,reader),{code:'V5_NO_VALID_COMMERCIAL_SOURCE'});
  await assert.rejects(refreshWorkspaceV4Demand({rpc:async()=>({data:[{order_id:'foreign'}]})},original,reader),{code:'V5_REVISION_SCOPE_CHANGED'});
});

test('ricalcolo completo invia solo OC497 e persiste evidenza senza cambiare storico o produzione',async()=>{
  const item={...original.items[0],lineId:'valid',orderId:'497'};
  const demand={items:[original.items[0],item],orders:[original.orders[0],{orderId:'497',versionHash:'hash497',sigla:'OC',serie:2,numero:497}]};
  const tables={workspace_production_requests:[{id:'request',external_id:'external',contract_version:4,demand_snapshot_id:'snapshot',workspace_status:'BLOCKED'}],
    workspace_production_demand_snapshots:[{snapshot:demand,captured_at:'2026-11-18'}],ordini_righe:[],workspace_rdp_cancellations:[],workspace_v4_previews:[],workspace_production_request_audit:[]};
  const frozen=structuredClone(tables);let persisted,command;
  const admin={from(name){assert.ok(tables[name],`Unexpected table ${name}`);return {select(){return this;},eq(){return this;},neq(){return this;},in(){return this;},order(){return this;},limit(){return this;},then(resolve){return Promise.resolve({data:structuredClone(tables[name])}).then(resolve);}};},
    async rpc(name,args){
      if(name==='workspace_rdp_has_deleted_oct') return {data:false};
      if(name==='workspace_reconciled_oct_sources') return {data:[{order_id:'oct',generation:'g',deleted_at:'2026-10-07'}]};
      assert.equal(name,'persist_workspace_v4_preview');persisted=args;return {data:[{id:'preview'}]};
    }};
  const result=await createWorkspaceV4Preview({admin,requestId:'request',requestedBy:'user',
    demandReader:async args=>{assert.deepEqual(args.lineIds,['valid']);return {items:[item],orders:[demand.orders[1]]};},
    client:{v4PreviewEnabled:()=>true,previewV4:async input=>{command=input;return {result:{status:'READY',demands:[{workspaceLineId:'valid',materials:[]}],snapshotHash:'hash',rowVersion:1}};}}});
  assert.deepEqual(command.demands.map(x=>x.workspaceLineId),['valid']);
  assert.equal(command.demands[0].octReference,'OC/2/497');
  assert.equal(result.mutatesProduction,false);
  assert.deepEqual(persisted.p_snapshot.commercialDemand.excludedCommercialItems,[original.items[0]]);
  assert.deepEqual(tables,frozen);
});
