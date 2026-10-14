import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshWorkspaceV4Demand } from './workspacemes-v4-api.js';

const original={items:[{lineId:'line',orderId:'oct',commercialArticleCode:'IT0099',requestedQuantity:5000,
  requestedUnitOfMeasure:'PZ',productionQuantity:5000,productionUnitOfMeasure:'PZ'}],orders:[{orderId:'oct',versionHash:'old'}]};
test('Aggiorna RdP acquisisce quantità, consegna e hash correnti, conservando lo storico',async()=>{
  const current={items:[{...original.items[0],requestedQuantity:6000,productionQuantity:6000,requestedDeliveryDate:'2026-11-01'}],
    orders:[{orderId:'oct',versionHash:'new'}]};
  const result=await refreshWorkspaceV4Demand({},original,async args=>{
    assert.deepEqual(args.lineIds,['line']); return current;
  });
  assert.equal(result.items[0].productionQuantity,6000);
  assert.equal(result.items[0].requestedDeliveryDate,'2026-11-01');
  assert.equal(result.orders[0].versionHash,'new');
  assert.equal(original.items[0].productionQuantity,5000);
});
test('una riga sostituita o spostata ad altro OCT richiede una scelta, senza ricreare OP',async()=>{
  for (const change of [{lineId:'another'},{commercialArticleCode:'OTHER'},{orderId:'another'}])
    await assert.rejects(refreshWorkspaceV4Demand({},original,async()=>({items:[{...original.items[0],...change}],orders:original.orders})),
      {code:'V5_REVISION_SCOPE_CHANGED'});
});
