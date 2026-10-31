
import {useEffect,useMemo,useState} from 'react';
import {supabase} from '../../lib/supabaseClient';
import {loadDashboardProductRows} from './dashboardProducts';
import {productAgents} from './productPurchaseDetails';
import {CrmDetailTable} from './CrmKpiDetail';
import {formatMoney} from './crmConfig';
const columns=[
 {key:'agent_name',label:'Agente',value:r=>r.agent_name},
 {key:'quantity',label:'Totale quantità',value:r=>Number(r.quantity).toLocaleString('it-IT'),sortValue:r=>Number(r.quantity)},
 {key:'net_amount',label:'Importo netto',value:r=>formatMoney(r.net_amount)+(Number(r.unknown_amounts)?' (parziale)':''),sortValue:r=>Number(r.net_amount)},
 {key:'customers',label:'Clienti che hanno acquistato',value:r=>r.customers,sortValue:r=>Number(r.customers)}
];
export default function CrmProductAgents({parameters={},code,rows,customer}) {
 const [revision,setRevision]=useState(0);
 const [state,setState]=useState({rows:[],loading:true,error:''});
 const local=useMemo(()=>rows?productAgents(rows,customer).map(r=>({...r,net_amount:r.amount,unknown_amounts:r.unknownAmount?1:0})):null,[rows,customer]);
 const {p_crm_type,p_from,p_to,p_agent,p_category,p_order_module,p_customer_group}=parameters;
 useEffect(()=>{
  if(rows)return;
  let active=true;const controller=new AbortController();
  const timer=setTimeout(()=>{
   setState({rows:[],loading:true,error:''});
   loadDashboardProductRows(supabase,'crm_dashboard_product_agents',{p_crm_type,p_from,p_to,p_agent,p_category,p_product:code,...(p_order_module?{p_order_module,...(p_customer_group?{p_customer_group}:{})}:{})},controller.signal)
    .then(data=>{if(active)setState({rows:data,loading:false,error:''});})
    .catch(error=>{if(active)setState({rows:[],loading:false,error:error.message});});
  },0);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[rows,revision,p_crm_type,p_from,p_to,p_agent,p_category,p_order_module,p_customer_group,code]);
 if(!local&&state.loading)return <p role="status">Caricamento agenti…</p>;
 if(!local&&state.error)return <p role="alert">{state.error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Riprova</button></p>;
 return <CrmDetailTable rows={local||state.rows} columns={columns}/>;
}
