import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { combinedPrice } from '../apps/salidischia-club/src/offerPricing.js';
import { createPreviewApi } from '../apps/salidischia-club/src/previewApi.js';
process.env.CLUB_OFFER_FIXTURE_ONLY = '1';
const { createOfferFixture, id } = await import('./club-store-offers.test.mjs');

test('Multiple published offers: sequential stacking, scoped replacement, conditional prices and gifts', async () => {
  const db = await createOfferFixture();
  const rpc = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
  const actor = async n => db.exec(`reset role;set request.jwt.claim.sub='${n ? id(n) : ''}';set test.auth='${n ? id(n) : ''}';set role ${n ? 'authenticated' : 'anon'};`);
  const entries = async () => (await rpc('select club_my_store_offers() value')).rows;
  const save = async payload => rpc('select club_save_store_offer($1) value', [payload]);
  const publish = async offer => { const row = (await entries()).find(o => o.id === offer);await rpc('select club_publish_store_offer($1,$2) value', [offer, row.updated_at]); };
  const archive = async offer => { const row = (await entries()).find(o => o.id === offer);await rpc('select club_publish_store_offer($1,$2,true) value', [offer, row.updated_at]); };
  const price = async n => (await rpc('select club_catalog_product($1) value', [id(n)])).pricing.price;
  const discount = (title, mode, percent, extra = {}) => ({ title, kind: 'discount', scope: 'all', discount_percent: percent, combination_mode: mode, ...extra });
  try {
    await actor(4);
    const first = await save(discount('Base 20', 'replace', 20));await publish(first);
    const second = await save(discount('Extra 10', 'stack', 10));await publish(second);
    assert.equal((await entries()).filter(o => o.status === 'published').length, 2);
    assert.equal(await price(50), 72);assert.equal(await price(51), 36);
    const replace = await save(discount('Only cream 5', 'replace', 5, { scope: 'product', product_id: id(50) }));await publish(replace);
    assert.equal(await price(50), 95);assert.equal(await price(51), 36);
    assert.equal((await entries()).filter(o => o.status === 'published').length, 3);
    await archive(replace);assert.equal(await price(50), 72);
    const fixed = await save({ ...discount('Fixed 60', 'replace', null, { scope: 'product', product_id: id(50) }), discount_mode: 'price', sale_price: 60 });await publish(fixed);
    const extra = await save(discount('Extra cream 10', 'stack', 10, { scope: 'product', product_id: id(50) }));await publish(extra);assert.equal(await price(50), 54);
    const higher = await save({ ...discount('Stack fixed 90', 'stack', null, { scope: 'product', product_id: id(50) }), discount_mode: 'price', sale_price: 90 });await publish(higher);assert.equal(await price(50), 54);
    const requirements = [{ product_id: id(50), quantity: 2 }, { product_id: id(51), quantity: 1 }];
    const gift = await save({ title: 'Gift', kind: 'bundle_gift', requirements, gift_product_id: id(52), combination_mode: 'stack' });await publish(gift);
    const bundle = await save({ title: 'Extra bundle', kind: 'bundle_discount', discount_percent: 10, requirements, combination_mode: 'stack' });await publish(bundle);
    const items = [...requirements, { product_id: id(52), quantity: 1 }];
    let quote = await rpc('select club_quote_store_offer($1,$2) value', [bundle, items]);
    assert.equal(quote.lines.find(p => p.product_id === id(50)).price, 48.6);
    assert.equal(quote.lines.find(p => p.product_id === id(51)).price, 32.4);
    assert.equal(quote.lines.find(p => p.product_id === id(52)).price, 14.4);
    assert.equal(quote.gifts[0].offer_id, gift);
    // Duplicate basket lines are aggregated before checking minimum quantities.
    quote = await rpc('select club_quote_store_offer($1,$2) value', [bundle, [{ product_id: id(50), quantity: 1 }, { product_id: id(50), quantity: 1 }, requirements[1]]]);
    assert.equal(quote.qualifies, true);
    quote = await rpc('select club_quote_store_offer($1,$2) value', [bundle, [{ product_id: id(50), quantity: 1 }, requirements[1]]]);
    assert.equal(quote.qualifies, false);assert.equal(quote.gifts.length, 0);assert.equal(quote.lines.find(p => p.product_id === id(50)).price, 54);
    const reset = await save({ title: 'Replace bundle 10', kind: 'bundle_discount', requirements, discount_percent: 10, combination_mode: 'replace' });await publish(reset);
    quote = await rpc('select club_quote_store_offer($1,$2) value', [reset, items]);
    assert.equal(quote.lines.find(p => p.product_id === id(50)).price, 90);assert.equal(quote.lines.find(p => p.product_id === id(51)).price, 45);assert.equal(quote.gifts.length, 0);
    assert.equal(await price(50), 54); // Conditions cannot affect the catalog without a basket.
    await archive(reset);
    const future = await save(discount('Future', 'replace', 99, { starts_at: '2099-01-01' }));await publish(future);assert.equal(await price(50), 54);
    await assert.rejects(save(discount('Invalid', 'invalid', 10)), /check constraint/);
    const own = await entries();assert.equal(own.find(o => o.id === first).combination_mode, 'replace');
    // Browser preview calculator and SQL must agree for the same published offers.
    const active = own.filter(o => o.status === 'published' && new Date(o.starts_at) <= new Date());
    quote = await rpc('select club_quote_store_offer($1,$2) value', [bundle, items]);
    for (const line of quote.lines) {
      const js = combinedPrice({ id: line.product_id, list_price: line.list_price }, active, { items, quoteTarget: bundle });
      assert.equal(js.price, line.price);assert.deepEqual(js.applied_offer_ids, line.applied_offer_ids);
    }
    await actor(5);assert.equal(await price(50), 100);await assert.rejects(rpc('select club_store_offer_editor($1) value', [first]), /non disponibile/);
    await actor(null);assert.equal(await price(50), 100);
  } finally { await db.close(); }
});

