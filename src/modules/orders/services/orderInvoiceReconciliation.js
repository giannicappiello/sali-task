const matrix = value => new Map((Array.isArray(value) ? value : []).filter(Array.isArray).map(row => [String(row[0]), row[1]]));
export function invoiceCoverage(expected, invoices) {
  if (!expected?.length || !invoices?.length || invoices.some(i => !i.single_order)) return 'linked';
  const wanted = new Map(), actual = new Map();
  for (const line of expected) {
    if (!line.code || !line.unit || !(Number(line.quantity) > 0)) return 'linked';
    const key = `${line.code}|${line.unit}`;
    wanted.set(key, (wanted.get(key) || 0) + Number(line.quantity));
  }
  for (const invoice of new Map(invoices.map(i => [i.id, i])).values()) {
    const quantities = matrix(invoice.quantities), units = matrix(invoice.units);
    for (const [position, code] of matrix(invoice.articles)) {
      if (!String(code || '').trim()) continue;
      const qty = Number(quantities.get(position)), unit = units.get(position);
      if (!unit || !Number.isFinite(qty) || qty < 0) return 'linked';
      const key = `${code}|${unit}`;
      // An unexpected unit/product makes the scope of the invoice uncertain.
      if (!wanted.has(key)) return 'linked';
      actual.set(key, (actual.get(key) || 0) + qty);
    }
  }
  if (![...actual.values()].some(q => q > 0)) return 'linked';
  return [...wanted].every(([key, qty]) => (actual.get(key) || 0) + 0.000001 >= qty) ? 'full' : 'partial';
}

export function attachInvoiceLinks(orders, links) {
  const grouped = new Map();
  for (const row of links || []) {
    if (!grouped.has(row.ordine_id)) grouped.set(row.ordine_id, { invoices: new Map(), expected: row.expected_lines });
    grouped.get(row.ordine_id).invoices.set(row.invoice.id, row.invoice);
  }
  return orders.map(order => {
    const group = grouped.get(order.id);
    const invoices = group ? [...group.invoices.values()] : [];
    return { ...order, linked_invoices: invoices, invoice_coverage: invoiceCoverage(group?.expected, invoices) };
  });
}
