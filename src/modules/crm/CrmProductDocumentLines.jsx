import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabaseClient';
import {CrmDetailTable} from './CrmKpiDetail';
import {formatDate,formatMoney} from './crmConfig';
import {loadDashboardProductRows} from './dashboardProducts';
const columns=[
 {key:'document_number',label:'Documento',value:r=>r.document_number},
 {key:'customer_name',label:'Cliente',value:r=>r.customer_name},
 {key:'document_date',label:'Data',value:r=>formatDate(r.document_date)},
 {key:'description',label:'Prodotto',value:r=>r.description},
 {key:'quantity',label:'Quantità',value:r=>r.quantity},
 {key:'unit',label:'UM',value:r=>r.unit},
 {key:'net_amount',label:'Importo netto',value:r=>formatMoney(r.net_amount)},
 {key:'document_status',label:'Stato',value:r=>r.document_status},
];
export default function CrmProductDocumentLines({parameters,code}) {
 const [open,setOpen]=useState(false),[revision,setRevision]=useState(0);
 const [state,setState]=useState({rows:[],loading:true,error:''});
 const {p_crm_type,p_from,p_to,p_agent,p_category,p_order_module,p_customer_group}=parameters;
 useEffect(()=>{
  if(!open) return;
  let active=true;const controller=new AbortController();
  const timer=setTimeout(()=>{
   setState({rows:[],loading:true,error:''});
   loadDashboardProductRows(supabase,'crm_dashboard_product_detail_lines',{p_crm_type,p_from,p_to,p_agent,p_category,p_product:code,...(p_order_module?{p_order_module,...(p_customer_group?{p_customer_group}:{})}:{})},controller.signal)
   .then(rows=>{if(active)setState({rows,loading:false,error:''});})
   .catch(error=>{if(active)setState({rows:[],loading:false,error:error.message});});
  },0);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[open,revision,p_crm_type,p_from,p_to,p_agent,p_category,p_order_module,p_customer_group,code]);
 return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Righe documento</summary>{open ? state.loading ? <p role="status">Caricamento righe…</p> : state.error ? <p role="alert">{state.error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Riprova</button></p> : <CrmDetailTable rows={state.rows} columns={columns}/> : null}</details>;
}
