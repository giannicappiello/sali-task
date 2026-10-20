const EXCLUDED = new Set(['cancelled','canceled','failed','pending','on-hold','pending_availability']);
export function countsInSales(order) { return !EXCLUDED.has(String(order.stato || '').toLowerCase()); }
export function salesDays(orders) {
  const days = new Map();
  for (const order of orders) {
    const date = new Date(order.ordered_at);
    if (!Number.isFinite(date.getTime())) continue;
    const day = date.toISOString().slice(0, 10), currency = order.currency || 'EUR';
    const key = `${day}:${currency}`;
    if (!days.has(key)) days.set(key, { id: key, date: day, currency, marketplaces: new Set(), orders: [], count: 0, amount: 0, unknownAmount: false });
    const group = days.get(key); group.orders.push(order); group.marketplaces.add(order.marketplace || 'Sito');
    if (countsInSales(order)) {
      group.count++;
      if (order.net_revenue == null || !Number.isFinite(Number(order.net_revenue))) group.unknownAmount = true;
      else group.amount += Number(order.net_revenue);
    }
  }
  return [...days.values()].map((d) => ({ ...d, marketplace: [...d.marketplaces].sort().join(', '),
    amount: d.unknownAmount || !d.count ? null : Math.round(d.amount * 100) / 100,
    orders: d.orders.sort((a,b) => String(b.ordered_at).localeCompare(String(a.ordered_at)) || String(a.id).localeCompare(String(b.id))) }))
    .sort((a,b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency));
}
