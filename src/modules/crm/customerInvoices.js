// Group the complete, already-authorized period dataset before filtering or pagination.
export function groupCustomerInvoices(rows) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const code = String(row.customer_code || '').trim();
    const key = code ? 'customer:' + code : 'invoice:' + (row.id || index);
    if (!groups.has(key)) groups.set(key, { id: key, customer_code: code,
      customer_name: row.customer_name || code || 'Cliente non disponibile', amount: 0,
      document_date: null, invoice_count: 0, invoices: [] });
    const group = groups.get(key);
    group.invoices.push(row);
    group.invoice_count += 1;
    group.amount += Number(row.amount || 0);
    if (row.document_date && (!group.document_date || row.document_date > group.document_date)) group.document_date = row.document_date;
  });
  return [...groups.values()].map(group => ({ ...group, invoices: [...group.invoices].sort((a, b) =>
    String(b.document_date || '').localeCompare(String(a.document_date || '')) ||
    String(a.title || '').localeCompare(String(b.title || ''), 'it-IT', { numeric: true })) }))
    .sort((a, b) => b.amount - a.amount || a.customer_name.localeCompare(b.customer_name, 'it-IT'));
}
