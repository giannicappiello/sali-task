import test from 'node:test';
import assert from 'node:assert/strict';
import { customerPurchases, purchasesByAccount, ordersInPeriod } from '../../src/modules/crm/customerPurchaseModel.js';

const order = (id, day, amount, extra = {}) => ({ id, account_id: 'daniela', ordered_at: `${day}T12:00:00Z`, net_revenue: amount, stato: 'completed', currency: 'EUR', ...extra });

test('all marketplaces contribute to their linked customer; shipping is already in net amount', () => {
  const result = purchasesByAccount([
    order('13729', '2026-10-19', 131.23, { marketplace: 'website' }),
    order('amazon-1', '2026-10-20', 20, { marketplace: 'amazon.it', stato: 'Shipped' }),
    order('other-1', '2026-10-20', 10, { marketplace: 'other' }),
    order('another-customer', '2026-10-20', 999, { account_id: 'other' }),
    order('anonymous-amazon', '2026-10-20', 999, { account_id: null }),
  ], '2026-10-19', '2026-10-20');
  assert.equal(result.size, 2);
  assert.equal(result.get('daniela').order_total, 161.23);
  assert.equal(result.get('daniela').order_count, 3);
  assert.equal(result.get('daniela').ultimo_ordine_il, '2026-10-20');
});

test('period amounts exclude failed/cancelled/pending but include net refunds without adding twice', () => {
  const orders = [order('prior', '2026-09-01', 30), order('last', '2026-10-19', 131.23),
    ...['failed', 'cancelled', 'Canceled', 'Pending', 'on-hold', 'Pending_Availability'].map((stato, i) => order(`excluded-${i}`, '2026-10-20', 500, { stato })),
    order('refund', '2026-10-20', 0, { stato: 'refunded' }), order('future', '2026-10-21', 500)];
  const metrics = customerPurchases(orders, '2026-10-19', '2026-10-20');
  assert.equal(metrics.order_count, 2);
  assert.equal(metrics.order_total, 131.23);
  assert.equal(metrics.average_order_value, 65.615);
  assert.equal(metrics.first_purchase, '2026-09-01');
  assert.equal(metrics.ultimo_ordine_il, '2026-10-20');
  assert.equal(ordersInPeriod(orders, '2026-10-19', '2026-10-20').length, 8);
});

test('cadence uses distinct historical purchase days up to period end', () => {
  const result = customerPurchases([order('1', '2026-10-01', 1), order('2', '2026-10-11', 1), order('3', '2026-10-11', 1), order('future', '2026-11-01', 1)], '2026-10-10', '2026-10-20');
  assert.equal(result.order_count, 2);
  assert.equal(result.average_gap_days, 10);
  assert.equal(result.expected_reorder_date, '2026-10-21');
});

test('missing amounts and mixed currencies are not misleading euro totals', () => {
  assert.equal(customerPurchases([order('missing', '2026-10-19', null)]).order_total, null);
  const mixed = customerPurchases([order('eur', '2026-10-19', 10), order('usd', '2026-10-19', 20, { currency: 'USD' })]);
  assert.equal(mixed.order_count, 2);
  assert.equal(mixed.order_total, null);
  assert.equal(customerPurchases([order('usd', '2026-10-19', 20, { currency: 'USD' })]).currency, 'USD');
  assert.equal(customerPurchases([]).order_total, 0);
  assert.equal(customerPurchases([order('invalid', 'invalid', 10)]).order_count, 0);
});
