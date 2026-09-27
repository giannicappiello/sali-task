import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CrmKpiDialog, CrmDetailTable } from './CrmKpiDetail';
import { loadAllRpcRows } from './crmDataset';
import { formatDate, formatMoney } from './crmConfig';

const categories = [
  ['pr', 'Ordini PR in corso', 'pr_order_total'],
  ['stralci', 'Stralci', 'stralci_order_total'],
  ['ph', 'Ordini PH', 'ph_order_total'],
  ['ph_reservations', 'Ordini PH prenotazioni', 'ph_prenotazioni_total'],
  ['pr_reservations', 'Ordini PR prenotazioni', 'pr_prenotazioni_total'],
];
export default function CrmOpenOrdersDialog({ title, values, filters, onClose }) {
  const [category, setCategory] = useState(null);
  const [result, setResult] = useState({ rows: [], loading: false, error: '' });
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    if (!category) return;
    let active = true;
    setResult({ rows: [], loading: true, error: '' });
    loadAllRpcRows('crm_open_order_category_details', { ...JSON.parse(filterKey), p_category: category[0] })
      .then(({ data, error }) => { if (active) setResult({ rows: data || [], loading: false, error: error?.message || '' }); })
      .catch(error => { if (active) setResult({ rows: [], loading: false, error: error.message }); });
    return () => { active = false; };
  }, [category, filterKey]);
  const columns = [
    { key: 'order', label: 'Ordine', value: r => r.order_number, render: r => <Link to={`${r.module_code === 'ph' ? '/ordini-ph' : '/ordini-prof'}/elenco/${r.order_id}`}>{r.order_number}</Link> },
    { key: 'customer', label: 'Cliente', value: r => r.customer_name },
    { key: 'date', label: 'Data', value: r => formatDate(r.document_date), sortValue: r => r.document_date },
    { key: 'amount', label: 'Importo categoria', value: r => formatMoney(r.amount), sortValue: r => Number(r.amount) },
  ];
  return <CrmKpiDialog title={category ? category[1] : title} subtitle={`${formatDate(filters.p_from)} – ${formatDate(filters.p_to)} · IVA esclusa`} onClose={onClose}>
    {!category ? <div className="crm-order-category-list">{categories.map(item => <button type="button" key={item[0]} onClick={() => setCategory(item)}><span>{item[1]}</span><strong>{formatMoney(values[item[2]])}</strong><span aria-hidden="true">→</span></button>)}<p>Totale: <strong>{formatMoney(categories.reduce((sum, item) => sum + Number(values[item[2]] || 0), 0))}</strong></p></div> : <>
      <button type="button" className="secondary-action" onClick={() => setCategory(null)}>← Tutte le categorie</button>
      {result.loading ? <p role="status">Caricamento ordini…</p> : result.error ? <p role="alert">{result.error}</p> : <CrmDetailTable key={category[0]} rows={result.rows} columns={columns} empty="Nessun ordine in questa categoria per i filtri selezionati."/>}
    </>}
  </CrmKpiDialog>;
}
