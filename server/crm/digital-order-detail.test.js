import test from 'node:test';
import assert from 'node:assert/strict';
import { wooOrderDetail, loadDigitalOrderDetail } from './digital-order-detail.js';
import { salesDays } from '../../src/modules/crm/digitalSalesDayModel.js';

test('Daily expansion totals match eligible orders and retain excluded orders for inspection', () => {
  const orders = [
    { id: 'a', ordered_at: '2026-10-19T09:00:00Z', currency: 'EUR', net_revenue: '131.23', stato: 'completed' },
    { id: 'b', ordered_at: '2026-10-19T12:00:00Z', currency: 'EUR', net_revenue: '33.20', stato: 'completed' },
    { id: 'c', ordered_at: '2026-10-19T13:00:00Z', currency: 'EUR', net_revenue: '41.80', stato: 'completed' },
    { id: 'd', ordered_at: '2026-10-19T14:00:00Z', currency: 'EUR', net_revenue: '143.20', stato: 'completed' },
    { id: 'failed', ordered_at: '2026-10-19T15:00:00Z', currency: 'EUR', net_revenue: '72.21', stato: 'failed' },
  ];
  const [day] = salesDays(orders);
  assert.equal(day.count, 4); assert.equal(day.amount, 349.43); assert.equal(day.orders.length, 5);
  assert.equal(orders[0].id, 'a');
});

test('Days use UTC consistently, keep currencies separate and do not turn missing amounts into zero', () => {
  const days = salesDays([
    { id: '1', ordered_at: '2026-10-20T00:30:00+02:00', currency: 'EUR', net_revenue: null, stato: 'SHIPPED' },
    { id: '2', ordered_at: '2026-10-19T10:00:00Z', currency: 'USD', net_revenue: 12, stato: 'SHIPPED' },
  ]);
  assert.equal(days.length, 2); assert.equal(days[0].date, '2026-10-19');
  assert.equal(days.find((d) => d.currency === 'EUR').amount, null);
  assert.equal(days.find((d) => d.currency === 'USD').amount, 12);
});

const order = { id: 'id', connection_id: 'c', external_id: '13729', ordered_at: '2026-10-19', currency: 'EUR', net_revenue: 100, gross_revenue: 122 };
const dependencies = (overrides = {}) => ({ visibleOrder: async () => order,
  connection: async () => ({ id: 'c', tipo: 'ecommerce', provider_code: 'woocommerce', configurazione: { site_url: 'https://store.example' } }),
  authorizeScreen: async (screen) => assert.equal(screen, 'crm.online.ecommerce'),
  cachedLines: async () => [{ id: 'cached', name: 'Sale' }], secrets: async () => ({ consumer_key: 'private', consumer_secret: 'private' }), ...overrides });

test('Order permission failures cannot read provider secrets or make provider calls', async () => {
  let accessed = false;
  await assert.rejects(loadDigitalOrderDetail('id', dependencies({ visibleOrder: async () => null, secrets: async () => { accessed = true; } })), (e) => e.status === 404);
  await assert.rejects(loadDigitalOrderDetail('id', dependencies({ authorizeScreen: async () => { throw new Error('forbidden'); }, secrets: async () => { accessed = true; } })), /forbidden/);
  assert.equal(accessed, false);
});

test('Woo detail returns historical product names, guest billing name, quantities and discounted amounts', async () => {
  const result = await loadDigitalOrderDetail('id', dependencies({ fetcher: async (url, options) => {
    assert.equal(url, 'https://store.example/wp-json/wc/v3/orders/13729'); assert.equal(options.method, undefined);
    return { ok: true, status: 200, data: { id: 13729, billing: { first_name: 'Nome', last_name: 'Cliente' }, line_items: [{ id: 9, name: 'Prodotto acquistato', sku: '', quantity: 2, price: '5', subtotal: '12', total: '10' }] } };
  } }));
  assert.equal(result.order.customerName, 'Cliente Nome'); assert.equal(result.order.lines[0].name, 'Prodotto acquistato');
  assert.equal(result.order.lines[0].discount, 2); assert.equal(result.order.lines[0].quantity, 2);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('Provider failure or wrong order ID retains imported data with a visible warning', async () => {
  for (const data of [{ id: 'another-order', line_items: [] }, null]) {
    const result = await loadDigitalOrderDetail('id', dependencies({ fetcher: async () => { if (!data) throw new Error('offline'); return { ok: true, data }; } }));
    assert.equal(result.order.lines[0].name, 'Sale'); assert.ok(result.order.warning); assert.equal(result.order.amount, 100);
  }
});

test('Amazon detail requests BUYER after authorization and resolves product titles when name is absent', async () => {
  const urls = [];
  const result = await loadDigitalOrderDetail('id', dependencies({
    connection: async () => ({ id: 'c', tipo: 'amazon_seller', provider_code: 'amazon_sp_api', configurazione: { region: 'eu', lwa_client_id: 'client' } }),
    authorizeScreen: async (screen) => assert.equal(screen, 'crm.online.amazon'),
    secrets: async () => ({ lwa_refresh_token: 'private', lwa_client_secret: 'private' }),
    fetcher: async (url) => { urls.push(url); return url.includes('/auth/') ? { ok: true, data: { access_token: 'private' } } : { ok: true, data: { order: { orderId: '13729', orderItems: [{ orderItemId: '1', quantityOrdered: 2, product: { title: 'Nome Amazon', sellerSku: 'SKU' } }] } } }; },
  }));
  assert.equal(result.order.lines[0].name, 'Nome Amazon'); assert.match(result.order.customerUnavailable, /non fornito da Amazon/);
  assert.ok(urls.some((u) => /BUYER/.test(u))); assert.ok(!urls.some(u => /RECIPIENT/.test(u))); assert.equal(result.order.warning, null);
});

test('Woo order detail includes shipping as a separate net row without adding it twice to totals', () => {
  const detail = wooOrderDetail({ billing: { first_name: 'Daniela', last_name: 'Mottola' }, line_items: [{ id: 1, name: 'Sale', quantity: 1, price: '100', subtotal: '100', total: '100' }], shipping_lines: [{ id: 2, method_title: 'Corriere', total: '15.00' }] });
  assert.equal(detail.customerName, 'Mottola Daniela'); assert.equal(detail.lines.length, 2);
  assert.equal(detail.lines[1].type, 'shipping'); assert.equal(Number(detail.lines[1].amount), 15);
  assert.equal(wooOrderDetail({ line_items: [], shipping_total: '0' }).lines[0].amount, 0);
});

test('fresh Amazon financial values replace stale cached detail without inventing tax for pending products', async () => {
  const result = await loadDigitalOrderDetail('id',dependencies({
    connection:async()=>({id:'c',tipo:'amazon_seller',provider_code:'amazon_sp_api',configurazione:{region:'eu'}}),
    authorizeScreen:async()=>{},secrets:async()=>({}),
    fetcher:async url=>url.includes('/auth/')?{ok:true,data:{access_token:'private'}}:{ok:true,data:{order:{orderId:'13729',proceeds:{grandTotal:{amount:'24.4',currencyCode:'EUR'},breakdowns:[{type:'TAX',subtotal:{amount:'4.4'}}]},fulfillment:{fulfillmentStatus:'SHIPPED'},orderItems:[{orderItemId:'1',quantityOrdered:2,product:{title:'Crema',price:{unitPrice:{amount:'12.2'}}}}]}}},
  }));
  assert.equal(result.order.amount,20); assert.equal(result.order.total,24.4); assert.equal(result.order.status,'SHIPPED');
});
