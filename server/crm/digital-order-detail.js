import { netSalesLineAmount, asNetSalesLine } from '../../shared/netRevenue.js';
/* global Buffer */
import { request } from './digital-provider-adapters.js';
import { safeFetch } from './digital-security.js';
import { amazonProductsPreview } from '../../shared/amazonOrderAmounts.js';
import { amazonOrder, wooShippingLines } from './commerce-import.js';
import { formatMexalOrderReference, wooMexalOrderReference, wooMexalSyncStatus } from '../../shared/wooMexalReference.js';
import { fetchAmazonOrderWithBuyer, amazonBuyerUnavailable } from './amazon-buyer.js';

export function wooOrderDetail(order) {
  return {
    mexalOc: wooMexalOrderReference(order),
    mexalSync: wooMexalSyncStatus(order),
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
  let result = { customerName: order.crm_accounts?.nome || null, lines:connection.provider_code==='amazon_sp_api'?lines.map(line=>asNetSalesLine(line,{...order,raw_summary:{...order.raw_summary,provider:'amazon_sp_api'}})):lines, mexalOc: connection.provider_code === 'woocommerce' ? formatMexalOrderReference(order.raw_summary?.mexal_oc) : null, mexalSync: connection.provider_code === 'woocommerce' ? order.raw_summary?.mexal_sync || null : null };
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
      if (result.mexalOc && result.mexalOc !== order.raw_summary?.mexal_oc && dependencies.saveMexalReference) {
        try { await dependencies.saveMexalReference(order, result.mexalOc); } catch { /* The live reference remains available if caching is temporarily unavailable. */ }
      }
    } catch {
      warning = 'Il sito non è raggiungibile. Sono mostrati i dettagli già importati, che possono essere incompleti.';
    }
  } else if (connection.provider_code === 'amazon_sp_api') {
    result.buyerAccess = 'unavailable';
    try {
      const secrets = await dependencies.secrets(connection.id);
      const fetcher = dependencies.fetcher || safeFetch;
      const buyer = await fetchAmazonOrderWithBuyer(connection,secrets,order.external_id,{fetcher});
      const data = { order:buyer.order };
      result.customerName = buyer.customerName;
      result.buyerAccess = buyer.buyerAccess;
      const current = amazonOrder(data.order);
      result.amount = current.net_revenue ?? order.net_revenue;
      result.total = current.gross_revenue ?? order.gross_revenue;
      result.currency = data.order.proceeds?.grandTotal?.currencyCode || data.order.orderItems.find(line => line.product?.price?.unitPrice?.currencyCode)?.product.price.unitPrice.currencyCode || order.currency;
      result.status = current.stato === 'UNKNOWN' ? order.stato : current.stato;
      result.pricePreview = amazonProductsPreview(current.lines,result.currency,current);
      result.lines = data.order.orderItems.map(line => {
        const amount = netSalesLineAmount(current.lines.find(row => row.external_line_id === line.orderItemId) || {}, current);
        return { id: line.orderItemId, name: line.product?.title || line.product?.sellerSku || line.product?.asin || 'Prodotto non identificato',
          sku: line.product?.sellerSku, asin: line.product?.asin, quantity: line.quantityOrdered,
          unitPrice: Number(line.quantityOrdered) > 0 && amount !== null ? amount / Number(line.quantityOrdered) : null,
          amount, discount: null };
      });
    } catch { warning = 'Amazon non è raggiungibile. Sono mostrati i dettagli già importati, che possono essere incompleti.'; }
  }
  return { order: { id: order.id, number: order.external_id, date: order.ordered_at, status: order.stato,
    currency: order.currency, amount: order.net_revenue, total: order.gross_revenue, discounts: order.discounts, refunds: order.refunds,
    marketplace: order.marketplace, ...result, warning,
    coxStatus: order.cox_status, coxReference: order.cox_reference, coxError: order.cox_error,
    customerUnavailable: !result.customerName ? connection.provider_code === 'amazon_sp_api' ? amazonBuyerUnavailable(result.buyerAccess,result.status || order.stato) : 'Nome cliente non disponibile.' : null } };
}
