import CrmRemoteDetailTable from './CrmRemoteDetailTable';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CrmKpiDialog } from './CrmKpiDetail';

import { formatDate, formatMoney } from './crmConfig';

const categories = [
  ['pr', 'Ordini PR in corso', 'pr_order_total'],
  ['stralci', 'Stralci', 'stralci_order_total'],
  ['ph', 'Ordini PH', 'ph_order_total'],
  ['ph_reservations', 'Ordini PH prenotazioni', 'ph_prenotazioni_total'],
  ['pr_reservations', 'Ordini PR prenotazioni', 'pr_prenotazioni_total'],
];
export default function CrmOpenOrdersDialog({ title, values, filters, onClose,orderModule=null,customerGroup=null }) {
  const [category, setCategory] = useState(null);
  const columns = [
    { key: 'order',remoteFields:['order_number'], label: 'Ordine', value: r => r.order_number, render: r => <Link to={`${r.module_code === 'ph' ? '/ordini-ph' : '/ordini-prof'}/elenco/${r.order_id}`}>{r.order_number}</Link> },
    { key: 'customer',remoteFields:['customer_name'], label: 'Cliente', value: r => r.customer_name },
    { key: 'date',remoteFields:['document_date'],remoteFormat:'date', label: 'Data', value: r => formatDate(r.document_date), sortValue: r => r.document_date },
    { key: 'amount',remoteFormat:'money', label: 'Importo categoria', value: r => formatMoney(r.amount), sortValue: r => Number(r.amount) },
  ];
  return <CrmKpiDialog title={category ? category[1] : title} subtitle={`${formatDate(filters.p_from)} – ${formatDate(filters.p_to)} · IVA esclusa`} onClose={onClose}>
    {!category ? <div className="crm-order-category-list">{categories.filter(item=>!orderModule || (orderModule==='ph'?item[0].startsWith('ph'):!item[0].startsWith('ph'))).map(item => <button type="button" key={item[0]} onClick={() => setCategory(item)}><span>{item[1]}</span><strong>{formatMoney(values[item[2]])}</strong><span aria-hidden="true">→</span></button>)}<p>Totale: <strong>{formatMoney(categories.filter(item=>!orderModule || (orderModule==='ph'?item[0].startsWith('ph'):!item[0].startsWith('ph'))).reduce((sum, item) => sum + Number(values[item[2]] || 0), 0))}</strong></p></div> : <>
      <button type="button" className="secondary-action" onClick={() => setCategory(null)}>← Tutte le categorie</button>
      <CrmRemoteDetailTable key={category[0]} source="crm_open_order_category_details" parameters={{...filters,p_category:category[0]}} rowFilters={customerGroup==='mypharma'?[{field:'customer_code',op:'eq',value:'501.00288'}]:customerGroup==='regular'?[{field:'customer_code',op:'neq',value:'501.00288'}]:[]} columns={columns} empty="Nessun ordine in questa categoria per i filtri selezionati."/>

    </>}
  </CrmKpiDialog>;
}
