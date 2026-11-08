import { objectSchema, plainSchema } from './schema.js';

export function dataCoverageTool(tools) {
 return {effect:'read',inputSchema:objectSchema(),
  description:'Elenca le letture esposte per l’identità corrente, dataset, filtri e lacune note. Non legge archivi né concede permessi. Strumento esposto non equivale a lettura riuscita: ogni servizio verifica ancora i diritti.',
  execute:async()=>({source:'second-brain.catalog',readOnly:true,readAt:new Date().toISOString(),
   authorization:'Catalogo personale, non attestazione di accesso ai record. RLS, schermate, ruoli e perimetro AI sono verificati dai servizi a ogni chiamata. Nessuna modifica dei permessi.',
   reads:Object.entries(tools).filter(([,t])=>(t.effect||'read')==='read').map(([name,t])=>({name,description:t.description,filters:plainSchema(t).properties||{}})),
   limitations:[
    {area:'Consuntivi produzioni',tool:'PRODUCTION_CONSUNTIVI_READ',coverage:'Archivio importato Workspace, produzioni concluse e stessi calcoli della schermata. Nessun aggiornamento MES, recupero OC o fatture. Ambiti propri/team bloccati finché manca un filtro ufficiale; cliente filtrato dal servizio.'},
    {area:'MES',tool:'MES_READ',coverage:'Solo risorse e filtri del contratto pubblico. Non è accesso generale al database MES. Alcune letture di dominio restano subordinate ai permessi operativi esistenti.'},
    {area:'Workspace',tool:'WORKSPACE_SEARCH / BUSINESS_SEARCH',coverage:'Proiezioni esplicite paginabili di prodotti, metadati documenti, progetti, task e riferimenti CRM; non contenuto integrale o allegati.'},
    {area:'Fatture',tool:'SALES_INVOICES_READ',coverage:'Contesto riepilogativo con dettaglio limitato; non esportazione completa né contabilità generale.'},
    {area:'Finanza, qualità e manutenzione',coverage:'Nessuna lettura dedicata completa verificata per contabilità generale, banche, scadenziari, non conformità o manutenzione. Richiede adattatori ufficiali e verifica autorizzazioni; non usare SQL libero o service role come scorciatoia.'}
   ],writes:'Le nuove capacità sono sole letture. Le proposte aziendali mantengono BRAIN_REVIEW e conferma umana separata; nessuna approvazione automatica.'})};
}
