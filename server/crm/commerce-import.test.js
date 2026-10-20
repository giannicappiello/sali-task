import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCommercePage, initialImportState, wooOrder, wooCustomer, wooProduct, amazonOrder, publicAsset } from './commerce-import.js';

const now = new Date('2026-10-20T10:00:00Z');
const amazon = { provider_code: 'amazon_sp_api', marketplace_ids: ['APJ6JRA9NG5V4'], configurazione: { region: 'eu', seller_id: 'seller', lwa_client_id: 'client' } };
const woo = { provider_code: 'woocommerce', configurazione: { site_url: 'https://store.example' } };
const ok = (data) => ({ ok: true, status: 200, data });

test('Amazon imports Italian orders with the current API and resumes the same fixed window', async () => {
  const calls = [];
  const page = await fetchCommercePage(amazon, {}, {}, { now, fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/auth/')) return ok({ access_token: 'private-token' });
    return ok({ orders: [{ orderId: 'IT-1', createdTime: '2026-10-01T00:00:00Z', salesChannel: { marketplaceId: 'APJ6JRA9NG5V4' }, orderItems: [] }, { orderId: 'USA-1', salesChannel: { marketplaceId: 'USA' } }], pagination: { nextToken: 'page-2' } });
  } });
  assert.equal(page.rows.length, 1); assert.equal(page.rows[0].external_id, 'IT-1');
  const url = new URL(calls[1].url);
  assert.equal(url.origin, 'https://sellingpartnerapi-eu.amazon.com');
  assert.equal(url.pathname, '/orders/2026-01-01/orders');
  assert.equal(url.searchParams.get('marketplaceIds'), 'APJ6JRA9NG5V4');
  assert.equal(url.searchParams.get('maxResultsPerPage'), '100');
  assert.ok(!url.searchParams.get('includedData').includes('BUYER'));
  assert.equal(page.next.token, 'page-2'); assert.equal(page.next.completed, false);
  await fetchCommercePage(amazon, {}, page.next, { now: new Date('2026-10-20T11:00:00Z'), fetcher: async (url) => {
    if (url.includes('/auth/')) return ok({ access_token: 'private-token' });
    const q = new URL(url).searchParams;
    assert.equal(q.get('paginationToken'), 'page-2'); assert.equal(q.get('lastUpdatedBefore'), page.next.to);
    return ok({ orders: [] });
  } });
  assert.ok(!JSON.stringify(page).includes('private-token'));
});

test('Amazon offers use configured seller and marketplace, then complete', async () => {
  const state = { ...initialImportState(amazon, now), phase: 'products' };
  const result = await fetchCommercePage(amazon, {}, state, { now, fetcher: async (url) => {
    if (url.includes('/auth/')) return ok({ access_token: 'secret' });
    const u = new URL(url); assert.equal(u.pathname, '/listings/2021-08-01/items/seller');
    assert.equal(u.searchParams.get('marketplaceIds'), 'APJ6JRA9NG5V4');
    return ok({ items: [{ sku: 'IT001', summaries: [{ marketplaceId: 'APJ6JRA9NG5V4', asin: 'ASIN', itemName: 'Sale', mainImage: { link: 'https://images.example/sale.jpg' } }], offers: [{ marketplaceId: 'APJ6JRA9NG5V4', price: { amount: '12.5', currencyCode: 'EUR' } }] }] });
  } });
  assert.equal(result.rows[0].price, 12.5); assert.equal(result.rows[0].assets.length, 1);
  assert.equal(result.hasMore, false); assert.equal(result.next.completed, true);
});

test('Provider denial preserves input cursor and hides credentials', async () => {
  const state = initialImportState(amazon, now), before = JSON.stringify(state);
  await assert.rejects(fetchCommercePage(amazon, {}, state, { now, fetcher: async (url) => url.includes('/auth/') ? ok({ access_token: 'private-token' }) : { ok: false, status: 403, data: { errors: [{ code: 'Unauthorized', message: 'private-token denied' }] } } }), (error) => {
    assert.equal(error.code, 'provider_403'); assert.match(error.message, /Importazione Amazon orders/); assert.ok(!error.message.includes('private-token')); return true;
  });
  assert.equal(JSON.stringify(state), before);
});

test('Malformed provider payload cannot advance cursor', async () => {
  await assert.rejects(fetchCommercePage(woo, {}, initialImportState(woo, now), { fetcher: async () => ok({ unexpected: [] }) }), /non valida/);
});

