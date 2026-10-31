
import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabaseClient';
import {loadDashboardProductRows} from './dashboardProducts';
import CrmProductPurchaseDetails from './CrmProductPurchaseDetails';
export default function CrmProductDocumentLines({parameters={},code,rows,customer,mode}) {
 const [revision,setRevision]=useState(0);
 const [state,setState]=useState({rows:[],loading:true,error:''});
 const {p_crm_type,p_from,p_to,p_agent,p_category,p_order_module,p_customer_group}=parameters;
 useEffect(()=>{
  if(rows)return;
  let active=true;const controller=new AbortController();
  const timer=setTimeout(()=>{
   setState({rows:[],loading:true,error:''});
   loadDashboardProductRows(supabase,'crm_dashboard_product_detail_lines',{p_crm_type,p_from,p_to,p_agent,p_category,p_product:code,...(p_order_module?{p_order_module,...(p_customer_group?{p_customer_group}:{})}:{})},controller.signal)
   .then(data=>{if(active)setState({rows:data,loading:false,error:''});})
   .catch(error=>{if(active)setState({rows:[],loading:false,error:error.message});});
  },0);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[rows,revision,p_crm_type,p_from,p_to,p_agent,p_category,p_order_module,p_customer_group,code]);
 if(!rows&&state.loading)return <p role="status">Caricamento documenti…</p>;
 if(!rows&&state.error)return <p role="alert">{state.error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Riprova</button></p>;
 return <CrmProductPurchaseDetails lines={rows||state.rows} mode={mode} customer={customer}/>;
}
