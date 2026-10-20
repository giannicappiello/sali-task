/* global Buffer */
import crypto from 'node:crypto';
import { safeFetch } from './digital-security.js';
import { request, refreshAccessToken } from './digital-provider-adapters.js';

export const COMMERCE_PROVIDERS = ['woocommerce', 'amazon_sp_api', 'mailchimp'];
const money = (v) => v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const rounded = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const text = (v) => String(v ?? '').slice(0, 1000);
export function publicAsset(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search ? u.href : null; } catch { return null; }
}
export function wooCustomer(row) {
  const email = text(row.email || row.billing?.email).trim().toLowerCase();
  return { external_id: String(row.id), nome: text([row.first_name || row.billing?.first_name, row.last_name || row.billing?.last_name].filter(Boolean).join(' ') || row.billing?.company || email || `Cliente ${row.id}`), email: email || null,
    email_hash: email ? crypto.createHash('sha256').update(email).digest('hex') : null,
    telefono: text(row.billing?.phone) || null, paese: text(row.billing?.country) || null };
}
export function wooProduct(row, parent = null) {
  return { external_id: String(row.id), parent_external_id: parent ? String(parent.id) : null, external_sku: text(row.sku), asin: null,
    nome: text(row.name || parent?.name || row.sku || row.id), marketplace: 'website', currency: null, price: money(row.price),
    stock: money(row.stock_quantity), status: text(row.status),
    assets: [...(row.images || (row.image ? [row.image] : parent?.images || [])).map((v) => ({ type: 'image', url: publicAsset(v.src), name: text(v.name) })), ...(row.downloads || []).map((v) => ({ type: 'document', url: publicAsset(v.file), name: text(v.name) }))].filter((v) => v.url) };
}
export function wooOrder(row, refunds = []) {
  const guest = !row.customer_id && row.billing?.email ? wooCustomer({ id: `guest:${crypto.createHash('sha256').update(row.billing.email.trim().toLowerCase()).digest('hex')}`, billing: row.billing }) : null;
  const taxRefund = refunds.reduce((n, r) => n + (r.line_items || []).reduce((t, l) => t + Math.abs(money(l.total_tax) || 0), 0), 0);
  const refunded = (row.refunds || []).reduce((n, r) => n + Math.abs(money(r.total) || 0), 0);
  const total = money(row.total), tax = money(row.total_tax);
  return { external_id: String(row.id), customer_external_id: row.customer_id ? String(row.customer_id) : guest?.external_id || null, customer: guest, marketplace: 'website', stato: text(row.status),
    ordered_at: row.date_created_gmt ? `${row.date_created_gmt.replace(/Z$/, '')}Z` : row.date_created,
    currency: row.currency, gross_revenue: total, discounts: money(row.discount_total), refunds: refunded, fees: null,
    net_revenue: total === null || tax === null ? null : rounded(total - tax - refunded + taxRefund),
    raw_summary: { provider: 'woocommerce', tax, financial_basis: 'total_excluding_tax_after_refunds' },
    lines: (row.line_items || []).map((l) => ({ external_line_id: String(l.id), external_sku: text(l.sku), quantity: money(l.quantity), unit_price: money(l.price), line_revenue: money(l.total), discount: money(l.subtotal) !== null && money(l.total) !== null ? rounded(Number(l.subtotal) - Number(l.total)) : null })) };
}
export function amazonOrder(row) {
  const total = money(row.proceeds?.grandTotal?.amount);
  const taxRows = (row.proceeds?.breakdowns || []).filter((b) => b.type === 'TAX');
  const tax = taxRows.length ? taxRows.reduce((s, b) => s + Number(b.subtotal?.amount || 0), 0) : null;
  return { external_id: text(row.orderId), marketplace: row.salesChannel?.marketplaceId, stato: text(row.fulfillment?.fulfillmentStatus || 'UNKNOWN'), ordered_at: row.createdTime,
    currency: row.proceeds?.grandTotal?.currencyCode || 'EUR', gross_revenue: total,
    net_revenue: total !== null && tax !== null ? rounded(total - tax) : null, discounts: null, refunds: null, fees: null,
    raw_summary: { provider: 'amazon_sp_api', last_updated: row.lastUpdatedTime, financial_basis: tax === null ? 'net_unavailable_without_tax_breakdown' : 'proceeds_excluding_tax_before_unavailable_refunds_and_fees' },
    lines: (row.orderItems || []).map((l) => ({ external_line_id: text(l.orderItemId), external_sku: text(l.product?.sellerSku), asin: l.product?.asin || null, quantity: money(l.quantityOrdered), unit_price: money(l.product?.price?.unitPrice?.amount), line_revenue: money(l.proceeds?.proceedsTotal?.amount) })) };
}
export function amazonProduct(row, marketplace) {
  const summary = (row.summaries || []).find((s) => s.marketplaceId === marketplace) || {};
  const offer = (row.offers || []).find((o) => o.marketplaceId === marketplace) || {};
  return { external_id: text(row.sku), external_sku: text(row.sku), marketplace, nome: text(summary.itemName || row.sku), asin: summary.asin || null,
    currency: offer.price?.currencyCode || null, price: money(offer.price?.amount), stock: row.fulfillmentAvailability?.length ? row.fulfillmentAvailability.reduce((n, f) => n + Number(f.quantity || 0), 0) : null, status: (summary.status || []).join(', '),
    assets: publicAsset(summary.mainImage?.link) ? [{ type: 'image', url: publicAsset(summary.mainImage.link), name: text(summary.itemName) }] : [] };
}

