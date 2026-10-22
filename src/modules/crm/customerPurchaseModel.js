import { fulfillmentSummary } from './digitalOrderValueModel.js';
import { countsInSales, verifiedFulfillment } from './digitalSalesDayModel.js';

const dayOf = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
};

export function ordersInPeriod(orders, from, to) {
  return orders.filter(order => {
    const day = dayOf(order.ordered_at);
    return verifiedFulfillment(order) && day && (!from || day >= from) && (!to || day <= to);
  });
}

// All providers share the same account link. Amounts already include shipping,
// discounts and refunds: never add line totals to the order total again.
export function customerPurchases(orders, from, to) {
  const values = fulfillmentSummary(ordersInPeriod(orders,from,to));
  const history = ordersInPeriod(orders, null, to).filter(countsInSales);
  const period = ordersInPeriod(history, from, to);
  const currencies = [...new Set(period.map(order => order.currency || 'EUR'))];
  const amountsKnown = period.every(order => order.net_revenue != null && Number.isFinite(Number(order.net_revenue)));
  const amount = amountsKnown && currencies.length <= 1
    ? Math.round(period.reduce((sum, order) => sum + Number(order.net_revenue), 0) * 100) / 100 : null;
  const days = [...new Set(history.map(order => dayOf(order.ordered_at)))].sort();
  const last = days.at(-1) || null;
  const gap = days.length > 1 ? (Date.parse(last) - Date.parse(days[0])) / 86400000 / (days.length - 1) : null;
  return {
    order_averages:values.averages, fulfilled_amounts:values.fulfilled.amounts, waiting_amounts:values.waiting.amounts, fulfilled_count:values.fulfilled.orders.length, waiting_count:values.waiting.orders.length,
    order_total: amount, order_count: period.length,
    currency: currencies.length === 1 ? currencies[0] : 'EUR', currencies,
    average_order_value: period.length && amount != null ? amount / period.length : null,
    first_purchase: days[0] || null, ultimo_ordine_il: last, average_gap_days: gap,
    expected_reorder_date: gap == null ? null : new Date(Date.parse(last) + Math.round(gap) * 86400000).toISOString().slice(0, 10),
  };
}

export function purchasesByAccount(orders, from, to) {
  const grouped = new Map();
  for (const order of orders) {
    if (!order.account_id) continue;
    if (!grouped.has(order.account_id)) grouped.set(order.account_id, []);
    grouped.get(order.account_id).push(order);
  }
  return new Map([...grouped].map(([id, rows]) => [id, customerPurchases(rows, from, to)]));
}

export function formatPurchaseAmount(value, currency = 'EUR') {
  return value == null ? 'Dato non disponibile' : new Intl.NumberFormat('it-IT', { useGrouping: 'always', style: 'currency', currency }).format(value);
}
