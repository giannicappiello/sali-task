
import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {CrmKpiDialog,CrmDetailTable} from './CrmKpiDetail';
import CrmCustomerInvoiceTable from './CrmCustomerInvoiceTable';
import {loadAllRpcRows} from './crmDataset';
import {formatDate,formatMoney} from './crmConfig';
const COMMERCIAL_CARD_METRICS={
 'Fatturato':'invoices','OCT aperti':'oct','Clienti Mexal attivi':'customers','Nuovi clienti':'new','Clienti persi':'lost'
};
function customerPath(row){
 const area=row.crm_area||row.invoices?.[0]?.crm_area;
 const base=area==='conto_terzi'?'/crm/conto-terzi':area==='online'?'/crm/online':'/crm/b2b';
 return base+'/clienti/'+encodeURIComponent('mexal:'+row.customer_code);
}
export default function CrmCommercialMetricDialog({title,filters,onClose}){
 const metric=COMMERCIAL_CARD_METRICS[title];
 const [attempt,setAttempt]=useState(0),[state,setState]=useState({rows:[],loading:true,error:''});
 const key=JSON.stringify(filters);
 useEffect(()=>{
  let active=true;
  const timer=setTimeout(()=>{
   setState({rows:[],loading:true,error:''});
   loadAllRpcRows('crm_commercial_dashboard_details',{...JSON.parse(key),p_metric:metric})
    .then(({data,error})=>{if(active)setState({rows:data||[],loading:false,error:error?.message||''});})
    .catch(error=>{if(active)setState({rows:[],loading:false,error:error.message});});
  },0);
  return()=>{active=false;clearTimeout(timer);};
 },[key,metric,attempt]);
 const clients=['customers','new','lost'].includes(metric);
 const columns=[
  ...(!clients?[{key:'title',label:'Documento',value:r=>r.title}]:[]),
  {key:'customer',label:'Cliente',value:r=>r.customer_name,render:r=><Link to={customerPath(r)}>{r.customer_name}<small>{r.customer_code}</small></Link>},
  {key:'date',label:metric==='new'?'Prima vendita':'Ultimo documento',value:r=>formatDate(r.document_date),sortValue:r=>r.document_date},
  {key:'amount',label:clients?'Fatturato netto nel periodo':'Importo netto',value:r=>formatMoney(r.amount),sortValue:r=>Number(r.amount)}
 ];
 return <CrmKpiDialog title={title} subtitle={formatDate(filters.p_from)+' – '+formatDate(filters.p_to)+' · filtri della dashboard · IVA esclusa'} onClose={onClose}>
 {state.loading?<p role="status">Caricamento dettaglio completo…</p>:state.error?<div role="alert">{state.error}<button type="button" onClick={()=>setAttempt(n=>n+1)}>Riprova</button></div>:<>
 <p>{clients?state.rows.length+' clienti':'Totale: '+formatMoney(state.rows.reduce((sum,r)=>sum+Number(r.amount||0),0))}</p>
 {metric==='invoices'?<CrmCustomerInvoiceTable rows={state.rows} customerLink={customerPath} linkDocuments={false}/>:<CrmDetailTable rows={state.rows} columns={columns}/>}
 </>}
 </CrmKpiDialog>;
}
