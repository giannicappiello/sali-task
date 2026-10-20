import { countsInSales } from './digitalSalesDayModel.js';
import { customerPurchases, ordersInPeriod, formatPurchaseAmount } from './customerPurchaseModel.js';

export function knownAmounts(rows, field = 'net_revenue') {
  const totals = new Map(); let missing = 0;
  for (const row of rows) {
    if (row[field] == null || !Number.isFinite(Number(row[field]))) { missing++; continue; }
    const currency = row.currency || 'EUR';
    totals.set(currency, (totals.get(currency) || 0) + Number(row[field]));
  }
  return { totals: [...totals].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })), missing, known: rows.length - missing };
}

export function displayAmounts(amounts) {
  return amounts.totals.length ? amounts.totals.map(row => formatPurchaseAmount(row.amount, row.currency)).join(' · ') : amounts.missing ? 'Dato non disponibile' : formatPurchaseAmount(0);
}

export function buildDigitalDashboard({ accounts, orders, lines, from, to }) {
  const periodOrders = ordersInPeriod(orders, from, to);
  const sales = periodOrders.filter(countsInSales);
  const history = ordersInPeriod(orders, null, to).filter(countsInSales);
  const grouped = new Map();
  for (const order of history) {
    if (!order.account_id) continue;
    if (!grouped.has(order.account_id)) grouped.set(order.account_id, []);
    grouped.get(order.account_id).push(order);
  }
  const customers = accounts.map(account => {
    const rows = grouped.get(account.id) || [];
    const metrics = customerPurchases(rows, from, to);
    const daysSince = metrics.ultimo_ordine_il ? (Date.parse(to) - Date.parse(metrics.ultimo_ordine_il)) / 86400000 : null;
    const gap = metrics.average_gap_days || 90;
    const lifecycle = !rows.length ? 'prospect' : rows.length === 1 ? 'first' : daysSince <= gap ? 'current' : daysSince <= gap * 1.5 ? 'risk' : daysSince <= gap * 2 ? 'dormant' : 'lost';
    return { ...account, ...metrics, amounts: knownAmounts(ordersInPeriod(rows, from, to)), history_count: rows.length, days_since: daysSince, lifecycle };
  });
  const index = new Map(periodOrders.map(order => [order.id, order]));
  const products = new Map();
  for (const line of lines) {
    const order = index.get(line.order_id);
    if (!order || line.metadati?.type === 'shipping' || String(line.external_line_id || '').startsWith('shipping:')) continue;
    const status = String(order.stato || '').toLowerCase();
    const category = ['pending', 'on-hold', 'pending_availability'].includes(status) ? 'reserved' : !countsInSales(order) ? null : ['completed', 'shipped', 'refunded', 'delivered'].includes(status) ? 'purchased' : 'ordered';
    if (!category) continue;
    const code = line.product_id || line.external_sku || line.asin;
    // Missing identifiers stay separate rather than merging unrelated unnamed products.
    const key = code ? String(code) : `line:${line.id}`;
    const id = `${category}:${key}`;
    if (!products.has(id)) products.set(id, { id, category, code: line.external_sku || line.asin || line.product_id || 'Codice non disponibile', name: line.metadati?.name || line.metadati?.nome || line.external_sku || line.asin || 'Prodotto', quantity: 0, unknownQuantity: false, documents: new Set(), lines: [] });
    const product = products.get(id);
    if (line.quantity == null) product.unknownQuantity = true; else product.quantity += Number(line.quantity);
    product.documents.add(order.id);
    product.lines.push({ ...line, currency: order.currency, external_id: order.external_id, ordered_at: order.ordered_at, marketplace: order.marketplace });
  }
  return { customers, periodOrders, sales, amounts: knownAmounts(sales), unidentified: sales.filter(order => !order.account_id).length,
    products: [...products.values()].map(product => ({ ...product, documents: product.documents.size, amounts: knownAmounts(product.lines, 'line_revenue') })) };
}
