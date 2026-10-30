import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CrmDetailTable } from './CrmKpiDetail';
import { formatDate, formatMoney } from './crmConfig';
import { groupCustomerInvoices } from './customerInvoices';

const documentColumns = [
  { key: 'document', label: 'Documento', value: r => r.title,
    render: r => <Link to={`/ordini-private/fatture/${r.id}`}>{r.title}</Link> },
  { key: 'date', label: 'Data', value: r => formatDate(r.document_date), sortValue: r => r.document_date },
  { key: 'amount', label: 'Imponibile', value: r => formatMoney(r.amount), sortValue: r => Number(r.amount) },
];

export default function CrmCustomerInvoiceTable({ rows, customerLink }) {
  const groups = useMemo(() => groupCustomerInvoices(rows), [rows]);
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = id => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const detailId = row => 'customer-invoices-' + encodeURIComponent(row.id);
  const columns = [
    { key: 'customer', label: 'Cliente', value: r => `${r.customer_name} ${r.customer_code}`,
      searchValue: r => [r.customer_name, r.customer_code, ...r.invoices.map(d => `${d.title} ${formatDate(d.document_date)}`)].join(' '),
      render: r => <div className="crm-customer-invoice-heading">
        <button type="button" className="crm-customer-invoice-toggle" aria-expanded={expanded.has(r.id)}
          aria-controls={expanded.has(r.id) ? detailId(r) : undefined}
          aria-label={`${expanded.has(r.id) ? 'Nascondi' : 'Mostra'} fatture di ${r.customer_name}`} onClick={() => toggle(r.id)}>
          {expanded.has(r.id) ? <ChevronDown size={18} aria-hidden="true"/> : <ChevronRight size={18} aria-hidden="true"/>}
        </button>
        {r.customer_code ? <Link to={customerLink(r)}>{r.customer_name}<small>{r.customer_code}</small></Link> : <span>{r.customer_name}</span>}
      </div> },
    { key: 'invoices', label: 'Numero documenti', value: r => r.invoice_count },
    { key: 'date', label: 'Ultima fattura', value: r => formatDate(r.document_date), sortValue: r => r.document_date },
    { key: 'amount', label: 'Fatturato nel periodo', value: r => formatMoney(r.amount), sortValue: r => r.amount },
  ];
  return <CrmDetailTable rows={groups} columns={columns} renderExpanded={row => expanded.has(row.id)
    ? <section className="crm-customer-invoice-detail" id={detailId(row)} aria-label={`Fatture di ${row.customer_name}`}>
      <h3>{row.customer_name} · {row.invoice_count} documenti · {formatMoney(row.amount)}</h3>
      <CrmDetailTable rows={row.invoices} columns={documentColumns}/>
    </section> : null}/>;
}
