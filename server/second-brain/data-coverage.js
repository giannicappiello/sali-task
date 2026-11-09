import { objectSchema, plainSchema } from './schema.js';

export function dataCoverageTool(tools) {
 return {effect:'read',inputSchema:objectSchema(),
  description:'Elenca le letture esposte per l’identità corrente, dataset, filtri e lacune note. Non legge archivi né concede permessi. Strumento esposto non equivale a lettura riuscita: ogni servizio verifica ancora i diritti.',
  execute:async()=>({source:'second-brain.catalog',readOnly:true,readAt:new Date().toISOString(),
   authorization:'Catalogo personale, non attestazione di accesso ai record. RLS, schermate, ruoli e perimetro AI sono verificati dai servizi a ogni chiamata. Nessuna modifica dei permessi.',
   reads:Object.entries(tools).filter(([,t])=>(t.effect||'read')==='read').map(([name,t])=>({name,description:t.description,filters:plainSchema(t).properties||{}})),
   limitations:[
    {area:'Rubrica Workspace',tool:'WORKSPACE_CONTACTS_SEARCH',coverage:'Solo id, nome, email del profilo e stato; JWT personale, RLS utenti e workspace_data_scope. Richiede modulo Messaggi nel perimetro AI. Paginare; omonimi da risolvere esplicitamente. Non garantisce accesso a tutti gli utenti; nessun dato HR, auth.users, permesso aggiunto o invio.'},
    {area:'Consuntivi produzioni',tool:'PRODUCTION_CONSUNTIVI_READ',coverage:'Archivio importato Workspace, produzioni concluse e stessi calcoli della schermata. Nessun aggiornamento MES, recupero OC o fatture. Ambiti propri/team bloccati finché manca un filtro ufficiale; cliente filtrato dal servizio.'},
    {area:'MES',tool:'MES_READ',coverage:'Solo risorse e filtri del contratto pubblico. Non è accesso generale al database MES. Alcune letture di dominio restano subordinate ai permessi operativi esistenti.'},
    {area:'Workspace',tool:'WORKSPACE_SEARCH / BUSINESS_SEARCH',coverage:'Proiezioni esplicite paginabili di prodotti, metadati documenti, progetti, task e riferimenti CRM; non contenuto integrale o allegati.'},
    {area:'Fatture e storico magazzino',tool:'MEXAL_ARCHIVE_READ',coverage:'Per admin: fatture e righe complete paginabili e storico magazzino già importato, con RLS personale. SALES_INVOICES_READ rimane un contesto limitato. Costo ultimo e storico ricostruito non equivalgono a bilancio.'},
    {area:'Economico-finanziaria Mexal',tool:'MEXAL_FINANCE_CATALOG / MEXAL_FINANCE_READ',coverage:'Per admin verificato e ambito tutti: connessione esistente, catalogo GET verificato a ogni lettura, dati originali. Copertura di scadenziari, cassa, conti, bilancio, costi, margini e valorizzazioni dipendente dalle risorse effettivamente pubblicate nell’installazione. Nessun totale inventato o sostituzione con fatture.'},
    {area:'Memoria da fonti',tool:'BRAIN_SOURCE_MEMORY_PREVIEW / BRAIN_SOURCE_MEMORY_PROPOSE',coverage:'Copie storiche personali per ogni pagina autorizzata, con provenienza, data, hash e deduplicazione per snapshot. Anteprima non persistita; proposte richiedono BRAIN_REVIEW e conferma umana prima di salvare. Non è una sincronizzazione automatica.'},
    {area:'Qualità e manutenzione',coverage:'Nessuna lettura dedicata completa verificata per non conformità o manutenzione. Richiede adattatori ufficiali e verifica autorizzazioni; non usare SQL libero o service role come scorciatoia.'}
   ],writes:'Le nuove capacità sono sole letture. Le proposte aziendali mantengono BRAIN_REVIEW e conferma umana separata; nessuna approvazione automatica.'})};
}
