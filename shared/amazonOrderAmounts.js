const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function amazonProductsPreview(lines, currency = 'EUR') {
  if (!lines?.length) return null;
  let total = 0;
  for (const line of lines) {
    const proceeds = numeric(line.line_revenue);
    const unit = numeric(line.unit_price), quantity = numeric(line.quantity);
    if (proceeds != null) total += proceeds;
    else if (unit != null && quantity != null && quantity >= 0) total += unit * quantity;
    else return null;
  }
  return { amount: Math.round((total + Number.EPSILON) * 100) / 100, currency };
}
export function orderDisplayAmount(order) {
  const net = numeric(order.net_revenue), gross = numeric(order.gross_revenue);
  if (net != null) return { amount: net, note: '', basis: 'net' };
  if (gross != null) return { amount: gross, note: 'IVA inclusa', basis: 'gross' };
  if (order.pricePreview) return { amount: order.pricePreview.amount, note: 'Solo prodotti · provvisorio', basis: 'products' };
  return { amount: null, note: '', basis: 'unavailable' };
}

export function withOrderPreviews(orders, lines) {
  const byOrder = new Map();
  for (const line of lines) { if (!byOrder.has(line.order_id)) byOrder.set(line.order_id,[]); byOrder.get(line.order_id).push(line); }
  return orders.map(order=>({...order,pricePreview:amazonProductsPreview(byOrder.get(order.id),order.currency) || order.pricePreview}));
}
