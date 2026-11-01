
import {useEffect,useState} from 'react';
import {CrmKpiDialog,CrmDetailTable} from './CrmKpiDetail';
import CrmCustomerLink from './CrmCustomerLink';
import {loadAllRpcRows} from './crmDataset';
import {formatDate,formatMoney} from './crmConfig';
const number=value=>Number(value||0).toLocaleString('it-IT',{maximumFractionDigits:6});
export default function CrmB2BFinancialDialog({title,metric,parameters,kpis={},period,onClose,summaryLoading,summaryError,onRetry}){
 const [attempt,setAttempt]=useState(0),[state,setState]=useState({rows:[],loading:true,error:''});
 const key=JSON.stringify(parameters);
 useEffect(()=>{
  let active=true;const timer=setTimeout(()=>{
   setState({rows:[],loading:true,error:''});
   loadAllRpcRows('crm_b2b_financial_details',{...JSON.parse(key),p_metric:metric})
    .then(({data,error})=>{if(active)setState({rows:data||[],loading:false,error:error?.message||''});})
    .catch(error=>{if(active)setState({rows:[],loading:false,error:error.message});});
  },0);return()=>{active=false;clearTimeout(timer);};
 },[key,metric,attempt]);
 if(summaryLoading||summaryError)return <CrmKpiDialog title={title} subtitle={formatDate(parameters.p_from)+' – '+formatDate(parameters.p_to)+' · IVA esclusa'} onClose={onClose}>{summaryLoading?<p role="status">Calcolo KPI…</p>:<p role="alert">{summaryError} <button type="button" onClick={onRetry}>Riprova</button></p>}</CrmKpiDialog>;
 const monthly=metric==='monthly_consumption';
 const columns=[
  {key:'customer',label:'Cliente',value:r=>r.customer_name,render:r=><CrmCustomerLink crmType="b2b" customerCode={r.customer_code} name={r.customer_name} period={period}/>},
  ...(monthly?[
   {key:'order_count',label:'Ordini non fatturati',value:r=>r.order_count},
   {key:'order_total',label:'Ordinato netto',value:r=>formatMoney(r.order_total),sortValue:r=>Number(r.order_total)},
   {key:'invoice_count',label:'Fatture',value:r=>r.invoice_count},
   {key:'invoice_total',label:'Fatturato netto',value:r=>formatMoney(r.invoice_total),sortValue:r=>Number(r.invoice_total)},
   {key:'combined_total',label:'Totale netto',value:r=>formatMoney(r.combined_total),sortValue:r=>Number(r.combined_total)},
   {key:'monthly_amount',label:'Consumo medio mensile cliente',value:r=>r.unknown_documents?'Dato incompleto':formatMoney(r.monthly_amount),sortValue:r=>Number(r.monthly_amount)}
  ]:[
   {key:'document',label:metric==='ph_average'?'Ordine padre PH':'Fattura',value:r=>r.document_number},
   {key:'date',label:'Data',value:r=>formatDate(r.document_date),sortValue:r=>r.document_date},
   {key:'net_amount',label:'Importo netto',value:r=>formatMoney(r.net_amount),sortValue:r=>Number(r.net_amount)}
  ])
 ];
 const numerator=metric==='ph_average'?kpis.ph_order_total:kpis.invoice_total;
 const denominator=metric==='ph_average'?kpis.ph_order_count:kpis.invoice_count;
 const result=metric==='ph_average'?kpis.average_ph_order:metric==='invoice_average'?kpis.average_invoice:kpis.monthly_consumption;
 return <CrmKpiDialog title={title} subtitle={formatDate(parameters.p_from)+' – '+formatDate(parameters.p_to)+' · IVA esclusa · filtri della schermata'} onClose={onClose}>
 <p className="b2b-dialog-message">{monthly?<><strong>{formatMoney(result)}</strong><br/>({formatMoney(kpis.order_total)} ordini non fatturati + {formatMoney(kpis.invoice_total)} fatture) ÷ {kpis.contributors} clienti contribuenti ÷ {number(kpis.months)} mesi.<br/>I mesi parziali sono proporzionali ai giorni inclusi; ogni cliente contribuisce una sola volta al denominatore.</>:<><strong>{formatMoney(result)}</strong><br/>{formatMoney(numerator)} ÷ {denominator} {metric==='ph_average'?'ordini padre PH non fatturati':'fatture'}.</>}</p>
 {Number(kpis.unknown_documents)>0&&<p role="alert">Sono presenti documenti senza importo netto verificabile: i calcoli interessati non sono disponibili.</p>}
 {state.loading?<p role="status">Caricamento dettaglio completo…</p>:state.error?<p role="alert">{state.error} <button type="button" onClick={()=>setAttempt(n=>n+1)}>Riprova</button></p>:<CrmDetailTable rows={state.rows} columns={columns}/>}
 </CrmKpiDialog>;
}