test('WooCommerce paginates, imports variations and inherits parent images', async () => {
  const state = { ...initialImportState(woo, now), phase: 'products' };
  const p = await fetchCommercePage(woo, {}, state, { now, fetcher: async () => ok([{ id: 10, name: 'Sale', type: 'variable', images: [{ src: 'https://images.example/a.jpg' }] }]) });
  assert.equal(p.next.phase, 'variations'); assert.equal(p.next.parent.id, 10);
  const v = await fetchCommercePage(woo, {}, p.next, { now, fetcher: async (url) => {
    assert.match(url, /products\/10\/variations/); return ok([{ id: 11, sku: 'IT011', price: '5.50' }]);
  } });
  assert.equal(v.rows[0].parent_external_id, '10'); assert.equal(v.rows[0].assets.length, 1);
  assert.equal(v.next.phase, 'orders'); assert.equal(v.next.counts.products, 2);
});

test('Woo refunds subtract refunded revenue and restore the refunded tax component', () => {
  const order = wooOrder({ id: 5, currency: 'EUR', total: '122', total_tax: '22', discount_total: '10', date_created_gmt: '2026-01-01T00:00:00', refunds: [{ total: '-61' }], line_items: [{ id: 1, quantity: 2, subtotal: '110', total: '100', price: '50' }] }, [{ line_items: [{ total_tax: '-11' }] }]);
  assert.equal(order.net_revenue, 50); assert.equal(order.refunds, 61); assert.equal(order.lines[0].discount, 10); assert.equal(order.fees, null);
  assert.equal(order.ordered_at, '2026-01-01T00:00:00Z');
});

test('Amazon financial omissions stay unknown, not zero or invented net revenue', () => {
  const base = { orderId: '1', salesChannel: {}, proceeds: { grandTotal: { amount: '122', currencyCode: 'EUR' } } };
  assert.equal(amazonOrder(base).net_revenue, null); assert.equal(amazonOrder(base).refunds, null);
  base.proceeds.breakdowns = [{ type: 'TAX', subtotal: { amount: '22' } }];
  assert.equal(amazonOrder(base).net_revenue, 100);
});

test('Customer import never invents newsletter consent and omits raw private metadata', () => {
  const c = wooCustomer({ id: 1, email: ' USER@Example.com ', meta_data: [{ secret: 'private' }] });
  assert.equal(c.email, 'user@example.com'); assert.equal(c.email_hash.length, 64);
  assert.equal(c.consensi, undefined); assert.equal(c.meta_data, undefined);
});

test('Assets exclude insecure, credentialed and signed URLs', () => {
  for (const url of ['http://example.com/a', 'https://user:pass@example.com/a', 'https://example.com/a?token=secret', 'javascript:alert(1)']) assert.equal(publicAsset(url), null);
  assert.equal(wooProduct({ id: 1, downloads: [{ file: 'https://example.com/a.pdf', name: 'Scheda' }] }).assets[0].type, 'document');
});

test('Completed Amazon import starts its next update window at the previous upper bound', () => {
  const state = initialImportState({ ...amazon, import_state: { completed: true, to: '2026-10-01T00:00:00Z' } }, now);
  assert.equal(state.from, '2026-10-01T00:00:00Z');
});

test('Mailchimp imports audiences, members and explicit consent changes without subscribing anyone', async () => {
  const connection = { provider_code: 'mailchimp', configurazione: { data_center: 'us5' } };
  const a = await fetchCommercePage(connection, { api_key: 'private-us5' }, {}, { now, fetcher: async (url, options) => {
    assert.match(url, /us5\.api\.mailchimp\.com\/3.0\/lists\?/); assert.equal(options.method, undefined);
    return ok({ lists: [{ id: 'audience' }], total_items: 1 });
  } });
  assert.equal(a.next.phase, 'members'); assert.equal(a.hasMore, true);
  const b = await fetchCommercePage(connection, { api_key: 'private-us5' }, a.next, { now, fetcher: async (url) => {
    assert.match(url, /lists\/audience\/members/);
    return ok({ total_items: 3, members: [
      { id: 'a', email_address: 'a@example.com', status: 'subscribed', timestamp_opt: '2026-01-01T00:00:00Z' },
      { id: 'b', email_address: 'b@example.com', status: 'unsubscribed', last_changed: '2026-01-02T00:00:00Z' },
      { id: 'c', email_address: 'c@example.com', status: 'pending' },
    ] });
  } });
  assert.deepEqual(b.rows.map((r) => r.consent.status), ['granted', 'withdrawn', 'unknown']);
  assert.equal(b.rows[1].consent.withdrawn_at, '2026-01-02T00:00:00Z'); assert.equal(b.hasMore, false);
  assert.ok(!JSON.stringify(b).includes('private-us5'));
});
