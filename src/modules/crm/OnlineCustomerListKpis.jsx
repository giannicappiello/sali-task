import { useState } from 'react';
import { CrmKpiCard, CrmKpiDialog, CrmDetailTable } from './CrmKpiDetail';
import CrmCustomerLink from './CrmCustomerLink';
import { knownAmounts, displayAmounts } from './digitalDashboardModel.js';
import { formatDate } from './crmConfig';
export default function OnlineCustomerListKpis({ rows, period }) {
  const [selected, setSelected] = useState(null);
  const active = rows.filter(row => row.crm_active);
  const sales = rows.filter(row => row.order_count > 0);
  const card = (label, value, subset, note) => <CrmKpiCard key={label} label={label} value={value} note={note} info="Calcolato sui clienti e sul periodo dell’elenco corrente; apri per vedere le anagrafiche comprese." onClick={() => setSelected({ label, rows: subset })}/>;
  return <><section className="b2b-kpi-section"><h2>Clienti, ordini e mailing</h2><div className="crm-kpi-grid">
    {card('Clienti totali', rows.length, rows, 'Anagrafiche nell’elenco')}
    {card('Clienti CRM attivi', active.length, active, 'Stato CRM attivo')}
    {card('Clienti CRM non attivi', rows.length-active.length, rows.filter(row => !row.crm_active), 'Storico conservato')}
    {card('Clienti attivi nel periodo', sales.length, sales, 'Con acquisti identificati')}
    {card('Importo acquisti', displayAmounts(knownAmounts(sales.map(row => ({ net_revenue: row.order_total, currency: row.currency })))), sales, 'Importi noti nel periodo')}
    {card('Ordini', sales.reduce((sum,row)=>sum+row.order_count,0), sales, 'Ordini collegati ai clienti')}
    {card('Iscritti mailing', rows.filter(row=>row.mailing?.subscribed === true).length, rows.filter(row=>row.mailing?.subscribed === true), 'Almeno una audience attiva')}
    {card('Disiscritti mailing', rows.filter(row=>row.mailing?.label === 'Disiscritto').length, rows.filter(row=>row.mailing?.label === 'Disiscritto'), 'Nessuna audience attiva')}
  </div></section>{selected ? <CrmKpiDialog title={selected.label} subtitle={`${formatDate(period.from)} – ${formatDate(period.to)}`} onClose={()=>setSelected(null)}><CrmDetailTable rows={selected.rows} columns={[
    {key:'nome',label:'Cliente',value:row=>row.nome,render:row=><CrmCustomerLink crmType="online" customerKey={row.entityKey} name={row.nome} period={period}/>},
    {key:'origine',label:'Origine',value:row=>row.origine},
    {key:'mailing',label:'Iscrizione mailing',value:row=>row.mailing?.label},
    {key:'received',label:'Mailing ricevute',value:row=>row.mailing?.received == null ? 'Dato non disponibile' : `${row.mailing.received}${row.mailing.partial ? ' (parziale)' : ''}`},
    {key:'ordini',label:'Ordini',value:row=>row.order_count},
  ]}/></CrmKpiDialog> : null}</>;
}
