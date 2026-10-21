export const MEXAL_OC_META_KEY = '_sdi_mexal_oc_v1';

export function formatMexalOrderReference(value) {
  const match = typeof value === 'string' && /^OC[+/](\d{1,3})[+/]([1-9]\d{0,9})$/.exec(value);
  return match ? `OC/${Number(match[1])}/${Number(match[2])}` : null;
}

export function wooMexalOrderReference(order) {
  const entries = (order?.meta_data || []).filter(entry => entry.key === MEXAL_OC_META_KEY);
  if (entries.length !== 1) return null;
  const value = entries[0].value;
  if (!value || value.version !== 1 || value.verified !== true || String(value.source_order_id) !== String(order.id)) return null;
  return formatMexalOrderReference(value.reference);
}
