// Totals never require downloading document lines. Each request is bounded and cancellable.
async function request(client,name,parameters,signal) {
 const controller=new AbortController();
 const cancel=()=>controller.abort();
 if(signal?.aborted) controller.abort(); else signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>controller.abort(),90000);
 try {
  const {data,error}=await client.rpc(name,parameters).abortSignal(controller.signal);
  if(error) throw new Error(controller.signal.aborted && !signal?.aborted ? 'Tempo di caricamento prodotti superato. Riprova.' : error.message || 'Dati prodotti non disponibili.');
  return data;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export async function loadDashboardProductSummary(client,parameters,signal) {
 const data=await request(client,parameters.p_order_module?'crm_b2b_order_product_summary':'crm_dashboard_product_summary',parameters,signal);
 if(!data || Array.isArray(data) || typeof data!=='object') throw new Error('Riepilogo prodotti non valido.');
 return Object.fromEntries(['ordered','purchased','reserved'].map(category=>{
  const value=Number(data[category] ?? 0);
  if(!Number.isSafeInteger(value)||value<0) throw new Error('Conteggio prodotti non valido.');
  return [category,value];
 }));
}
export async function loadDashboardProductRows(client,name,parameters,signal) {
 const rows=[];
 for(let offset=0;;offset+=500){
  if(signal?.aborted) throw new Error('Caricamento annullato.');
  const data=await request(client,parameters.p_order_module?name.replace('crm_dashboard_product_','crm_b2b_order_product_'):name,{...parameters,p_limit:500,p_offset:offset},signal);
  if(!Array.isArray(data)) throw new Error('Dettaglio prodotti non valido.');
  rows.push(...data);if(data.length<500) return rows;
 }
}
