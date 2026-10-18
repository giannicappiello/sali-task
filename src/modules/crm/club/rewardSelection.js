export const isClubRewardProduct = product => /^IT/i.test(String(product.codice_mexal || '').trim()) && product.attivo_mexal !== false && product.mostra_in_app !== false;
export function rewardSelectionPayload(form) {
  const scope = form.product_scope || 'products';
  const product_ids = form.kind === 'products' && scope === 'products' ? [...new Set(form.product_ids || [])] : [];
  const category_ids = form.kind === 'products' && scope === 'categories' ? [...new Set(form.category_ids || [])] : [];
  return { product_scope: scope, product_ids, category_ids, product_id: product_ids.length === 1 ? product_ids[0] : null };
}

