import { marketplaceLabel } from './marketplaceLabel.js';
const EXCLUDED = new Set(['cancelled','canceled','failed','pending','on-hold','pending_availability','unfulfillable']);
export function countsInSales(order) { return !EXCLUDED.has(String(order.stato || '').toLowerCase()); }
export function fulfillmentBucket(order) {
  const status = String(order.stato || '').toLowerCase();
  if (['shipped','completed','delivered','refunded'].includes(status)) return 'fulfilled';
  if (['pending','pending_availability','unshipped','partially_shipped','processing','on-hold'].includes(status)) return 'waiting';
  return 'other';
}
export function salesDays(orders) {
  const days = new Map();
  for (const order of orders) {
    const date = new Date(order.ordered_at);
    if (!Number.isFinite(date.getTime())) continue;
    const day = date.toISOString().slice(0, 10), currency = order.currency || 'EUR';
    const key = `${day}:${currency}`;
    if (!days.has(key)) days.set(key, { id: key, date: day, currency, marketplaces: new Set(), orders: [], count: 0, amount: 0, unknownAmount: false, fulfilledCount:0, waitingCount:0, fulfilledAmount:0, fulfilledMissing:0 });
    const group = days.get(key); group.orders.push(order); group.marketplaces.add(marketplaceLabel(order.marketplace, 'Sito'));
    const bucket = fulfillmentBucket(order);
    if (bucket === 'fulfilled') {
      group.fulfilledCount++;
      if (order.net_revenue == null || !Number.isFinite(Number(order.net_revenue))) group.fulfilledMissing++;
      else group.fulfilledAmount += Number(order.net_revenue);
    } else if (bucket === 'waiting') group.waitingCount++;
    if (countsInSales(order)) {
      group.count++;
      if (order.net_revenue == null || !Number.isFinite(Number(order.net_revenue))) group.unknownAmount = true;
      else group.amount += Number(order.net_revenue);
    }
  }
  return [...days.values()].map((d) => ({ ...d, marketplace: [...d.marketplaces].sort().join(', '),
    fulfilledAmount: d.fulfilledCount > 0 && d.fulfilledMissing === d.fulfilledCount ? null : Math.round(d.fulfilledAmount * 100) / 100,
    amount: d.unknownAmount || !d.count ? null : Math.round(d.amount * 100) / 100,
    orders: d.orders.sort((a,b) => String(b.ordered_at).localeCompare(String(a.ordered_at)) || String(a.id).localeCompare(String(b.id))) }))
    .sort((a,b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency));
}
