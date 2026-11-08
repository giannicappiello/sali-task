import { createHash } from 'node:crypto';
import { buildMexalClient } from '../mexal/sync-products.js';
import { hasCredentials } from './credential-guard.js';
import { objectSchema } from './schema.js';
import { requireAnalyticsScope } from './production-report-reads.js';
import { canReadModule } from '../ai/operational-read.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const digest=value=>createHash('sha256').update(value).digest('hex');
const financial=/scadenz|contabil|bilanc|prim[ao][-_ ]?nota|piano[-_ ]?(?:dei[-_ ]?)?conti|sald[io]|tesorer|banc[ah]|cass[ae]|fluss|cash|margini|costi|valorizz|magazzin|articol|movimenti/i;
const technical=/password|passwd|token|secret|credential|utenti|oauth|autentic|configuraz/i;
export function financeCatalog(help) {
 const rows=new Map();
 function visit(value) {
  if(!value||typeof value!=='object')return;
  if(value.method==='GET'&&typeof value.regexp==='string'&&value.regexp.length<=1000&&financial.test(value.regexp)&&!technical.test(value.regexp)) {
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
export const canReadFinance=auth=>auth.profile?.ruoli?.amministratore_workspace===true&&canReadModule(auth,['integrazioni']);
export async function requireFinanceAdmin(auth) {
 if(!canReadFinance(auth))throw fail('Lettura economico-finanziaria Mexal riservata all’amministratore Workspace nel perimetro AI integrazioni.',403);
 const {data,error}=await auth.scoped.rpc('workspace_user_is_admin');
 if(error)throw fail('Verifica amministratore non disponibile.',503);
 if(data!==true)throw fail('Amministratore non verificato.',403);
 await requireAnalyticsScope(auth);
}
function safePayload(payload) {
 if(hasCredentials(payload))throw fail('Risposta Mexal contenente campi di credenziali: lettura bloccata.',422);
 return payload;
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
  MEXAL_FINANCE_READ:{effect:'read',inputSchema:objectSchema({...properties,capabilityId:{type:'string',pattern:'^[a-f0-9]{64}$'},path:{type:'string',minLength:1,maxLength:500},max:{type:'integer',minimum:1,maximum:100},next:{type:'string',maxLength:4000},fields:{type:'string',maxLength:1500,pattern:'^[A-Za-z0-9_,]+$'},tipo:{type:'string',enum:['P','D','X']}},['capabilityId','path']),description:'Legge una risorsa economico-finanziaria con GET dalla connessione Mexal esistente, dopo verifica live del catalogo e dell’amministratore. Usare ID e percorso del contratto MEXAL_FINANCE_CATALOG; scadenziario tipo P/D/X se previsto. Restituisce importi e paginazione ufficiali senza ricalcolare bilancio, margini, cassa o valorizzazioni. Non scrive e non importa.',execute:async input=>{
   const {client,capabilities}=await current(input.year),capability=capabilities.find(c=>c.id===input.capabilityId);
   if(!capability)throw fail('Capacità GET Mexal non pubblicata o non più disponibile.',403);
   const path=checkedFinancePath(input.path,capability),query=new URLSearchParams();
   for(const key of ['max','next','fields','tipo'])if(input[key]!==undefined)query.set(key,String(input[key]));
   const payload=safePayload(await client.getJson(path+(query.size?'?'+query:'')));
   return {source:'Mexal WebAPI',readOnly:true,readAt:new Date().toISOString(),company:client.azienda,year:client.anno,path,capabilityId:capability.id,payload,
    coverage:'Risposta ufficiale non ricalcolata. Paginare secondo il cursore restituito da Mexal. Una pagina non equivale all’intero archivio; valuta, criterio di valorizzazione, data e natura consuntiva/previsionale devono risultare dalla fonte, altrimenti sono non verificati.'};
  }}
 };
}
