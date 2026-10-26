import test from 'node:test';
import assert from 'node:assert/strict';
import { wooMexalOrderReference, wooMexalSyncStatus } from '../../shared/wooMexalReference.js';
import { wooOrder } from './commerce-import.js';
import { loadDigitalOrderDetail } from './digital-order-detail.js';

const meta = { key: '_sdi_mexal_oc_v1', value: { version: 1, verified: true, source_order_id: '13730', reference: 'OC+1+17359' } };
const source = { id: 13730, meta_data: [meta], line_items: [] };

test('sync status is bound to its order and exposes only classified reasons',async()=>{
 const value={version:1,source_order_id:'13730',status:'blocked',error_code:'mexal_6001_cod_alternativo',checked_at:'2026-10-26T08:00:00Z',catalog_at:'2026-10-26T07:59:00Z',message:'private customer data'};
 const order={...source,meta_data:[meta,{key:'_sdi_mexal_sync_v1',value}]};
 assert.match(wooMexalSyncStatus(order).message,/cod_alternativo/);
 assert.equal(wooOrder(order).raw_summary.mexal_sync.status,'blocked');
 assert.ok(!JSON.stringify(wooMexalSyncStatus(order)).includes('private'));
 assert.equal(wooMexalSyncStatus({...order,id:13738}),null);
 assert.equal(wooMexalSyncStatus({...order,meta_data:[order.meta_data[1],order.meta_data[1]]}),null);
 const result=await loadDigitalOrderDetail('uuid',deps({fetcher:async()=>({ok:true,data:order})}));
 assert.equal(result.order.mexalSync.status,'blocked');
});
test('only a verified OC belonging to the same Woo order is imported', () => {
  assert.equal(wooMexalOrderReference(source), 'OC/1/17359');
  assert.equal(wooOrder(source).raw_summary.mexal_oc, 'OC/1/17359');
  assert.equal(wooMexalOrderReference({ ...source, id: 13731 }), null);
  assert.equal(wooMexalOrderReference({ ...source, meta_data: [meta, meta] }), null);
  for (const value of [{ ...meta.value, verified: false }, { ...meta.value, reference: 'OCX+1+17359' }, { ...meta.value, reference: '<script>alert(1)</script>' }]) {
    assert.equal(wooMexalOrderReference({ ...source, meta_data: [{ ...meta, value }] }), null);
  }
});
const cached = { id: 'uuid', external_id: '13730', connection_id: 'c', raw_summary: { tax: 1, mexal_oc: 'OC/1/17358' } };
const deps = overrides => ({ visibleOrder: async () => cached, connection: async () => ({ id: 'c', tipo: 'ecommerce', provider_code: 'woocommerce', configurazione: { site_url: 'https://store.example' } }), authorizeScreen: async () => {}, cachedLines: async () => [], secrets: async () => ({}), ...overrides });
test('live OC is returned and cached only after order and screen authorization', async () => {
  let saved = false;
  const result = await loadDigitalOrderDetail('uuid', deps({ fetcher: async () => ({ ok: true, data: source }), saveMexalReference: async (order, ref) => { assert.equal(order, cached); assert.equal(ref, 'OC/1/17359'); saved = true; } }));
  assert.equal(result.order.mexalOc, 'OC/1/17359'); assert.equal(saved, true);
  saved = false;
  await assert.rejects(loadDigitalOrderDetail('uuid', deps({ authorizeScreen: async () => { throw Error('denied'); }, saveMexalReference: async () => { saved = true; } })), /denied/);
  assert.equal(saved, false);
});
test('provider outage keeps the cached OC and cache outage does not discard a live OC', async () => {
  const offline = await loadDigitalOrderDetail('uuid', deps({ fetcher: async () => { throw Error('offline'); } }));
  assert.equal(offline.order.mexalOc, 'OC/1/17358'); assert.ok(offline.order.warning);
  const live = await loadDigitalOrderDetail('uuid', deps({ fetcher: async () => ({ ok: true, data: source }), saveMexalReference: async () => { throw Error('cache offline'); } }));
  assert.equal(live.order.mexalOc, 'OC/1/17359'); assert.equal(live.order.warning, null);
});
