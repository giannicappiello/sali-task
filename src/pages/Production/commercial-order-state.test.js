import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialCounts, deliveryState, selectCommercialRows, hasBlock } from './commercial-order-state.js';

const now = new Date('2026-09-23T10:00:00');
test('commercial totals exclude closed history and resolved diagnostics', () => {
  const rows = [
    {stage:'evaluation', deliveryDate:'2026-09-22'},
    {stage:'production', diagnostics:[{status:'RESOLVED',severity:'blocking'}]},
    {stage:'planned', diagnostics:[{status:'OPEN',severity:'CRITICAL'}]},
    {stage:'completed', deliveryDate:'2026-01-01'},
    {stage:'history', deliveryDate:'2026-01-01'},
  ];
  assert.deepEqual(commercialCounts(rows,now),{active:3,evaluation:1,production:1,attention:1,late:1});
  assert.equal(hasBlock(rows[1]),false);
});
test('delivery warning compares end of delivery day and does not flag closed orders', () => {
  assert.equal(deliveryState({stage:'planned',deliveryDate:'2026-09-23',plannedCompletionDate:'2026-09-23T16:00:00'},now),null);
  assert.equal(deliveryState({stage:'planned',deliveryDate:'2026-09-23',plannedCompletionDate:'2026-09-24T08:00:00'},now),'Prevista oltre consegna');
  assert.equal(deliveryState({stage:'completed',deliveryDate:'2026-09-22'},now),null);
});
test('search finds article and OP, history is explicit, sort preserves source order', () => {
  const rows=[{id:'b',label:'OCT2',stage:'planned',deliveryDate:'2026-09-25',productionOrders:[{id:5445}],lines:[{articleCode:'FP123L'}]},
    {id:'a',label:'OCT1',stage:'evaluation',deliveryDate:'2026-09-24'}, {id:'h',stage:'history',label:'Old'}];
  assert.deepEqual(selectCommercialRows(rows).map(x=>x.id),['a','b']);
  assert.deepEqual(rows.map(x=>x.id),['b','a','h']);
  assert.equal(selectCommercialRows(rows,{search:'fp123l'})[0].id,'b');
  assert.equal(selectCommercialRows(rows,{search:'op 5445'})[0].id,'b');
  assert.deepEqual(selectCommercialRows(rows,{stage:'history'}).map(x=>x.id),['h']);
});