test('Preview uses real catalog names, IDs, categories and prices; writes stay local', async () => {
  const calls = [], rows = Array.from({ length: 25 }, (_, i) => ({ id: `real-${i}`, name: `Prodotto reale ${i}`, code: `IT${i}`, category_ids: [20], pricing: { list_price: 100 }, description: 'Descrizione reale', image_url: '/real.jpg' }));
  const a = createPreviewApi({ readCatalog: async (name, args) => {
    calls.push(name);
    if (name === 'club_catalog_categories') return [{ id: 10, name: 'Viso' }, { id: 20, parent_id: 10, name: 'Sieri' }];
    if (name === 'club_catalog_product') return rows.find(row => row.id === args.target_id);
    assert.equal(name, 'club_catalog_products');const filtered = rows.filter(row => !args.search_text || row.code === args.search_text);return { total: filtered.length, rows: filtered.slice(args.page_offset || 0, (args.page_offset || 0) + 24) };
  } });
  assert.equal((await a.rpc('club_catalog_products')).total, 25);
  assert.equal((await a.rpc('club_catalog_products', { category_id: 10 })).total, 25);
  assert.equal((await a.rpc('club_catalog_products', { search_text: 'IT24' })).rows[0].id, 'real-24');
  assert.equal((await a.rpc('club_catalog_product', { target_id: 'real-24' })).description, 'Descrizione reale');
  assert.equal((await a.rpc('club_store_products', { search_text: 'IT24' }))[0].name, 'Prodotto reale 24');
  const create = async (combination_mode, discount_percent) => {
    const offer = await a.rpc('club_save_store_offer', { payload: { title: 'Offerta', kind: 'discount', scope: 'all', discount_mode: 'percent', discount_percent, combination_mode, requirements: [] } });
    await a.rpc('club_publish_store_offer', { target_id: offer });return offer;
  };
  await create('replace', 20);await create('stack', 10);
  assert.equal((await a.rpc('club_catalog_product', { target_id: 'real-24' })).pricing.price, 72);
  await create('replace', 5);assert.equal((await a.rpc('club_catalog_product', { target_id: 'real-24' })).pricing.price, 95);
  assert.equal((await a.rpc('club_my_store_offers')).rows.filter(o => o.status === 'published').length, 3);
  const result = await a.rpc('club_record_purchase', { member_code: 'CLUB-DEMO-001', items: [{ product_id: 'real-24', quantity: 1, amount: 95 }], idempotency_key: 'real-product-local-purchase' });
  assert.equal(result.items[0].name, 'Prodotto reale 24');assert.equal(result.cashback, 4.75);
  assert.ok(calls.every(name => ['club_catalog_categories','club_catalog_products','club_catalog_product'].includes(name)));assert.equal(calls.filter(name => name === 'club_catalog_categories').length, 1);
});
