/* global Buffer */
import { request, refreshAccessToken } from './digital-provider-adapters.js';
import { safeFetch } from './digital-security.js';
import { amazonProductsPreview } from '../../shared/amazonOrderAmounts.js';
import { amazonOrder, wooShippingLines } from './commerce-import.js';

export function wooOrderDetail(order) {
  return {
    customerName: [order.billing?.last_name, order.billing?.first_name].filter(Boolean).join(' ').trim() || order.billing?.company || null,
    lines: (order.line_items || []).map((line) => ({
      id: String(line.id), name: line.name || line.sku || 'Prodotto non identificato', sku: line.sku || null,
      quantity: line.quantity, unitPrice: line.price ?? null, amount: line.total ?? null,
      discount: line.subtotal != null && line.total != null ? Math.round((Number(line.subtotal) - Number(line.total)) * 100) / 100 : null,
    })).concat(wooShippingLines(order).map(line => ({ id: line.external_line_id, name: line.name, sku: null, quantity: 1, unitPrice: line.unit_price, amount: line.line_revenue, discount: 0, type: 'shipping' }))),
  };
}

// The caller must load the order through the user's RLS client and check its screen
// before any service credential or provider request is used.
export async function loadDigitalOrderDetail(orderId, dependencies) {
  const order = await dependencies.visibleOrder(orderId);
  if (!order) throw Object.assign(new Error('Ordine non trovato o non accessibile.'), { status: 404 });
  const connection = await dependencies.connection(order.connection_id);
  await dependencies.authorizeScreen(connection.tipo === 'ecommerce' ? 'crm.online.ecommerce' : 'crm.online.amazon');
  const lines = await dependencies.cachedLines(order.id);
  let result = { customerName: order.crm_accounts?.nome || null, lines };
  let warning = null;
  if (connection.provider_code === 'woocommerce') {
    try {
      const secrets = await dependencies.secrets(connection.id);
      const base = String(connection.configurazione.site_url).replace(/\/$/, '');
      const data = await request(`${base}/wp-json/wc/v3/orders/${encodeURIComponent(order.external_id)}`, {
        headers: { authorization: `Basic ${Buffer.from(`${secrets.consumer_key}:${secrets.consumer_secret}`).toString('base64')}` },
      }, dependencies.fetcher || safeFetch, 'Dettaglio ordine WooCommerce');
      if (String(data.id) !== String(order.external_id) || !Array.isArray(data.line_items)) throw new Error('Dettaglio non valido.');
      result = wooOrderDetail(data);
    } catch {
      warning = 'Il sito non è raggiungibile. Sono mostrati i dettagli già importati, che possono essere incompleti.';
    }
  } else if (connection.provider_code === 'amazon_sp_api') {
    try {
      const secrets = await dependencies.secrets(connection.id);
      const fetcher = dependencies.fetcher || safeFetch;
      const token = await refreshAccessToken(connection, secrets, fetcher);
      const root = { eu: 'https://sellingpartnerapi-eu.amazon.com', na: 'https://sellingpartnerapi-na.amazon.com', fe: 'https://sellingpartnerapi-fe.amazon.com' }[connection.configurazione.region || 'eu'];
      const data = await request(`${root}/orders/2026-01-01/orders/${encodeURIComponent(order.external_id)}?includedData=PROCEEDS,FULFILLMENT`, {
        headers: { 'x-amz-access-token': token.access_token, 'user-agent': 'Workspace/1.0 (Language=JavaScript; Platform=Node.js)', accept: 'application/json' },
      }, fetcher, 'Dettaglio ordine Amazon');
      if (String(data.order?.orderId) !== String(order.external_id) || !Array.isArray(data.order?.orderItems)) throw new Error('Dettaglio non valido.');
      const current = amazonOrder(data.order);
      result.amount = current.net_revenue ?? order.net_revenue;
      result.total = current.gross_revenue ?? order.gross_revenue;
      result.currency = data.order.proceeds?.grandTotal?.currencyCode || data.order.orderItems.find(line => line.product?.price?.unitPrice?.currencyCode)?.product.price.unitPrice.currencyCode || order.currency;
      result.status = current.stato === 'UNKNOWN' ? order.stato : current.stato;
      result.pricePreview = amazonProductsPreview(current.lines,result.currency);
      result.lines = data.order.orderItems.map((line) => ({ id: line.orderItemId, name: line.product?.title || line.product?.sellerSku || line.product?.asin || 'Prodotto non identificato',
        sku: line.product?.sellerSku, asin: line.product?.asin, quantity: line.quantityOrdered, unitPrice: line.product?.price?.unitPrice?.amount ?? null,
        amount: line.proceeds?.proceedsTotal?.amount ?? null, discount: null }));
    } catch { warning = 'Amazon non è raggiungibile. Sono mostrati i dettagli già importati, che possono essere incompleti.'; }
  }
  return { order: { id: order.id, number: order.external_id, date: order.ordered_at, status: order.stato,
    currency: order.currency, amount: order.net_revenue, total: order.gross_revenue, discounts: order.discounts, refunds: order.refunds,
    marketplace: order.marketplace, ...result, warning,
    customerUnavailable: !result.customerName ? connection.provider_code === 'amazon_sp_api' ? 'Nome cliente non fornito da Amazon con i permessi disponibili.' : 'Nome cliente non disponibile.' : null } };
}
