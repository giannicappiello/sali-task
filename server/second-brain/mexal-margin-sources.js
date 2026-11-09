import {buildMexalClient} from '../mexal/sync-products.js';
import {canReadFinance,requireFinanceAdmin,financeCatalog,checkedFinancePath} from './mexal-finance.js';
import {inventorySource,inventoryPeriod} from './mexal-inventory.js';
import {hasCredentials} from './credential-guard.js';
import {objectSchema,validateInput} from './schema.js';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(message,status=422)=>Object.assign(Error(message),{status});
export function mexalMarginSourceTools(auth,{clientForYear=year=>buildMexalClient({year,warehouse:null,timeoutMs:60000}),now=Date.now}={}){
 if(!canReadFinance(auth))return {};
 const inputSchema=objectSchema({year:{type:'integer',minimum:2000,maximum:2100},from:{type:'string',format:'date'},to:{type:'string',format:'date'},dataset:{type:'string',enum:['accounting','SL']},offset:{type:'integer',minimum:0,maximum:100000},limit:{type:'integer',minimum:1,maximum:100},snapshot:{type:'string',pattern:'^[a-f0-9]{64}$'}},['from','to','dataset']);
 return {MEXAL_MARGIN_SOURCES_READ:{effect:'read',inputSchema,description:'Legge esclusivamente fonti Mexal GRE per il report marginalità: piano conti, prima nota con data statistica oppure totali originari dei documenti SL netti IVA. Sola lettura GET, nessuna scrittura o calcolo di bilancio. SL paginati con snapshot; consumare tutte le pagine. Le classificazioni del prospetto e le competenze restano da riconciliare.',execute:async input=>{
  await requireFinanceAdmin(auth);validateInput(inputSchema,input);const period=inventoryPeriod(input,now()),client=clientForYear(period.year);
  if(client.azienda!=='GRE')throw fail('Azienda GRE non verificata.',403);
  const help=await client.getJson('/help');if(hasCredentials(help))throw fail('Contratto riservato.');const capabilities=financeCatalog(help);
  const check=path=>{const cap=capabilities.find(c=>new RegExp(c.pattern).test(path));if(!cap)throw fail('Risorsa GET non pubblicata: '+path);return checkedFinancePath(path,cap);};
  const collect=(path,fields)=>inventorySource(client,check(path),{fields,maxPages:200,maxRows:200000});
  const base={source:'Mexal WebAPI',company:'GRE',readOnly:true,saved:false,period,readAt:new Date(now()).toISOString()};
  if(input.dataset==='accounting'){
   const chart=await collect('/conti','codice,ragione_sociale,bil_34dir_ue_d,bil_34dir_ue_a');
   const headers=await collect('/prima-nota','data_registr,progressivo,cau_contabile,data_documento,data_statistica');
   const journal=await collect('/prima-nota/righe','data_registr,progressivo,cau_contabile,codice_conto,importo_riga');
   return {...base,complete:true,chart,headers,journal,basis:'Intero esercizio; selezione mensile da data statistica della testata, se compilata, altrimenti data registrazione. Nessuna competenza inventata.'};
  }
  const headers=await collect('/documenti/movimenti-magazzino','sigla,serie,numero,cod_conto,data_documento'),from=period.from.replaceAll('-',''),to=period.to.replaceAll('-','');
  const sl=headers.rows.filter(r=>r.sigla==='SL'&&r.data_documento>=from&&r.data_documento<=to).sort((a,b)=>[a.data_documento,a.serie,a.numero,a.cod_conto].join('|').localeCompare([b.data_documento,b.serie,b.numero,b.cod_conto].join('|')));
  const keys=sl.map(h=>[h.sigla,h.serie,h.numero,h.cod_conto].join('+'));if(new Set(keys).size!==keys.length)throw fail('Chiavi SL duplicate.');
  const snapshot=hash({principal:auth.profile.id,period,sl});if(input.snapshot&&input.snapshot!==snapshot)throw fail('Elenco SL cambiato: ricominciare da offset zero.',409);
  const offset=input.offset??0,limit=input.limit??100;if(offset&&!input.snapshot)throw fail('Snapshot necessario.',400);
  const documents=[];
  for(const h of sl.slice(offset,offset+limit)){
   const path=check('/documenti/movimenti-magazzino/'+[h.sigla,h.serie,h.numero,h.cod_conto].join('+'));
   const row=await client.getJson(path+'?fields=sigla,serie,numero,cod_conto,data_documento,id_valuta,tot_doc_validi,tot_documento,tot_iva');
   if(hasCredentials(row))throw fail('Documento riservato.');
   for(const field of ['sigla','serie','numero','cod_conto','data_documento'])if(row[field]!==h[field])throw fail('Identita documento SL incoerente.');
   documents.push(row);
  }
  return {...base,complete:offset+limit>=sl.length,documents,pagination:{offset,limit,total:sl.length,nextOffset:offset+limit<sl.length?offset+limit:null,snapshot},sources:[{...headers,rows:headers.rows.length}],basis:'Importi originari di testata: totale documento meno totale IVA. Nessuna valorizzazione dalle righe o dal costo ultimo.'};
 }}};
}
