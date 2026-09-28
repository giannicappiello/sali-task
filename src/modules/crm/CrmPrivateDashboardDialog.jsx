import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CrmKpiDialog, CrmDetailTable } from './CrmKpiDetail';
import { loadAllRpcRows } from './crmDataset';
import { formatDate, formatMoney } from './crmConfig';

const PRIVATE_CARD_DETAILS = {
  Fatturato: 'invoices', 'OCT aperti': 'oct', 'Clienti Mexal attivi': 'customers',
  'Nuovi clienti': 'new', 'Riordini attesi': 'reorders', Pipeline: 'pipeline', 'Forecast ponderato': 'forecast',
};
export default function CrmPrivateDashboardDialog({ title, filters, onClose }) {
  const metric = PRIVATE_CARD_DETAILS[title];
  const [result, setResult] = useState({ rows: [], loading: true, error: '' });
  const [attempt, setAttempt] = useState(0);
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(async () => {
      if (!active) return;
      setResult({ rows: [], loading: true, error: '' });
      try {
        const { data, error } = await loadAllRpcRows('crm_private_dashboard_details', { ...JSON.parse(filterKey), p_metric: metric });
        if (active) setResult({ rows: data || [], loading: false, error: error?.message || '' });
      } catch (error) { if (active) setResult({ rows: [], loading: false, error: error.message }); }
    });
    return () => { active = false; };
  }, [metric, filterKey, attempt]);
  const projects = ['pipeline', 'forecast'].includes(metric);
  const customers = ['customers', 'new', 'reorders'].includes(metric);
  const customerLink = r => `/crm/conto-terzi/clienti/${encodeURIComponent(`mexal:${r.customer_code}`)}`;
  const columns = [
    ...(!customers ? [{ key: 'document', label: projects ? 'Progetto' : 'Documento', value: r => r.title,
      render: r => r.kind === 'project' ? r.title : <Link to={r.kind === 'invoice' ? `/ordini-private/fatture/${r.id}` : `/ordini-private/elenco/${r.id}`}>{r.title}</Link> }] : []),
    { key: 'customer', label: 'Cliente', value: r => `${r.customer_name || ''} ${r.customer_code || ''}`,
      render: r => r.customer_code ? <Link to={customerLink(r)}>{r.customer_name}<small>{r.customer_code}</small></Link> : r.customer_name },
    { key: 'date', label: projects ? 'Chiusura prevista' : metric === 'new' ? 'Prima vendita' : metric === 'reorders' ? 'Riordino previsto' : customers ? 'Ultima fattura' : 'Data',
      value: r => formatDate(r.document_date), sortValue: r => r.document_date },
    { key: 'amount', label: customers ? 'Fatturato nel periodo' : projects ? 'Valore progetto' : 'Imponibile', value: r => formatMoney(r.amount), sortValue: r => Number(r.amount) },
    ...(projects ? [
      { key: 'stage', label: 'Fase', value: r => r.status },
      { key: 'probability', label: 'Probabilità', value: r => `${r.probability}%`, sortValue: r => Number(r.probability) },
      { key: 'weighted', label: 'Valore ponderato', value: r => formatMoney(r.weighted), sortValue: r => Number(r.weighted) },
    ] : []),
  ];
  const sum = result.rows.reduce((total, row) => total + Number(metric === 'forecast' ? row.weighted : row.amount || 0), 0);
  return <CrmKpiDialog title={title === 'Fatturato' ? 'Fatture · CRM Private' : title}
    subtitle={projects ? 'Progetti aperti della pipeline Private · come nel totale della card' : `${formatDate(filters.p_from)} – ${formatDate(filters.p_to)} · filtri della dashboard`}
    onClose={onClose}>
    {result.loading ? <p role="status">Caricamento dettaglio…</p> : result.error ? <div role="alert"><p>{result.error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>Riprova</button></div> : <>
      {!customers && <p>Totale: <strong>{formatMoney(sum)}</strong>{!projects && ' · IVA esclusa'}</p>}
      <CrmDetailTable key={`${metric}-${filterKey}`} rows={result.rows} columns={columns}/>
    </>}
  </CrmKpiDialog>;
}
