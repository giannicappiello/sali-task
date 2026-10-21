import test from 'node:test';
import assert from 'node:assert/strict';
import { digitalChannelKpis } from '../../src/modules/crm/digitalChannelKpiModel.js';

test('KPI counts unique buyers, excludes failed orders and keeps unknown amounts partial', () => {
  const model = digitalChannelKpis([
    { id: '1', account_id: 'a', customerName: 'Mottola Daniela', stato: 'completed', net_revenue: 120, currency: 'EUR' },
    { id: '2', account_id: 'a', stato: 'processing', net_revenue: 80, currency: 'EUR' },
    { id: '3', account_id: 'b', stato: 'failed', net_revenue: 900, currency: 'EUR' },
    { id: '4', account_id: null, stato: 'shipped', net_revenue: null, currency: 'EUR' },
    { id: '5', account_id: 'c', stato: 'completed', net_revenue: 30, currency: 'USD' },
  ], []);
  assert.equal(model.sales.length, 4);
  assert.equal(model.customers.length, 2);
  assert.equal(model.customers[0].count, 2);
  assert.equal(model.customers[0].nome, 'Mottola Daniela');
  assert.equal(model.unidentified, 1);
  assert.equal(model.amounts.missing, 1);
  assert.deepEqual(model.amounts.totals, [{currency:'EUR',amount:200},{currency:'USD',amount:30}]);
  assert.deepEqual(model.averages.totals, [{currency:'EUR',amount:100},{currency:'USD',amount:30}]);
});

test('products combine all valid sales without UDM, excluding shipping and invalid orders', () => {
  const model = digitalChannelKpis([{id:'1',stato:'completed',currency:'EUR'},{id:'2',stato:'unshipped',currency:'EUR'},{id:'3',stato:'pending'}], [
    {id:'a',order_id:'1',external_sku:'IT01',quantity:2,line_revenue:10,metadati:{name:'Crema'}},
    {id:'b',order_id:'2',external_sku:'IT01',quantity:3,line_revenue:15},
    {id:'c',order_id:'3',external_sku:'IT02',quantity:9},
    {id:'d',order_id:'1',external_line_id:'shipping:1',quantity:1,line_revenue:5},
    {id:'e',order_id:'2',metadati:{type:'shipping'},quantity:1},
    {id:'f',order_id:'1',external_sku:'IT03',quantity:null},
  ]);
  assert.equal(model.products.length, 2);
  assert.equal(model.products[0].quantity, 5);
  assert.equal(model.products[0].count, 2);
  assert.equal(model.products[0].amounts.totals[0].amount, 25);
  assert.equal(model.products[1].unknownQuantity, true);
});

test('empty period yields no customers or products and no invalid average', () => {
  const model = digitalChannelKpis([], []);
  assert.equal(model.customers.length, 0);
  assert.equal(model.products.length, 0);
  assert.deepEqual(model.averages.totals, []);
});
