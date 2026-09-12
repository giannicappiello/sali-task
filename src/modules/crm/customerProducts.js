export const CUSTOMER_PRODUCT_SCREENS = {
  ordered: { title: 'Prodotti ordinati', path: '/crm/prodotti-ordinati', code: 'crm.prodotti_ordinati' },
  purchased: { title: 'Prodotti acquistati', path: '/crm/prodotti-acquistati', code: 'crm.prodotti_acquistati' },
};

export async function readProductPages(makeQuery, signal) {
  const rows = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await makeQuery().range(start, start + 499).abortSignal(signal);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 500) return rows;
  }
}
export async function loadCustomerProductLines(client, key, kind, signal, crmType = '') {
  if (!key) return [];
  return readProductPages(() => client.rpc('crm_customer_product_lines', { p_customer_key: key, p_kind: kind, p_crm_type: crmType || null }), signal);
}
export async function loadProductCustomers(client, signal, crmType = '') {
  const rows = await readProductPages(() => client.from('crm_classified_customers')
    .select('codice_cliente,ragione_sociale,area_crm').in('area_crm', crmType ? [crmType] : ['b2b', 'online']).order('ragione_sociale').order('codice_cliente'), signal);
  return rows.map(row => ({ key: 'mexal:' + row.codice_cliente, name: row.ragione_sociale, code: row.codice_cliente, crmType: row.area_crm }));
}
export function inProductPeriod(row, from, to, allHistory) {
  return allHistory || Boolean(row.document_date && row.document_date >= from && row.document_date <= to);
}
export function previousProductPeriod(from, to) {
  const start = Date.parse(from + 'T00:00:00Z'); const end = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { from: new Date(start - (end - start + 86400000)).toISOString().slice(0, 10), to: new Date(start - 86400000).toISOString().slice(0, 10) };
}
export function productAmount(rows) {
  const included = rows.filter(row => !row.excluded_from_totals);
  const unknown = included.filter(row => row.net_amount == null || !Number.isFinite(Number(row.net_amount))).length;
  return { value: included.reduce((sum, row) => sum + (Number.isFinite(Number(row.net_amount)) ? Math.round(Number(row.net_amount) * 100) : 0), 0) / 100, unknown };
}
export function productQuantities(rows) {
  const units = new Map();
  for (const row of rows.filter(row => !row.excluded_from_totals)) {
    const unit = row.unit?.trim().toUpperCase() || 'UM non disponibile';
    units.set(unit, (units.get(unit) || 0) + Number(row.quantity || 0));
  }
  return [...units].map(([unit, quantity]) => ({ unit, quantity }));
}
export function purchaseDates(rows) {
  return [...new Set(rows.filter(row => !row.excluded_from_totals && !row.is_credit && Number(row.quantity) > 0 && row.document_date).map(row => row.document_date))].sort();
}
export function groupCustomerProducts(rows, { from, to, allHistory = false }) {
  const unique = [...new Map(rows.map(row => [row.line_id, row])).values()];
  const previous = allHistory ? null : previousProductPeriod(from, to);
  const groups = new Map();
  for (const row of unique) {
    const code = row.product_code;
    if (!code) continue;
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(row);
  }
  const result = [];
  for (const [code, history] of groups) {
    const lines = history.filter(row => inProductPeriod(row, from, to, allHistory));
    if (!lines.length) continue;
    const dates = purchaseDates(history.filter(row => allHistory || (row.document_date && row.document_date <= to)));
    const periodDates = new Set(purchaseDates(lines));
    const gaps = dates.slice(1).map((date, i) => (Date.parse(date) - Date.parse(dates[i])) / 86400000);
    const frequency = gaps.length ? gaps.reduce((sum, days) => sum + days, 0) / gaps.length : null;
    const nextDate = frequency ? new Date(Date.parse(dates.at(-1) + 'T00:00:00Z') + Math.round(frequency) * 86400000).toISOString().slice(0, 10) : null;
    const amount = productAmount(lines);
    const previousAmount = previous ? productAmount(history.filter(row => inProductPeriod(row, previous.from, previous.to, false))) : null;
    const variation = previousAmount && !previousAmount.unknown && !amount.unknown && previousAmount.value > 0 ? (amount.value - previousAmount.value) / previousAmount.value * 100 : null;
    const sortedHistory = [...history].sort((a, b) => String(b.document_date || '').localeCompare(String(a.document_date || '')) || a.document_id.localeCompare(b.document_id) || a.line_position - b.line_position);
    result.push({ code, description: sortedHistory[0]?.description || code, lines, history: sortedHistory, amount, quantities: productQuantities(lines),
      documents: new Set(lines.map(row => row.document_id)).size,
      reorders: dates.filter((date, index) => index > 0 && periodDates.has(date)).length,
      frequency, nextDate, variation });
  }
  const total = productAmount(unique.filter(row => inProductPeriod(row, from, to, allHistory)));
  return result.map(product => ({ ...product, share: total.value > 0 && !total.unknown && !product.amount.unknown ? product.amount.value / total.value * 100 : null }))
    .sort((a, b) => b.amount.value - a.amount.value || a.code.localeCompare(b.code));
}
export function productDocumentLabel(line, firstDate) {
  if (line.excluded_from_totals) return 'Annullato · escluso dai totali';
  if (line.is_credit) return 'Storno / nota di credito';
  if (!line.document_date || Number(line.quantity) <= 0) return 'Movimento';
  return line.document_date === firstDate ? 'Primo acquisto' : 'Riordino';
}
