import test from 'node:test';
import assert from 'node:assert/strict';
import { fulfillmentSummary, marketplaceBreakdown, combineAmounts } from '../../src/modules/crm/digitalOrderValueModel.js';
import { customerPurchases } from '../../src/modules/crm/customerPurchaseModel.js';
import { salesDays } from '../../src/modules/crm/digitalSalesDayModel.js';

const orders = [
  {id:'s',connection_id:'a',marketplace:'APJ6JRA9NG5V4',stato:'SHIPPED',net_revenue:100,currency:'EUR',ordered_at:'2026-10-21'},
  {id:'p',connection_id:'a',marketplace:'APJ6JRA9NG5V4',stato:'PENDING',net_revenue:40,currency:'EUR',ordered_at:'2026-10-21'},
  {id:'u',connection_id:'a',marketplace:'APJ6JRA9NG5V4',stato:'UNSHIPPED',net_revenue:null,currency:'EUR',ordered_at:'2026-10-21'},
  {id:'c',connection_id:'a',marketplace:'APJ6JRA9NG5V4',stato:'CANCELLED',net_revenue:999,currency:'EUR',ordered_at:'2026-10-21'},
  {id:'w',connection_id:'w',marketplace:'website',stato:'completed',net_revenue:60,currency:'EUR',ordered_at:'2026-10-21'},
  {id:'d',connection_id:'d',marketplace:'USA',stato:'processing',net_revenue:20,currency:'USD',ordered_at:'2026-10-21'},
];
test('order value cards split fulfillment, include pending amounts, preserve unknown money and separate currencies',()=>{
  const result=fulfillmentSummary(orders);
  assert.equal(result.orders.length,5);
  assert.deepEqual(result.fulfilled.amounts.totals,[{currency:'EUR',amount:160}]);
  assert.deepEqual(result.waiting.amounts.totals,[{currency:'EUR',amount:40},{currency:'USD',amount:20}]);
  assert.equal(result.waiting.amounts.missing,1);
  assert.equal(result.averages.totals.find(row=>row.currency==='EUR').amount,200/3);
  assert.equal(result.averages.totals.find(row=>row.currency==='USD').amount,20);
});
test('marketplace chart counts all eligible orders but divides known amounts only by known orders',()=>{
  const rows=marketplaceBreakdown(orders,[{id:'w',site_url:'https://salidischia.it'}]);
  const amazon=rows.find(row=>row.label==='Amazon_IT');
  assert.equal(amazon.orders.length,3); assert.equal(amazon.amounts.totals[0].amount,140);
  assert.equal(amazon.averages.totals[0].amount,70); assert.equal(amazon.amounts.missing,1);
  assert.equal(rows.find(row=>row.label==='salidischia.it').amounts.totals[0].amount,60);
  assert.equal(rows.find(row=>row.currency==='USD').amounts.totals[0].amount,20);
  assert.equal(marketplaceBreakdown([]).length,0);
});
test('customer list and profile use the same fulfillment totals within the selected period',()=>{
  const result=customerPurchases([...orders,{...orders[0],id:'old',ordered_at:'2026-09-01',net_revenue:500}],'2026-10-01','2026-10-21');
  assert.equal(result.fulfilled_count,2); assert.equal(result.waiting_count,3);
  assert.deepEqual(result.fulfilled_amounts.totals,[{currency:'EUR',amount:160}]);
  const merged=combineAmounts([result.fulfilled_amounts,result.waiting_amounts]);
  assert.equal(merged.missing,1); assert.equal(merged.known,4);
  assert.deepEqual(merged.totals,[{currency:'EUR',amount:200},{currency:'USD',amount:20}]);
});

test('KPI drilldowns include waiting order amounts and expose incomplete daily totals',()=>{
  const eligible=fulfillmentSummary(orders).orders;
  const euro=salesDays(eligible,true).find(row=>row.currency==='EUR');
  assert.equal(euro.amount,200); assert.equal(euro.count,4); assert.equal(euro.missingAmountCount,1);
  const waiting=salesDays(fulfillmentSummary(orders).waiting.orders,true).find(row=>row.currency==='EUR');
  assert.equal(waiting.amount,40); assert.equal(waiting.count,2);
});
