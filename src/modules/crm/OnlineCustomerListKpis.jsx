import { combineAmounts, amountBasisNote } from './digitalOrderValueModel.js';
import { useState } from 'react';
import { CrmKpiCard, CrmKpiDialog, CrmDetailTable } from './CrmKpiDetail';
import CrmCustomerLink from './CrmCustomerLink';
import { displayAmounts } from './digitalDashboardModel.js';
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
    {['fulfilled','waiting'].map(kind=>{const subset=rows.filter(row=>row[`${kind}_count`]>0),amounts=combineAmounts(subset.map(row=>row[`${kind}_amounts`]));return card(kind==='fulfilled'?'Valore ordini evasi':'Valore ordini da evadere',displayAmounts(amounts),subset,`${subset.reduce((sum,row)=>sum+row[`${kind}_count`],0)} ordini · ${amounts.missing} senza importo${amountBasisNote(amounts) ? " · "+amountBasisNote(amounts) : ""}`);})}
    {card('Ordini', rows.reduce((sum,row)=>sum+(row.fulfilled_count || 0)+(row.waiting_count || 0),0), rows.filter(row=>row.fulfilled_count || row.waiting_count), 'Ordini evasi e da evadere collegati ai clienti')}
    {card('Iscritti mailing', rows.filter(row=>row.mailing?.subscribed === true).length, rows.filter(row=>row.mailing?.subscribed === true), 'Almeno una audience attiva')}
    {card('Disiscritti mailing', rows.filter(row=>row.mailing?.label === 'Disiscritto').length, rows.filter(row=>row.mailing?.label === 'Disiscritto'), 'Nessuna audience attiva')}
  </div></section>{selected ? <CrmKpiDialog title={selected.label} subtitle={`${formatDate(period.from)} – ${formatDate(period.to)}`} onClose={()=>setSelected(null)}><CrmDetailTable rows={selected.rows} columns={[
    {key:'nome',label:'Cliente',value:row=>row.nome,render:row=><CrmCustomerLink crmType="online" customerKey={row.entityKey} name={row.nome} period={period}/>},
    {key:'origine',label:'Origine',value:row=>row.origine},
    {key:'mailing',label:'Iscrizione mailing',value:row=>row.mailing?.label},
    {key:'received',label:'Mailing ricevute',value:row=>row.mailing?.received == null ? 'Dato non disponibile' : `${row.mailing.received}${row.mailing.partial ? ' (parziale)' : ''}`},
    {key:'fulfilled',label:'Valore evasi',value:row=>displayAmounts(row.fulfilled_amounts || {totals:[],known:0,missing:0})},
    {key:'waiting',label:'Valore da evadere',value:row=>displayAmounts(row.waiting_amounts || {totals:[],known:0,missing:0})},
    {key:'fulfilled_count',label:'Ordini evasi',value:row=>row.fulfilled_count || 0},
    {key:'waiting_count',label:'Ordini da evadere',value:row=>row.waiting_count || 0},
  ]}/></CrmKpiDialog> : null}</>;
}
