import { canReadModule } from '../ai/operational-read.js';
import { handleProgremesReadonlyRequest } from '../progremes-readonly-api.js';
import { PROGREMES_ALLOWED_RESOURCES } from '../progremes-readonly-client.js';
import { productionCostTools } from '../ai/production-cost-tools.js';
import { objectSchema } from './schema.js';

const orderModules={prof:'ordini_pr',ph:'ordini_ph',private:'ordini_private'};
const check=result=>{if(result.error)throw result.error;return result.data;};
export function businessReadTools(auth) {
  const tools={},types=Object.keys(orderModules).filter(type=>canReadModule(auth,[orderModules[type]]));
  if(types.length)tools.WORKSPACE_ORDERS_SEARCH={description:'Legge documenti nella cache ordini Mexal, inclusi annullati e bozze: non è il KPI Ordinato CRM. Per analisi allineate alla dashboard usare CRM_CUSTOMER_SEARCH con orderModule. Usare agente_nome nei report, mantenendo il codice solo come riferimento. Rispetta moduli, integrazioni e agenti del richiedente. Non genera o invia ordini.',effect:'read',inputSchema:objectSchema({
    module:{type:'string',enum:types},customerCode:{type:'string',maxLength:80},offset:{type:'integer',minimum:0,maximum:100000},
  },['module']),execute:async input=>{
    const admin=auth.profile.ruoli?.amministratore_workspace===true;
    const integrations=check(await auth.scoped.from('integrazioni_utenti').select('modulo,enabled,ruolo_ordini')) || [];
    const integration=integrations.find(row=>row.modulo===({prof:'gestione_ordini_pr',ph:'gestione_ordini_ph',private:'gestione_ordini_private'})[input.module]);
    if(!admin&&integration?.enabled!==true)throw Object.assign(new Error('Integrazione ordini non autorizzata.'),{status:403});
    let q=auth.scoped.from('ordini_testate').select('*').or(input.module==='prof'?'modulo_ordini.eq.prof,modulo_ordini.is.null':`modulo_ordini.eq.${input.module}`).order('data_ordine',{ascending:false}).order('id');
    if(!admin&&integration.ruolo_ordini!=='backoffice'){
      const codes=check(await auth.scoped.rpc('visible_mexal_agent_codes')) || [];
      if(!codes.length)return {rows:[],nextOffset:null};q=q.in('codice_agente_mexal',codes);
    }
    if(input.customerCode)q=q.eq('codice_cliente',input.customerCode);
    const offset=input.offset || 0,rows=check(await q.range(offset,offset+50)) || [];
    const fields=['id','modulo_ordini','numero_ordine_visualizzato','numero_ordine','data_ordine','codice_cliente','ragione_sociale_cliente','codice_agente_mexal','agente_nome','stato','stato_sincronizzazione','totale_imponibile','totale_iva','totale_documento','totale'];
    return {rows:rows.slice(0,50).map(row=>Object.fromEntries(fields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))),nextOffset:rows.length>50?offset+50:null,source:'ordini_testate',readAt:new Date().toISOString()};
  }};
  const fullInvoiceScope=types.length && Object.values(orderModules).every(module=>!auth.access.modules?.includes(module)||canReadModule(auth,[module]));
  if(fullInvoiceScope) {
    tools.SALES_INVOICES_READ={description:'Legge riepiloghi delle fatture di vendita sincronizzate da Mexal. Il campione dettagliato e limitato; non trattarlo come l’intero archivio.',effect:'read',inputSchema:objectSchema({}),execute:async()=>({source:'workspace_ai_sales_invoice_context',data:check(await auth.scoped.rpc('workspace_ai_sales_invoice_context',{p_limit:100}))})};
    tools.CUSTOMER_REORDERS_READ={description:'Analizza riordini dall’intero storico fatture autorizzato, con limiti sul numero di clienti e prodotti restituiti.',effect:'read',inputSchema:objectSchema({}),execute:async()=>({source:'workspace_ai_customer_reorder_context',data:check(await auth.scoped.rpc('workspace_ai_customer_reorder_context',{p_customer_limit:80,p_product_limit:40}))})};
  }
  if(auth.capabilities.progremes&&canReadModule(auth,['progremes'])) {
    tools.MES_READ={description:'Legge risorse ProgreMES autorizzate: produzioni, ODL, materiali e altri dati del contratto pubblico. Usa pagine e filtri supportati; nessuna scrittura.',effect:'read',inputSchema:objectSchema({resource:{type:'string',enum:PROGREMES_ALLOWED_RESOURCES},page:{type:'integer',minimum:1,maximum:100000},pageSize:{type:'integer',minimum:1,maximum:100},search:{type:'string',maxLength:160},articleCode:{type:'string',maxLength:100}},['resource']),execute:async input=>{
      let status=200,payload;
      const res={setHeader(){},status(value){status=value;return this;},json(value){payload=value;return this;}};
      await handleProgremesReadonlyRequest({method:'GET',headers:{authorization:`Bearer ${auth.token}`},query:input},res);
      if(status!==200)throw Object.assign(new Error(payload?.error || 'Lettura MES non disponibile.'),{status});
      return payload;
    }};
    const costs=productionCostTools(auth,null);
    tools.PRODUCTION_COST_CONFIGURATION=costs.PRODUCTION_COST_CONFIGURATION;
    tools.PRODUCTION_COST_PROPOSALS=costs.PRODUCTION_COST_PROPOSALS;
    // Explicitly exclude PRODUCTION_COST_PROPOSE: it delegates to a paid API model.
  }
  return tools;
}
