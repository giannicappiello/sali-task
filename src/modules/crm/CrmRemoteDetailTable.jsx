
import{useCallback,useEffect,useMemo,useState}from'react';
import{ supabase }from'../../lib/supabaseClient';
import{CrmDetailTable}from'./CrmKpiDetail';
const initialQuery={search:'',filters:{},sort:{key:'',direction:'asc'},offset:0,limit:25};
export default function CrmRemoteDetailTable({source,parameters,columns,renderExpanded,empty,mapRow=row=>row,onResult,transform='rows',customerCode=null,documentId=null,rowFilters=[]}){
 const[query,setQuery]=useState(initialQuery),[revision,setRevision]=useState(0);
 const[state,setState]=useState({rows:[],total:0,available:0,sums:{},loading:true,error:''});
 const sourceKey=JSON.stringify({source,parameters,transform,customerCode,documentId,rowFilters,columns:columns.map(c=>({key:c.key,fields:c.remoteFields||[c.key],format:c.remoteFormat||'text'}))});
 const queryKey=JSON.stringify(query);
 const update=useCallback(value=>{setState(previous=>({...previous,rows:[],loading:true,error:''}));setQuery(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);},[]);
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setState(previous=>({...previous,rows:[],loading:true,error:''}));
   const deadline=setTimeout(()=>controller.abort(),16000);
   try{
    const config=JSON.parse(sourceKey),q=JSON.parse(queryKey);
    const{data,error}=await supabase.rpc('crm_kpi_detail_page',{p_source:config.source,p_parameters:config.parameters,p_columns:config.columns,p_search:q.search,p_filters:q.filters,p_sort:q.sort.key,p_direction:q.sort.direction,p_limit:q.limit,p_offset:q.offset,p_transform:config.transform,p_customer:config.customerCode,p_document:config.documentId,p_restrictions:config.rowFilters}).abortSignal(controller.signal);
    if(error)throw new Error(controller.signal.aborted?'Tempo di caricamento superato. Riprova.':error.message);
    if(!data||!Array.isArray(data.rows))throw new Error('Risposta dettaglio non valida.');
    if(active)setState({...data,loading:false,error:''});
   }catch(error){if(active)setState(previous=>({...previous,rows:[],loading:false,error:controller.signal.aborted?'Tempo di caricamento superato. Riprova.':error.message}));}
   finally{clearTimeout(deadline);}
  },200);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[sourceKey,queryKey,revision]);
 useEffect(()=>{if(onResult&&!state.loading&&!state.error)onResult(state);},[state,onResult]);
 const remote=useMemo(()=>({...state,onQueryChange:update,retry:()=>setRevision(v=>v+1)}),[state,update]);
 return <CrmDetailTable rows={state.rows.map(mapRow)} columns={columns} renderExpanded={renderExpanded} empty={empty} remote={remote}/>;
}
