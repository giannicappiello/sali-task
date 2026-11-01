import CrmRemoteDetailTable from './CrmRemoteDetailTable';
import CrmRemoteInvoiceTable from './CrmRemoteInvoiceTable';
import { Link } from 'react-router-dom';
import { CrmKpiDialog } from './CrmKpiDetail';


import { formatDate, formatMoney } from './crmConfig';

const PRIVATE_CARD_DETAILS = {
  Fatturato: 'invoices', 'OCT aperti': 'oct', 'Clienti Mexal attivi': 'customers',
  'Nuovi clienti': 'new', 'Riordini attesi': 'reorders', Pipeline: 'pipeline', 'Forecast ponderato': 'forecast',
};
export default function CrmPrivateDashboardDialog({ title, filters, onClose }) {
  const metric = PRIVATE_CARD_DETAILS[title];
  const projects = ['pipeline', 'forecast'].includes(metric);
  const customers = ['customers', 'new', 'reorders'].includes(metric);
  const customerLink = r => `/crm/conto-terzi/clienti/${encodeURIComponent(`mexal:${r.customer_code}`)}`;
  const columns = [
    ...(!customers ? [{ key: 'document',remoteFields:['title'], label: projects ? 'Progetto' : 'Documento', value: r => r.title,
      render: r => r.kind === 'project' ? r.title : <Link to={r.kind === 'invoice' ? `/ordini-private/fatture/${r.id}` : `/ordini-private/elenco/${r.id}`}>{r.title}</Link> }] : []),
    { key: 'customer',remoteFields:['customer_name'], label: 'Cliente', value: r => `${r.customer_name || ''} ${r.customer_code || ''}`,
      render: r => r.customer_code ? <Link to={customerLink(r)}>{r.customer_name}<small>{r.customer_code}</small></Link> : r.customer_name },
    { key: 'date',remoteFields:['document_date'],remoteFormat:'date', label: projects ? 'Chiusura prevista' : metric === 'new' ? 'Prima vendita' : metric === 'reorders' ? 'Riordino previsto' : customers ? 'Ultima fattura' : 'Data',
      value: r => formatDate(r.document_date), sortValue: r => r.document_date },
    { key: 'amount',remoteFormat:'money', label: customers ? 'Fatturato nel periodo' : projects ? 'Valore progetto' : 'Imponibile', value: r => formatMoney(r.amount), sortValue: r => Number(r.amount) },
    ...(projects ? [
      { key: 'stage',remoteFields:['status'], label: 'Fase', value: r => r.status },
      { key: 'probability',remoteFormat:'number', label: 'Probabilità', value: r => `${r.probability}%`, sortValue: r => Number(r.probability) },
      { key: 'weighted',remoteFormat:'money', label: 'Valore ponderato', value: r => formatMoney(r.weighted), sortValue: r => Number(r.weighted) },
    ] : []),
  ];
  return <CrmKpiDialog title={title === 'Fatturato' ? 'Fatturato per cliente · CRM Private' : title}
    subtitle={projects ? 'Progetti aperti della pipeline Private · come nel totale della card' : `${formatDate(filters.p_from)} – ${formatDate(filters.p_to)} · filtri della dashboard`}
    onClose={onClose}>
    {metric==='invoices'?<CrmRemoteInvoiceTable source="crm_private_dashboard_details" parameters={{...filters,p_metric:metric}} customerLink={customerLink}/>:<CrmRemoteDetailTable source="crm_private_dashboard_details" parameters={{...filters,p_metric:metric}} columns={columns}/>}

  </CrmKpiDialog>;
}
