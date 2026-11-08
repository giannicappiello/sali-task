import { objectSchema, uuidSchema } from './schema.js';
import { dateFilter } from './production-report-reads.js';
import { requireFinanceAdmin, canReadFinance } from './mexal-finance.js';

const sources={
 invoices:{table:'mexal_fatture_vendita',date:'data_documento',order:['id'],columns:'id,sigla,cod_modulo,serie,numero,data_documento,codice_cliente,ragione_sociale_cliente,codice_agente_mexal,agente_nome,id_pagamento,totale_imponibile,totale_iva,totale_documento,sincronizzato_il'},
 invoice_lines:{table:'mexal_fatture_vendita_righe',order:['posizione','id'],columns:'id,fattura_id,posizione,tipo_riga,codice_articolo,descrizione,quantita,prezzo_unitario,sconto,aliquota_iva,codice_agente_mexal'},
 warehouse_history:{table:'workspace_warehouse_stock_history',date:'snapshot_date',order:['snapshot_date','article_code','warehouse_number'],columns:'snapshot_date,article_code,warehouse_number,warehouse_name,unit_of_measure,on_hand,committed,available,unit_cost,source,captured_at'}
};
const fail=message=>Object.assign(Error(message),{status:400});
export function mexalArchiveTools(auth) {
 if(!canReadFinance(auth))return {};
 return {MEXAL_ARCHIVE_READ:{effect:'read',description:'Legge per l’amministratore tutto l’archivio sincronizzato Mexal di fatture vendita, righe per fattura e storico magazzino con paginazione e JWT/RLS personali. Non è un campione; paginare fino a nextOffset=null. Restituisce quantità, prezzi e importi originali senza ricalcolo. Il costo ultimo di magazzino non equivale alla valorizzazione di bilancio.',
 inputSchema:objectSchema({dataset:{type:'string',enum:Object.keys(sources)},documentId:uuidSchema,from:{type:'string',format:'date'},to:{type:'string',format:'date'},offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:100}},['dataset']),execute:async input=>{
  const d=sources[input.dataset],offset=input.offset??0,limit=input.limit??50;
  if(!d||!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isInteger(limit)||limit<1||limit>100)throw fail('Fonte o pagina non valide.');
  const from=dateFilter(input.from),to=dateFilter(input.to);
  if(from&&to&&from>to)throw fail('Periodo non ordinato.');
  if(input.dataset==='invoice_lines'&&(!input.documentId||from||to))throw fail('Per le righe indicare documentId senza filtri data.');
  if(input.dataset!=='invoice_lines'&&input.documentId)throw fail('documentId consentito solo per le righe fattura.');
  await requireFinanceAdmin(auth);
  let q=auth.scoped.from(d.table).select(d.columns);
  if(input.documentId)q=q.eq('fattura_id',input.documentId);
  if(from)q=q.gte(d.date,from);if(to)q=q.lte(d.date,to);
  for(const field of d.order)q=q.order(field);
  const {data,error}=await q.range(offset,offset+limit);if(error)throw error;
  return {source:d.table,readOnly:true,readAt:new Date().toISOString(),rows:(data||[]).slice(0,limit),nextOffset:data?.length>limit?offset+limit:null,
   coverage:'Archivio già sincronizzato Workspace, nessun aggiornamento Mexal. Stabilità di pagina: ordinamento per chiavi univoche; se la sincronizzazione cambia durante la lettura ricominciare. Magazzino: mantenere source e captured_at; mexal_reconstructed non è una rilevazione storica ufficiale.'};
 }}};
}
