import { knownAmounts } from './digitalDashboardModel.js';
const mappingKey = (connection, marketplace, sku) => JSON.stringify([connection, marketplace || '', sku || '']);
export function reconcileDigitalLines(orders, lines, mappings = []) {
  const orderById = new Map(orders.map(order => [order.id, order]));
  const bySku = new Map(mappings.map(row => [mappingKey(row.connection_id,row.marketplace,row.external_sku),row]));
  return lines.map(line => {
    const order = orderById.get(line.order_id);
    const mapping = order && bySku.get(mappingKey(order.connection_id,order.marketplace,line.external_sku));
    if (!mapping) return line;
    return { ...line, product_id: mapping.status === 'matched' ? mapping.product_id : null,
      canonical_code: mapping.status === 'matched' ? mapping.codice_mexal || mapping.prodotti?.codice_mexal || mapping.prodotti?.codice : null,
      canonical_name: mapping.status === 'matched' ? mapping.prodotti?.nome : null };
  });
}
export function productAsinRows(product) {
  const variants = new Map();
  for (const line of product.lines) {
    const key = JSON.stringify([line.asin || '',line.external_sku || '']);
    if (!variants.has(key)) variants.set(key,{id:key,asin:line.asin || '—',sku:line.external_sku || '—',quantity:0,unknownQuantity:false,orders:new Set(),lines:[]});
    const row = variants.get(key);
    if (line.quantity == null) row.unknownQuantity = true; else row.quantity += Number(line.quantity);
    row.orders.add(line.order_id); row.lines.push(line);
  }
  return [...variants.values()].map(row=>({...row,count:row.orders.size,amounts:knownAmounts(row.lines,'line_revenue')}));
}
