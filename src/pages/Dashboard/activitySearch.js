const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function matchesActivitySearch(item, query, related = []) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const code = String(item.resourceCode || item.resource || '').split(' · ')[0];
  const station = /^(?:ST|STATION)\s*0*(\d+)$/i.exec(code);
  const filling = /^(?:F|FILLING)\s*0*(\d+)$/i.exec(code);
  const fields = [item.titolo, item.descrizione, item.note, item.reparto, item.resource, item.resourceCode,
    item.orderNumber, item.articleCode, item.customerName, item.rdpReference, item.octReference,
    item.stato, item.start, item.end, item.deadline,
    station ? `Station ${Number(station[1])} ST${Number(station[1])}` : '',
    filling ? `Filling ${Number(filling[1])} F${Number(filling[1])}` : '',
    item.tipo === 'production' ? 'lavorazione produzione' : item.tipo === 'reminder' ? 'reminder' : 'task fase', ...related];
  const haystack = normalize(fields.join(' '));
  const compact = haystack.replaceAll(' ', '');
  return terms.every(term => haystack.includes(term) || compact.includes(term));
}
