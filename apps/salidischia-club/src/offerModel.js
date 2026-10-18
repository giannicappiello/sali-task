export const offerKinds = { discount: 'Sconto', bundle_gift: 'Acquisto con omaggio', bundle_discount: 'Sconto aggiuntivo' };
export function offerScope(offer) {
  return offer.scope === 'category' ? `Categoria: ${offer.category_name}` : offer.scope === 'product' ? offer.product_name : 'Tutti i prodotti';
}
export function offerConditions(offer) {
  const required = offer.requirements?.map(row => `${row.quantity} × ${row.name}`).join(' + ');
  const policy = offer.combination_mode === 'stack' ? ' Cumulabile con le offerte precedenti.' : offer.combination_mode === 'replace' ? ' Sostituisce le offerte precedenti sui prodotti coinvolti.' : '';
  return (offer.kind === 'bundle_gift' ? `Acquista ${required}: ricevi in omaggio ${offer.gift_quantity} × ${offer.gift_name}.` : offer.kind === 'bundle_discount' ? `Acquista ${required}: ottieni un ulteriore ${offer.discount_percent}% sui prodotti richiesti dall’offerta.` : offer.discount_mode === 'price' ? `Prezzo di vendita ${Number(offer.sale_price).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} · ${offerScope(offer)}.` : `${offer.discount_percent}% di sconto · ${offerScope(offer)}.`) + policy;
}
export function offerStatus(offer) {
  return offer.status === 'draft' ? 'Bozza' : offer.status === 'archived' ? 'Sospesa' : new Date(offer.starts_at) > new Date() ? 'Programmata' : offer.ends_at && new Date(offer.ends_at) <= new Date() ? 'Scaduta' : 'Attiva';
}
export function localOfferDate(value) {
  if (!value) return '';const date = new Date(value);if (!Number.isFinite(date.getTime())) return '';
  const part = n => String(n).padStart(2, '0');return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

export function offerKindLabel(offer) { return offer.kind === 'discount' && offer.discount_mode === 'price' ? 'Prezzo di vendita' : offerKinds[offer.kind]; }