export function initialImportState(connection, now = new Date()) {
  const end = new Date(now.getTime() - 180000).toISOString();
  const start = new Date(now); start.setUTCFullYear(start.getUTCFullYear() - 2);
  return { version: 1, phase: connection.provider_code === 'mailchimp' ? 'audiences' : connection.provider_code === 'woocommerce' ? 'customers' : 'orders', page: 1, token: null, marketplaceIndex: 0,
    from: connection.import_state?.completed ? connection.import_state.to : start.toISOString(), to: end,
    counts: { customers: 0, products: 0, orders: 0 }, completed: false };
}

// Exactly one bounded page per call. The database commits the page and its cursor together.
export async function fetchCommercePage(connection, secrets, previous, { fetcher = safeFetch, now = new Date() } = {}) {
  const transport = fetcher;
  const deadline = Date.now() + 120000;
  fetcher = async (url, options) => {
    for (let attempt = 0; ; attempt++) {
      if (Date.now() > deadline) throw new Error('Pagina non completata entro il tempo disponibile. Il cursore è conservato.');
      const response = await transport(url, options);
      if (response.status !== 429 || attempt >= 3) return response;
      await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 2000 * 2 ** attempt)));
    }
  };
  const state = previous?.version === 1 && !previous.completed ? structuredClone(previous) : initialImportState(connection, now);
  const next = structuredClone(state);
  const configuration = connection.configurazione || {};
  let rows = [], kind = state.phase;
  if (connection.provider_code === 'mailchimp') {
    const dc = configuration.data_center || String(secrets.api_key || '').split('-').pop();
    if (!/^us\d+$/.test(dc)) throw new Error('Data center Mailchimp non valido.');
    const headers = { authorization: secrets.access_token ? `Bearer ${secrets.access_token}` : `Basic ${Buffer.from(`workspace:${secrets.api_key}`).toString('base64')}` };
    const root = `https://${dc}.api.mailchimp.com/3.0/`;
    const path = state.phase === 'audiences' ? 'lists' : `lists/${encodeURIComponent(state.audience)}/members`;
    const data = await request(`${root}${path}?count=20&offset=${(state.page - 1) * 20}`, { headers, timeoutMs: 20000 }, fetcher, 'Importazione Mailchimp');
    const list = state.phase === 'audiences' ? data.lists : data.members;
    if (!Array.isArray(list)) throw new Error('Risposta Mailchimp non valida: pagina non acquisita.');
    kind = 'customers';
    if (state.phase === 'audiences') next.audiences = [...(state.audiences || []), ...list.map((l) => text(l.id))];
    else rows = list.map((member) => {
      const c = wooCustomer({ id: member.id, email: member.email_address, first_name: member.merge_fields?.FNAME, last_name: member.merge_fields?.LNAME });
      const explicitDenied = member.marketing_permissions?.length && !member.marketing_permissions.some((p) => p.enabled);
      const status = member.status === 'unsubscribed' ? 'withdrawn' : member.status === 'cleaned' || explicitDenied ? 'denied' : member.status === 'subscribed' ? 'granted' : 'unknown';
      return { ...c, consent: { purpose: 'email_marketing', status, source: `mailchimp:${state.audience}`, captured_at: member.timestamp_opt || member.last_changed || null,
        withdrawn_at: status === 'withdrawn' ? member.last_changed || null : null, proof_reference: `mailchimp:${state.audience}:${member.id}`, provider_status: member.status } };
    });
    next.page++;
    if ((state.page - 1) * 20 + list.length >= Number(data.total_items) || list.length < 20) {
      next.page = 1;
      const audiences = next.audiences || [];
      next.audience = audiences.shift() || null; next.audiences = audiences;
      next.phase = 'members';
      next.completed = !next.audience;
    }
  } else if (connection.provider_code === 'woocommerce') {
    const base = String(configuration.site_url).replace(/\/$/, '') + '/wp-json/wc/v3/';
    const headers = { authorization: `Basic ${Buffer.from(`${secrets.consumer_key}:${secrets.consumer_secret}`).toString('base64')}` };
    const get = (path) => request(base + path, { headers, timeoutMs: 20000, maxBytes: 2000000 }, fetcher, 'Importazione WooCommerce');
    const path = state.phase === 'variations' ? `products/${state.parent.id}/variations` : state.phase;
    const pageSize = kind === 'orders' ? 5 : 20;
    const data = await get(`${path}?per_page=${pageSize}&page=${state.page}&orderby=id&order=asc`);
    if (!Array.isArray(data)) throw new Error('Risposta WooCommerce non valida: pagina non acquisita.');
    const pageHasMore = data.length === pageSize;
    if (kind === 'customers') rows = data.map(wooCustomer);
    if (kind === 'products' || kind === 'variations') { rows = data.map((r) => wooProduct(r, state.parent)); kind = 'products'; }
    if (kind === 'orders') {
      rows = [];
      for (const row of data) {
        const refunds = [];
        // Refund totals are included in orders; fetch itemized tax only for refunded orders.
        if (row.refunds?.length) {
          for (let page = 1; ; page++) {
            const batch = await get(`orders/${row.id}/refunds?per_page=100&page=${page}`);
            if (!Array.isArray(batch)) throw new Error('Dettaglio rimborsi WooCommerce non valido.');
            refunds.push(...batch);
            if (batch.length < 100) break;
          }
          if (row.refunds.some((ref) => !refunds.some((detail) => String(detail.id) === String(ref.id)))) throw new Error('Dettaglio rimborsi incompleto: pagina non acquisita.');
        }
        rows.push(wooOrder(row, refunds));
      }
    }
    next.page++;
    if (state.phase === 'products') {
      next.variationQueue = [...(state.variationQueue || []), ...data.filter((r) => r.type === 'variable').map((r) => ({ id: r.id, name: r.name, images: r.images }))];
    }
    if (!pageHasMore) {
      next.page = 1;
      if (state.phase === 'customers') next.phase = 'products';
      else if (state.phase === 'products' || state.phase === 'variations') {
        const queue = next.variationQueue || [];
        next.parent = queue.shift() || null; next.variationQueue = queue;
        next.phase = next.parent ? 'variations' : 'orders';
      } else next.completed = true;
    }
  } else if (connection.provider_code === 'amazon_sp_api') {
    const markets = connection.marketplace_ids?.length ? connection.marketplace_ids : configuration.marketplace_ids;
    if (!Array.isArray(markets) || !markets.length) throw new Error('Selezionare il marketplace Amazon da importare.');
    const root = { eu: 'https://sellingpartnerapi-eu.amazon.com', na: 'https://sellingpartnerapi-na.amazon.com', fe: 'https://sellingpartnerapi-fe.amazon.com' }[configuration.region || 'eu'];
    if (!root) throw new Error('Regione Amazon non valida.');
    const token = await refreshAccessToken(connection, secrets, fetcher);
    const headers = { 'x-amz-access-token': token.access_token, 'user-agent': 'Workspace/1.0 (Language=JavaScript; Platform=Node.js)', 'x-amz-date': now.toISOString().replace(/[:-]|\.\d{3}/g, ''), accept: 'application/json' };
    const query = new URLSearchParams(); let path;
    if (kind === 'orders') {
      query.set('marketplaceIds', markets.join(',')); query.set('lastUpdatedAfter', state.from); query.set('lastUpdatedBefore', state.to);
      query.set('maxResultsPerPage', '20'); query.set('includedData', 'PROCEEDS,FULFILLMENT');
      if (state.token) query.set('paginationToken', state.token);
      path = '/orders/2026-01-01/orders';
    } else {
      query.set('marketplaceIds', markets[state.marketplaceIndex]); query.set('pageSize', '20'); query.set('includedData', 'summaries,offers,fulfillmentAvailability');
      if (state.token) query.set('pageToken', state.token);
      const seller = configuration.seller_id || connection.external_account_id;
      if (!seller) throw new Error('Seller ID Amazon mancante.');
      path = `/listings/2021-08-01/items/${encodeURIComponent(seller)}`;
    }
    const data = await request(`${root}${path}?${query}`, { headers, timeoutMs: 20000, maxBytes: 2000000 }, fetcher, `Importazione Amazon ${kind}`);
    if (!Array.isArray(kind === 'orders' ? data.orders : data.items)) throw new Error('Risposta Amazon non valida: pagina non acquisita.');
    rows = kind === 'orders' ? data.orders.filter((r) => markets.includes(r.salesChannel?.marketplaceId)).map(amazonOrder) : data.items.map((r) => amazonProduct(r, markets[state.marketplaceIndex]));
    next.token = data.pagination?.nextToken || null;
    if (!next.token) {
      if (kind === 'orders') next.phase = 'products';
      else if (state.marketplaceIndex + 1 < markets.length) next.marketplaceIndex++;
      else next.completed = true;
    }
  } else throw new Error('Importazione dati non disponibile per questo provider.');
  next.counts[kind] += rows.length;
  next.updatedAt = now.toISOString();
  // Do not retain an arbitrarily large product queue in the safe summary returned to the client.
  return { kind, rows, next, hasMore: !next.completed };
}
