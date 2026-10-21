import { fulfillmentSummary } from './digitalOrderValueModel.js';
import { amazonProductsPreview } from '../../../shared/amazonOrderAmounts.js';
import { countsInSales } from './digitalSalesDayModel.js';
import { knownAmounts } from './digitalDashboardModel.js';

export function digitalChannelKpis(orders, lines) {
  const sales = orders.filter(countsInSales);
  const index = new Map(sales.map(order => [order.id, order]));
  const grouped = new Map();
  for (const order of sales) {
    if (!order.account_id) continue;
    if (!grouped.has(order.account_id)) grouped.set(order.account_id, { id: order.account_id, nome: order.customerName || order.raw_summary?.customer_name || 'Nominativo non disponibile', orders: [] });
    grouped.get(order.account_id).orders.push(order);
  }
  const products = new Map();
  for (const line of lines) {
    const order = index.get(line.order_id);
    if (!order || line.metadati?.type === 'shipping' || String(line.external_line_id || '').startsWith('shipping:')) continue;
    const key = String(line.product_id || line.canonical_code || line.asin || line.external_sku || `line:${line.id}`);
    if (!products.has(key)) products.set(key, { id: key, code: line.canonical_code || line.external_sku || line.asin || line.product_id || '—', name: line.canonical_name || line.metadati?.name || line.metadati?.nome || line.external_sku || line.asin || 'Prodotto', quantity: 0, unknownQuantity: false, orders: new Set(), lines: [] });
    const product = products.get(key);
    if (line.quantity == null || !Number.isFinite(Number(line.quantity))) product.unknownQuantity = true;
    else product.quantity += Number(line.quantity);
    product.orders.add(order.id);
    product.lines.push({ ...line, currency: order.currency });
  }
  const amounts = knownAmounts(sales);
  const averages = { ...amounts, totals: amounts.totals.map(total => ({ ...total, amount: total.amount / sales.filter(order => (order.currency || 'EUR') === total.currency && order.net_revenue != null && Number.isFinite(Number(order.net_revenue))).length })) };
  return { sales, amounts, averages, orderValues:fulfillmentSummary(orders), unidentified: sales.filter(order => !order.account_id).length,
    customers: [...grouped.values()].map(row => ({ ...row, count: row.orders.length, amounts: knownAmounts(row.orders) })),
    products: [...products.values()].map(row => ({ ...row, count: row.orders.size, amounts: knownAmounts(row.lines, 'line_revenue') })) };
}

export function scopeDigitalChannelSales(channel, connections, orders, lines) {
  const type = channel === 'ecommerce' ? 'ecommerce' : channel === 'amazon' ? 'amazon_seller' : null;
  const ids = new Set(connections.filter(row => row.tipo === type).map(row => row.id));
  const scopedOrders = orders.filter(row => ids.has(row.connection_id));
  const orderIds = new Set(scopedOrders.map(row => row.id));
  const scopedLines = lines.filter(row => orderIds.has(row.order_id));
  const byOrder = new Map();
  for (const line of scopedLines) { if (!byOrder.has(line.order_id)) byOrder.set(line.order_id,[]); byOrder.get(line.order_id).push(line); }
  return { orders: channel === 'amazon' ? scopedOrders.map(order => ({...order,pricePreview:amazonProductsPreview(byOrder.get(order.id),order.currency)})) : scopedOrders, lines: scopedLines };
}
