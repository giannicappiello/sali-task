import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigitalDashboard, knownAmounts } from '../../src/modules/crm/digitalDashboardModel.js';

const order = (id, day, amount, extra = {}) => ({ id, account_id: 'one', ordered_at: `${day}T12:00:00Z`, stato: 'completed', currency: 'EUR', net_revenue: amount, ...extra });
const from = '2026-10-01', to = '2026-10-20';
test('dashboard includes anonymous Amazon orders and known money without double counting shipping', () => {
  const result = buildDigitalDashboard({ accounts: [{ id: 'one' }, { id: 'newsletter' }], from, to,
    orders: [order('1', '2026-10-19', 131.23), order('2', '2026-10-20', null, { account_id: null, marketplace: 'Amazon' }), order('3', '2026-10-20', 100, { stato: 'failed' })],
    lines: [{ id: 'line', order_id: '1', external_sku: 'IT1', quantity: 2, line_revenue: 116.23 }, { id: 'shipping', order_id: '1', external_line_id: 'shipping:total', quantity: 1, line_revenue: 15 }] });
  assert.equal(result.sales.length, 2); assert.equal(result.unidentified, 1);
  assert.equal(result.amounts.totals[0].amount, 131.23); assert.equal(result.amounts.missing, 1);
  assert.equal(result.products.length, 1); assert.equal(result.products[0].quantity, 2);
  assert.equal(result.customers[0].order_count, 1); assert.equal(result.customers[1].lifecycle, 'prospect');
});
test('products without UDM combine and reserved, purchased and open orders stay distinct', () => {
  const result = buildDigitalDashboard({ accounts: [], from, to, orders: [order('1', '2026-10-19', 2), order('2', '2026-10-19', 2), order('3', '2026-10-19', 2, { stato: 'Unshipped' }), order('4', '2026-10-19', 2, { stato: 'pending' })],
    lines: ['1','2','3','4'].map(id => ({ id, order_id: id, external_sku: 'IT1', quantity: 2 })) });
  assert.equal(result.products.length, 3);
  assert.equal(result.products.find(row => row.category === 'purchased').quantity, 4);
  assert.equal(result.products.find(row => row.category === 'reserved').quantity, 2);
  assert.equal(result.sales.length, 3);
});
test('customer lifecycle uses complete history but period purchases exclude older and future records', () => {
  const result = buildDigitalDashboard({ accounts: [{ id: 'one' }], from, to, lines: [], orders: [order('old', '2026-08-25', 157.46), order('new', '2026-10-19', 131.23), order('future', '2026-11-01', 500)] });
  assert.equal(result.customers[0].history_count, 2); assert.equal(result.customers[0].order_count, 1);
  assert.equal(result.customers[0].first_purchase, '2026-08-25'); assert.equal(result.customers[0].lifecycle, 'current');
  assert.equal(result.amounts.totals[0].amount, 131.23);
});
test('currencies and unavailable amounts remain separate', () => {
  assert.deepEqual(knownAmounts([{ net_revenue: 10, currency: 'EUR' }, { net_revenue: 20, currency: 'USD' }, { net_revenue: null }]), { totals: [{ currency: 'EUR', amount: 10 }, { currency: 'USD', amount: 20 }], known: 2, missing: 1 });
});
