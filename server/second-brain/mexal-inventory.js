import {createHash} from 'node:crypto';
import {buildMexalClient} from '../mexal/sync-products.js';
import {canReadFinance,requireFinanceAdmin} from './mexal-finance.js';
import {hasCredentials} from './credential-guard.js';
import {objectSchema} from './schema.js';
import {inventoryValuation} from './mexal-inventory-model.js';

const error=(message,status=400)=>Object.assign(Error(message),{status});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ARTICLE_FIELDS='codice,descrizione,tipologia,um_principale,costo_ult,cos_ult,qta_inventario,qta_carico,qta_scarico';
const LINE_FIELDS='sigla,serie,numero,cod_conto,data_documento,id_riga,id_rif_testata,codice_articolo,id_causale_riga,id_ncau_riga,id_mag_da_riga,id_mag_a_riga,tp_um_articolo,quantita,coeff_conv,sigla_doc_orig,data_doc_orig';
const PROGRESSIVE_FIELDS='cod_articolo,id_magazzino,um_principale,qta_inventario,qta_carico,qta_scarico,num_prog_art';
function hasEndpoint(help,path,method){
 let found=false;
 function visit(x){if(!x||typeof x!=='object')return;if(x.method===method&&typeof x.regexp==='string'&&new RegExp(x.regexp).test(path))found=true;Object.values(x).forEach(visit);}
 visit(help);return found;
}
export async function inventorySource(client,path,{fields,filter,maxPages=100,maxRows=100000}={}){
 const collected=[],seen=new Set();let next=null;
 for(let page=0;page<maxPages;page++){
  const query=new URLSearchParams({max:'1000'});if(fields)query.set('fields',fields);if(next)query.set('next',next);
  const payload=filter?await client.postJson(path+'?'+query,{filtri:[filter]}):await client.getJson(path+'?'+query);
  if(hasCredentials(payload))throw error('Risposta inventario contenente campi riservati.',422);
  const rows=Array.isArray(payload)?payload:payload?.dati;
  if(!Array.isArray(rows))throw error('Formato della fonte inventario non riconosciuto.',502);
  collected.push(...rows);if(collected.length>maxRows)throw error('Archivio inventario oltre il limite di lettura.',422);
  next=payload?.next||null;if(!next)return {rows:collected,pages:page+1,complete:true,digest:hash(collected),path};
  if(seen.has(next))throw error('Cursore inventario ripetuto: lettura incompleta.',502);seen.add(next);
 }
 throw error('Paginazione inventario non esaurita.',422);
}
export function progressiveRows(payload){
 if(!payload||typeof payload!=='object'||!Array.isArray(payload.cod_articolo))throw error('Progressivi Mexal non riconosciuti.',502);
 const rows=new Map();
 for(const name of ['cod_articolo','id_magazzino','um_principale','qta_inventario','qta_carico','qta_scarico']){
  if(!Array.isArray(payload[name]))throw error('Campo progressivi mancante: '+name,502);
  for(const tuple of payload[name]){
   if(!Array.isArray(tuple)||tuple.length!==2||!Number.isInteger(tuple[0]))throw error('Matrice progressivi non valida.',502);
   const row=rows.get(tuple[0])||{};row[name]=tuple[1];rows.set(tuple[0],row);
  }
 }
 if(!Number.isSafeInteger(payload.num_prog_art)||rows.size!==payload.num_prog_art)throw error('Copertura progressivi incompleta.',422);
 return [...rows.values()].map(row=>{
  if(typeof row.cod_articolo!=='string'||!Number.isInteger(row.id_magazzino)||row.id_magazzino<1)throw error('Chiave progressivi mancante.',502);
  const result={...row,qta_inventario:row.qta_inventario??0,qta_carico:row.qta_carico??0,qta_scarico:row.qta_scarico??0};
  if(!['qta_inventario','qta_carico','qta_scarico'].every(k=>typeof result[k]==='number'&&Number.isFinite(result[k])))throw error('Quantità progressivi non valida.',502);
  return result;
 });
}
export function inventoryPeriod(input,now=Date.now()){
 const year=input.year??Number(input.from?.slice(0,4));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 if(!Number.isInteger(year)||!valid(input.from)||!valid(input.to)||input.from>input.to||input.to>today||![input.from,input.to].every(d=>Number(d.slice(0,4))===year))throw error('Date inventario non valide o future.');
 return {year,from:input.from,to:input.to};
}
export function mexalInventoryTools(auth,{clientForYear=(year,warehouse=null)=>buildMexalClient({year,warehouse,timeoutMs:60000}),now=Date.now}={}){
 if(!canReadFinance(auth))return {};
 return {MEXAL_INVENTORY_READ:{effect:'read',description:'Calcola inventario gestionale Mexal GRE per articoli IT e magazzini 1–10 a due date. Riconcilia carichi e scarichi con i progressivi di ogni magazzino; conserva resi, segni e date delle bolle trasformate. Costo ultimo alla lettura comune alle due date, non costo storico o valore di bilancio. Solo letture API; nessuna sincronizzazione o modifica. Totali con lacune restano null.',inputSchema:objectSchema({year:{type:'integer',minimum:2000,maximum:2100},from:{type:'string',format:'date'},to:{type:'string',format:'date'},limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0,maximum:10000},snapshot:{type:'string',pattern:'^[a-f0-9]{64}$'},includeSources:{type:'boolean'}},['from','to']),execute:async input=>{
  await requireFinanceAdmin(auth);const period=inventoryPeriod(input,now());const client=clientForYear(period.year);
  if(client.azienda!=='GRE')throw error('Inventario disponibile esclusivamente per GRE.',403);
  const help=await client.getJson('/help');
  const endpoints=[['/articoli/ricerca','POST'],['/documenti/movimenti-magazzino/righe/ricerca','POST'],['/progressivi-articoli','GET'],['/dati-generali/valute','GET']];
  for(const[path,method]of endpoints)if(!hasEndpoint(help,path,method))throw error('Risorsa inventario non pubblicata: '+path,422);
  const articles=await inventorySource(client,'/articoli/ricerca',{fields:ARTICLE_FIELDS,filter:{campo:'codice',condizione:'inizia_per',valore:'IT'}});
  const movements=await inventorySource(client,'/documenti/movimenti-magazzino/righe/ricerca',{fields:LINE_FIELDS,filter:{campo:'codice_articolo',condizione:'inizia_per',valore:'IT'}});
  const currencies=await inventorySource(client,'/dati-generali/valute');
  if(articles.rows.some(r=>typeof r.codice!=='string'||!r.codice.startsWith('IT'))||movements.rows.some(r=>typeof r.codice_articolo!=='string'||!r.codice_articolo.startsWith('IT')))throw error('Filtro articoli IT non rispettato dalla fonte Mexal.',422);
  const progressives=[],progressiveSources=[];
  for(let warehouse=1;warehouse<=10;warehouse++){
   const warehouseClient=clientForYear(period.year,warehouse);
   if(warehouseClient.azienda!=='GRE')throw error('Azienda del magazzino inattesa.',403);
   const progressivePayload=await warehouseClient.getJson('/progressivi-articoli?fields='+PROGRESSIVE_FIELDS);
   if(hasCredentials(progressivePayload))throw error('Progressivi contenenti campi riservati.',422);
   if(progressivePayload.next)throw error('Progressivi paginati: copertura da completare.',422);
   const rows=progressiveRows(progressivePayload);
   if(rows.some(r=>r.id_magazzino!==warehouse))throw error('Perimetro del magazzino non rispettato da Mexal.',422);
   const selected=rows.filter(r=>r.cod_articolo.startsWith('IT'));progressives.push(...selected);
   progressiveSources.push({path:'/progressivi-articoli',warehouse,rows:selected.length,digest:hash(selected),complete:true});
  }
  const calculation=inventoryValuation({articles:articles.rows,movements:movements.rows,progressives,period});
  const snapshot=hash({principal:auth.profile.id,period,articles:articles.digest,movements:movements.digest,progressives:progressiveSources});
  if(input.snapshot&&input.snapshot!==snapshot)throw error('Fonti inventario cambiate: ricominciare dalla prima pagina.',409);
  const offset=input.offset??0,limit=input.limit??50;
  return {source:'Mexal WebAPI',company:'GRE',period,readAt:new Date(now()).toISOString(),readOnly:true,saved:false,
   ...calculation,details:calculation.details.slice(offset,offset+limit),pagination:{offset,limit,total:calculation.details.length,nextOffset:offset+limit<calculation.details.length?offset+limit:null,snapshot},
   currency:{code:null,attested:false,note:'Importi nella valuta contabile Mexal, senza conversione. Il catalogo delle valute non identifica da solo la valuta di conto aziendale.',catalog:currencies.rows},
   scope:{articlePrefix:'IT',warehouses:[1,2,3,4,5,6,7,8,9,10],positiveStockOnly:true,aggregation:'articolo su totale magazzini selezionati'},
   sources:[{...articles,rows:articles.rows.length},{...movements,rows:movements.rows.length},...progressiveSources,{...currencies,rows:currencies.rows.length}],
   ...(input.includeSources?{diagnosticSourceRows:{articles:articles.rows,movements:movements.rows,progressives}}:{})};
 }}};
}
