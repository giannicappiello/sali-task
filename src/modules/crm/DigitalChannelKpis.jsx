import { useMemo, useState } from 'react';
import { CrmKpiCard, CrmKpiDialog, CrmDetailTable } from './CrmKpiDetail';
import CrmCustomerLink from './CrmCustomerLink';
import DigitalSalesDays from './DigitalSalesDays';
import DigitalProductAsins from './DigitalProductAsins';
import { digitalChannelKpis } from './digitalChannelKpiModel.js';
import { displayAmounts } from './digitalDashboardModel.js';
import { formatDate } from './crmConfig';

export default function DigitalChannelKpis({ orders, lines, period, loading, error, channelLabel }) {
  const [selected, setSelected] = useState(null);
  const model = useMemo(() => digitalChannelKpis(orders, lines), [orders, lines]);
  if (loading) return <p role="status">Caricamento KPI vendite…</p>;
  if (error) return null;
  const card = (label, value, note, info, kind) => <CrmKpiCard key={label} label={label} value={value} note={note} info={info} onClick={() => setSelected({ label, kind })}/>;
  return <><section className="b2b-kpi-section" aria-label={`KPI ${channelLabel || 'vendite'} del periodo`}><h2>KPI {channelLabel || 'vendite'}</h2><div className="crm-kpi-grid">
    {['fulfilled','waiting'].map(kind=>{const group=model.orderValues[kind];return card(kind==='fulfilled'?'Valore ordini evasi':'Valore ordini da evadere',displayAmounts(group.amounts),`${group.orders.length} ordini · ${group.amounts.missing} senza importo`,'Importi netti IVA noti, inclusi sconti, spedizioni e rimborsi disponibili. Gli importi mancanti non sono zero. Ordini annullati e falliti esclusi.',kind);})}
    {card('Clienti che hanno ordinato', model.customers.length, model.unidentified ? `${model.unidentified} ordini senza anagrafica collegata` : 'Clienti unici nel periodo', 'Ogni anagrafica CRM con ordini validi viene contata una volta. Apri l’elenco e seleziona il nome per la scheda cliente.', 'customers')}
    {card('Valore medio ordine', displayAmounts(model.orderValues.averages), model.orderValues.amounts.missing ? `Parziale: ${model.orderValues.amounts.known} ordini con importo` : 'Totale / numero ordini per valuta', 'Media degli ordini evasi e da evadere con importo netto disponibile, suddivisa per valuta.', 'orders')}
    {card('Prodotti Venduti', model.products.length, 'Prodotti distinti nel periodo', 'Prodotti presenti negli ordini validi. Quantità sommate anche senza UDM; spedizioni escluse dal conteggio prodotti. Apri per quantità e importi delle righe disponibili.', 'products')}
  </div></section>{selected ? <CrmKpiDialog title={selected.label} subtitle={`${formatDate(period.from)} – ${formatDate(period.to)}`} onClose={() => setSelected(null)}>
    {['orders','fulfilled','waiting'].includes(selected.kind) ? <DigitalSalesDays orders={selected.kind==='orders' ? model.orderValues.orders : model.orderValues[selected.kind].orders} loading={false} includeWaitingInTotals/> : selected.kind === 'customers' ? <CrmDetailTable rows={model.customers} columns={[
      { key: 'nome', label: 'Cognome e Nome', value: row => row.nome, render: row => <CrmCustomerLink crmType="online" accountId={row.id} name={row.nome} period={period}/> },
      { key: 'count', label: 'Ordini', value: row => row.count },
      { key: 'amount', label: 'Importo', value: row => displayAmounts(row.amounts) },
    ]}/> : <CrmDetailTable rows={model.products} columns={[
      { key: 'name', label: 'Prodotto', value: row => row.name, render: row => channelLabel === 'Amazon' ? <DigitalProductAsins product={row}/> : row.name },
      { key: 'code', label: 'Codice / ASIN', value: row => row.code },
      { key: 'quantity', label: 'Quantità', value: row => `${row.quantity.toLocaleString('it-IT')}${row.unknownQuantity ? ' (parziale)' : ''}` },
      { key: 'count', label: 'Ordini', value: row => row.count },
      { key: 'amount', label: 'Importo righe', value: row => displayAmounts(row.amounts) },
    ]}/>}
  </CrmKpiDialog> : null}</>;
}
