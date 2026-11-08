import { createHash } from 'node:crypto';
import { buildMexalClient } from '../mexal/sync-products.js';
import { hasCredentials } from './credential-guard.js';
import { objectSchema } from './schema.js';
import { requireAnalyticsScope } from './production-report-reads.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const digest=value=>createHash('sha256').update(value).digest('hex');
const financial=/scadenz|contabil|bilanc|prim[ao][-_ ]?nota|conti|sald[io]|tesorer|banc[ah]|cass[ae]|fluss|cash|margini|costi|valorizz|magazzin|articol|movimenti/i;
const technical=/password|passwd|token|secret|credential|utenti|oauth|autentic|configuraz/i;
export function financeCatalog(help) {
 const rows=new Map();
 function visit(value) {
  if(!value||typeof value!=='object')return;
  if(value.method==='GET'&&typeof value.regexp==='string'&&value.regexp.length<=1000&&financial.test(value.regexp+' '+String(value.descrizione||''))&&!technical.test(value.regexp)) {
   const id=digest('GET\n'+value.regexp);
   rows.set(id,{id,method:'GET',pattern:value.regexp,description:String(value.descrizione||'').slice(0,1000)});
  }
  Object.values(value).forEach(visit);
 }
 visit(help);return [...rows.values()].sort((a,b)=>a.pattern.localeCompare(b.pattern));
}
export function checkedFinancePath(value,capability) {
 if(typeof value!=='string'||value.length>500||!value.startsWith('/')||value.startsWith('//')||/[?#[\]\\]/.test(value)||Array.from(value).some(c=>c.charCodeAt(0)<=32)||/%|(?:^|\/)\.{1,2}(?:\/|$)/.test(value)||technical.test(value))throw fail('Percorso Mexal non valido.');
 let regex;try{regex=new RegExp('^(?:'+capability.pattern+')$');}catch{throw fail('Contratto GET Mexal non interpretabile.',502);}
 if(!regex.test(value))throw fail('Percorso non pubblicato per questa capacità Mexal.',403);
 return value;
}
// Like the existing Mexal /help administration service, this is an admin
// capability, not a business-module grant. workspace_ai_capabilities has a
// fixed business-module list that cannot contain "integrazioni". Never invent
// a new required grant or widen that list to expose an admin-only service.
export const canReadFinance=auth=>auth.capabilities?.internal_data===true&&auth.profile?.ruoli?.amministratore_workspace===true;
export async function requireFinanceAdmin(auth) {
 if(!canReadFinance(auth))throw fail('Lettura economico-finanziaria Mexal riservata all’amministratore Workspace.',403);
 const {data,error}=await auth.scoped.rpc('workspace_user_is_admin');
 if(error)throw fail('Verifica amministratore non disponibile.',503);
 if(data!==true)throw fail('Amministratore non verificato.',403);
 await requireAnalyticsScope(auth);
}
function safePayload(payload) {
 if(hasCredentials(payload))throw fail('Risposta Mexal contenente campi di credenziali: lettura bloccata.',422);
 return payload;
}
export function financePage(payload,input={}) {
 const key=Array.isArray(payload)?null:['dati','items','records','data','righe'].find(k=>Array.isArray(payload?.[k]));
 const rows=Array.isArray(payload)?payload:key?payload[key]:null;
 if(!rows)return {payload,pagination:null};
 const offset=input.offset??0,limit=input.max??50;
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isInteger(limit)||limit<1||limit>100)throw fail('Pagina finanziaria non valida.');
 const snapshot=digest(JSON.stringify(rows));
 if(input.snapshot&&input.snapshot!==snapshot)throw fail('La pagina origine Mexal è cambiata: ricominciare da offset zero.',409);
 const page=rows.slice(offset,offset+limit);
 return {payload:Array.isArray(payload)?page:{...payload,[key]:page},pagination:{sourcePageRows:rows.length,returned:page.length,offset,limit,snapshot,nextOffset:offset+limit<rows.length?offset+limit:null,upstreamNext:Array.isArray(payload)?null:payload.next??null,instructions:'Prima esaurire nextOffset riusando lo snapshot e lo stesso cursore Mexal; poi usare upstreamNext con offset zero. Non sommare riepiloghi ripetuti nelle pagine. Il limite della risposta è applicato dal connettore anche se Mexal ignora max.'}};
}
export function mexalFinanceTools(auth,{clientForYear=year=>buildMexalClient({year,warehouse:null,timeoutMs:60000})}={}) {
 if(!canReadFinance(auth))return {};
 const properties={year:{type:'integer',minimum:2000,maximum:2100}};
 async function current(year) {
  await requireFinanceAdmin(auth);
  const client=clientForYear(year),help=safePayload(await client.getJson('/help'));
  return {client,capabilities:financeCatalog(help)};
 }
 return {
  MEXAL_FINANCE_CATALOG:{effect:'read',inputSchema:objectSchema(properties),description:'Verifica l’amministratore e legge il catalogo GET ufficiale della connessione API Mexal esistente: scadenziari, contabilità/bilancio, saldi, magazzino, articoli e movimenti quando pubblicati. Nessuna nuova credenziale, sincronizzazione o scrittura. La presenza nel catalogo non prova la riuscita della lettura.',execute:async input=>{
   const {client,capabilities}=await current(input.year);
   return {source:'Mexal /help',readOnly:true,readAt:new Date().toISOString(),company:client.azienda,year:client.anno,capabilities,
    requirements:['scadenziari clienti e fornitori','flussi di cassa effettivi e previsionali distinti','margini e costi ufficiali','valorizzazione magazzino con criterio e data','valore scarichi SL documentali','bilancio e dettaglio conti/saldi'],
    coverage:'Sono esposte solo risorse GET pubblicate dall’installazione. Se bilancio o valorizzazioni non sono presenti, il dato non è disponibile da questo contratto: non ricostruirlo dalle fatture o dal costo ultimo. Nessuna chiamata di servizi POST, registrazione contabile o esecuzione programmi.'};
  }},
  MEXAL_FINANCE_READ:{effect:'read',inputSchema:objectSchema({...properties,capabilityId:{type:'string',pattern:'^[a-f0-9]{64}$'},path:{type:'string',minLength:1,maxLength:500},max:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0,maximum:1000000},snapshot:{type:'string',pattern:'^[a-f0-9]{64}$'},next:{type:'string',maxLength:4000},fields:{type:'string',maxLength:1500,pattern:'^[A-Za-z0-9_,]+$'},tipo:{type:'string',enum:['P','D','X']}},['capabilityId','path']),description:'Legge una risorsa economico-finanziaria con GET dalla connessione Mexal esistente, dopo verifica live del catalogo e dell’amministratore. Usare ID/percorso da MEXAL_FINANCE_CATALOG; scadenziario tipo P/D/X se previsto. Risposte limitate a max righe (default 50): prima seguire pagination.nextOffset con snapshot, poi upstreamNext. Conserva importi ufficiali senza ricalcolare bilancio, margini, cassa o valorizzazioni. Non scrive e non importa.',execute:async input=>{
   const {client,capabilities}=await current(input.year),capability=capabilities.find(c=>c.id===input.capabilityId);
   if(!capability)throw fail('Capacità GET Mexal non pubblicata o non più disponibile.',403);
   const path=checkedFinancePath(input.path,capability),query=new URLSearchParams();
   for(const key of ['max','next','fields','tipo'])if(input[key]!==undefined)query.set(key,String(input[key]));
   const payload=safePayload(await client.getJson(path+(query.size?'?'+query:'')));
   return {source:'Mexal WebAPI',readOnly:true,readAt:new Date().toISOString(),company:client.azienda,year:client.anno,path,capabilityId:capability.id,...financePage(payload,input),
    coverage:'Risposta ufficiale non ricalcolata. Paginare secondo il cursore restituito da Mexal. Una pagina non equivale all’intero archivio; valuta, criterio di valorizzazione, data e natura consuntiva/previsionale devono risultare dalla fonte, altrimenti sono non verificati.'};
  }}
 };
}
