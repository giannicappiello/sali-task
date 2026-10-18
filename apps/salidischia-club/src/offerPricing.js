// Pure calculator shared by local previews and their regression tests.
export function combinedPrice(product, offers, { items = null, quoteTarget = null, inCategory = () => false } = {}) {
  const list = product.list_price;
  let price = list, mode = null, offerId = null, applied = [];
  const required = o => o.requirements || [];
  const matches = o => o.kind === 'discount'
    ? o.scope === 'all' || o.product_id === product.id || (o.scope === 'category' && inCategory(product, Number(o.category_id)))
    : o.gift_product_id === product.id || required(o).some(r => r.product_id === product.id);
  const qualifies = o => items && required(o).every(r => items.filter(i => i.product_id === r.product_id).reduce((n, i) => n + i.quantity, 0) >= r.quantity);
  const round = n => n == null ? null : Math.round((n + Number.EPSILON) * 100) / 100;
  const percent = (n, o) => n == null ? null : round(n * (1 - o.discount_percent / 100));
  const policy = o => o.combination_mode || 'best';
  const relevant = offers.filter(matches).sort((a, b) => (a.published_at || '').localeCompare(b.published_at || '') || a.id.localeCompare(b.id));
  for (const o of relevant.filter(o => policy(o) === 'best' && o.kind === 'discount')) {
    const candidate = o.discount_mode === 'price' ? Number(o.sale_price) : percent(list, o);
    if (candidate != null && (offerId === null || candidate < price)) { price = candidate;mode = o.discount_mode;offerId = o.id;applied = [o.id]; }
  }
  for (const o of relevant.filter(o => (o.kind === 'discount' || qualifies(o)) && (policy(o) !== 'best' || (o.kind !== 'discount' && o.id === quoteTarget)))) {
    if (policy(o) === 'replace') { price = list;applied = [];mode = null;offerId = null; }
    if (o.kind === 'discount' && o.discount_mode === 'price') {
      price = policy(o) === 'stack' && price != null ? Math.min(price, Number(o.sale_price)) : Number(o.sale_price);mode = 'price';offerId = o.id;
    } else if (o.kind === 'discount' || (o.kind === 'bundle_discount' && required(o).some(r => r.product_id === product.id))) {
      price = percent(price, o);mode = 'percent';offerId = o.id;
    }
    applied.push(o.id);
  }
  return { price, list_price: list, price_mode: mode, offer_id: offerId, applied_offer_ids: applied };
}
