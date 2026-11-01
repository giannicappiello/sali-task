
import CrmRemoteDetailTable from './CrmRemoteDetailTable';
import {CrmKpiDialog} from './CrmKpiDetail';
import CrmCustomerLink from './CrmCustomerLink';

import {formatDate,formatMoney} from './crmConfig';
const number=value=>Number(value||0).toLocaleString('it-IT',{maximumFractionDigits:6});
export default function CrmB2BFinancialDialog({title,metric,parameters,kpis={},period,onClose,summaryLoading,summaryError,onRetry}){
 if(summaryLoading||summaryError)return <CrmKpiDialog title={title} subtitle={formatDate(parameters.p_from)+' – '+formatDate(parameters.p_to)+' · IVA esclusa'} onClose={onClose}>{summaryLoading?<p role="status">Calcolo KPI…</p>:<p role="alert">{summaryError} <button type="button" onClick={onRetry}>Riprova</button></p>}</CrmKpiDialog>;
 const monthly=metric==='monthly_consumption';
 const columns=[
  {key:'customer',remoteFields:['customer_name'],label:'Cliente',value:r=>r.customer_name,render:r=><CrmCustomerLink crmType="b2b" customerCode={r.customer_code} name={r.customer_name} period={period}/>},
  ...(monthly?[
   {key:'order_count',remoteFormat:'number',label:'Ordini non fatturati',value:r=>r.order_count},
   {key:'order_total',remoteFormat:'money',label:'Ordinato netto',value:r=>formatMoney(r.order_total),sortValue:r=>Number(r.order_total)},
   {key:'invoice_count',remoteFormat:'number',label:'Fatture',value:r=>r.invoice_count},
   {key:'invoice_total',remoteFormat:'money',label:'Fatturato netto',value:r=>formatMoney(r.invoice_total),sortValue:r=>Number(r.invoice_total)},
   {key:'combined_total',remoteFormat:'money',label:'Totale netto',value:r=>formatMoney(r.combined_total),sortValue:r=>Number(r.combined_total)},
   {key:'monthly_amount',remoteFormat:'money',label:'Consumo medio mensile cliente',value:r=>r.unknown_documents?'Dato incompleto':formatMoney(r.monthly_amount),sortValue:r=>Number(r.monthly_amount)}
  ]:[
   {key:'document',remoteFields:['document_number'],label:metric==='ph_average'?'Ordine padre PH':'Fattura',value:r=>r.document_number},
   {key:'date',remoteFields:['document_date'],remoteFormat:'date',label:'Data',value:r=>formatDate(r.document_date),sortValue:r=>r.document_date},
   {key:'net_amount',remoteFormat:'money',label:'Importo netto',value:r=>formatMoney(r.net_amount),sortValue:r=>Number(r.net_amount)}
  ])
 ];
 const numerator=metric==='ph_average'?kpis.ph_order_total:kpis.invoice_total;
 const denominator=metric==='ph_average'?kpis.ph_order_count:kpis.invoice_count;
 const result=metric==='ph_average'?kpis.average_ph_order:metric==='invoice_average'?kpis.average_invoice:kpis.monthly_consumption;
 return <CrmKpiDialog title={title} subtitle={formatDate(parameters.p_from)+' – '+formatDate(parameters.p_to)+' · IVA esclusa · filtri della schermata'} onClose={onClose}>
 <p className="b2b-dialog-message">{monthly?<><strong>{formatMoney(result)}</strong><br/>({formatMoney(kpis.order_total)} ordini non fatturati + {formatMoney(kpis.invoice_total)} fatture) ÷ {kpis.contributors} clienti contribuenti ÷ {number(kpis.months)} mesi.<br/>I mesi parziali sono proporzionali ai giorni inclusi; ogni cliente contribuisce una sola volta al denominatore.</>:<><strong>{formatMoney(result)}</strong><br/>{formatMoney(numerator)} ÷ {denominator} {metric==='ph_average'?'ordini padre PH non fatturati':'fatture'}.</>}</p>
 {Number(kpis.unknown_documents)>0&&<p role="alert">Sono presenti documenti senza importo netto verificabile: i calcoli interessati non sono disponibili.</p>}
 <CrmRemoteDetailTable source="crm_b2b_financial_details" parameters={{...parameters,p_metric:metric}} columns={columns}/>
 </CrmKpiDialog>;
}
