import {createHash} from 'node:crypto';
import {buildMexalClient} from '../mexal/sync-products.js';
import {canReadFinance,requireFinanceAdmin,financeCatalog,checkedFinancePath} from './mexal-finance.js';
import {hasCredentials} from './credential-guard.js';
import {objectSchema} from './schema.js';
import {iso,cashflowMovements} from './mexal-cashflow-core.js';
import {cashflowDetail} from './mexal-cashflow-detail.js';
export {cashAmount,cashflowMovements} from './mexal-cashflow-core.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function collectCashflowSource(client,{now,started,deadlineMs,capabilities,sources},path,fields){
   const cap=capabilities.find(c=>{try{return new RegExp(c.pattern).test(path);}catch{return false;}});if(!cap)throw fail('Risorsa GET necessaria non pubblicata: '+path,422);checkedFinancePath(path,cap);
   const rows=[],seenCursors=new Set(),seenPages=new Set();let next=null,pages=0,complete=false,reason=null;
   do{
    if(now()-started>deadlineMs){reason='Tempo massimo di lettura raggiunto';break;}
    const q=new URLSearchParams({max:'1000',fields});if(next)q.set('next',next);
    let p;try{p=await client.getJson(path+'?'+q);}catch{reason='Lettura origine interrotta';break;}
    if(hasCredentials(p))throw fail('Risposta contenente credenziali.',422);
    const page=Array.isArray(p)?p:['dati','items','records','data','righe'].map(k=>p?.[k]).find(Array.isArray);
    if(!page){reason='Formato collezione non verificato';break;}
    const snapshot=hash(page);if(seenPages.has(snapshot)){reason='Mexal ripete una pagina già letta';break;}seenPages.add(snapshot);rows.push(...page);pages++;
    const cursor=Array.isArray(p)?null:p.next;
    if(cursor==null||cursor===''||cursor===false){complete=true;break;}
    if(typeof cursor!=='string'||cursor.length>4000||seenCursors.has(cursor)){reason='Cursore origine non valido o ripetuto';break;}
    seenCursors.add(cursor);next=cursor;
   }while(pages<2000);
   sources.push({path,pages,rows:rows.length,complete,reason:reason||(!complete?'Limite di pagine raggiunto':null),snapshot:hash(rows)});return {rows,complete};
}
export function mexalCashflowTools(auth,{clientForYear=year=>buildMexalClient({year,warehouse:null,timeoutMs:30000}),now=()=>Date.now(),deadlineMs=200000}={}){
 if(!canReadFinance(auth))return {};
 const inputSchema=objectSchema({year:{type:'integer',minimum:2000,maximum:2100},from:{type:'string',format:'date'},to:{type:'string',format:'date'},accountCodes:{type:'array',minItems:1,maxItems:40,items:{type:'string',minLength:1,maxLength:50}}},['year']);
 const execute=async(input,detail=false)=>{
  await requireFinanceAdmin(auth);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date(now()));
  const from=iso(input.from||`${input.year}-01-01`),to=iso(input.to||(`${input.year}-12-31`<today?`${input.year}-12-31`:today));
  if(from>to||from.slice(0,4)!==String(input.year)||to.slice(0,4)!==String(input.year))throw fail('Periodo non valido per l’esercizio richiesto.');
  const client=clientForYear(input.year),started=now(),help=await client.getJson('/help');
  if(hasCredentials(help))throw fail('Contratto contenente credenziali.',422);
  const capabilities=financeCatalog(help),sources=[];
  const collect=(path,fields)=>collectCashflowSource(client,{now,started,deadlineMs,capabilities,sources},path,fields);
  const chart=await collect('/conti','codice,ragione_sociale,bil_34dir_ue_d,bil_34dir_ue_a,bil_ivdir_cee_d,bil_ivdir_cee_a,id_banca');
  if(!chart.complete)throw fail('Piano dei conti non letto completamente: selezione conti non verificabile.',422);
  const candidates=chart.rows.filter(r=>[r.bil_34dir_ue_d,r.bil_ivdir_cee_d].some(v=>/^CIV[123]$/.test(String(v||'')))||/cassa|banc[ah]|c\/c|assegn/i.test(String(r.ragione_sociale||''))).map(r=>({code:r.codice,name:r.ragione_sociale,balanceDebitCode:r.bil_34dir_ue_d||r.bil_ivdir_cee_d||null,balanceCreditCode:r.bil_34dir_ue_a||r.bil_ivdir_cee_a||null,bankId:r.id_banca,selectionRequired:true}));
  const base={source:'Mexal WebAPI /conti e /prima-nota/righe',company:client.azienda,year:input.year,readOnly:true,saved:false,readAt:new Date(now()).toISOString(),period:{from,to},currency:{code:null,label:'Valuta contabile Mexal: denominazione non attestata da queste risorse'},officialFinancialStatement:false,bankReconciled:false};
  if(!input.accountCodes)return {...base,requiresAccountSelection:true,candidates,sources,instructions:'Selezionare i conti effettivamente liquidi dai codici e dalle descrizioni originali. Non includere automaticamente debiti bancari, interessi maturati, valori bollati o conti transitori. Nessuna modifica di configurazione è necessaria per questa selezione di analisi.'};
  const codes=[...new Set(input.accountCodes)];if([...codes,...(input.liquidAccountCodes||[])].some(c=>!chart.rows.some(r=>r.codice===c)))throw fail('Un conto selezionato non esiste nel piano dei conti corrente.',422);
  const journal=await collect('/prima-nota/righe','data_registr,progressivo,codice_conto,importo_riga,cau_contabile'+(detail?',descr_riga,nr_documento,data_documento':''));
  const groups=[];
  const result=cashflowMovements(journal.rows,codes,{from,to},detail?{onJournal:g=>groups.push(g)}:{});
  let details={};
  if(detail){
   let headers;
   if(capabilities.some(c=>new RegExp(c.pattern).test('/prima-nota')))headers=await collect('/prima-nota','data_registr,progressivo,cau_contabile,descrizione,nr_documento,nr_doc_str,data_documento');
   else{headers={rows:[],complete:false};sources.push({path:'/prima-nota',complete:false,reason:'Testate GET non pubblicate',pages:0,rows:0});}
   details=cashflowDetail({rows:journal.rows,chart:chart.rows,headers:headers.rows,groups,summary:result,input:{...input,from,to,company:client.azienda,principalId:auth.profile.id},sourceComplete:journal.complete,headersComplete:headers.complete});
  }
  return {...base,requiresAccountSelection:false,accounts:codes.map(code=>({code,name:chart.rows.find(r=>r.codice===code).ragione_sociale})),...result,...details,sources,complete:journal.complete&&result.invalidRows===0,openingBalance:null,closingBalance:null,method:'Somma esatta degli importi originali sui conti selezionati, compensati nella stessa registrazione (data/progressivo), poi per mese. Entrate e uscite sono nette per registrazione; AP, BA e CH escluse. Nessun ricalcolo di bilancio, margini o disponibilità bancaria.',limitations:['La prima nota non è un estratto conto bancario riconciliato. Scritture mancanti, rettifiche e conti esclusi possono modificare l’interpretazione.','Nessun saldo iniziale/finale verificato; la variazione non è il saldo disponibile.','Prospetto dei movimenti registrati, non rendiconto OIC né previsione da scadenziario.','Lettura paginata non transazionale; completezza significa esaurimento dei cursori, non riconciliazione della contabilità.']};
 };
 return {
  MEXAL_CASHFLOW_READ:{effect:'read',description:'Usare per cash flow/andamento di cassa Mexal su richiesta. Senza accountCodes legge il piano dei conti e propone candidati con codici/descrizioni originali; scegliere solo i conti liquidi appropriati e richiamare con accountCodes espliciti. Legge tutta la prima nota paginata e aggrega i movimenti firmati per registrazione e mese, senza memorizzare. Esclude AP/BA/CH; i trasferimenti tra conti selezionati si compensano. Prospetto analitico dei movimenti registrati, non rendiconto finanziario ufficiale, saldo bancario riconciliato o previsione. Segnalare sempre incompletezza, conti esclusi e valuta non verificata.',inputSchema,execute:input=>execute(input)},
  MEXAL_CASHFLOW_DETAIL_READ:{effect:'read',description:'Analizza in sola lettura la prima nota Mexal per anno/intervallo e accountCodes espliciti. Riusa calcolo e cursori MEXAL_CASHFLOW_READ: data+progressivo, righe selezionate, contropartite e descrizioni originali; AP/BA/CH separati. Per riconoscere giroconti fuori dal perimetro fornire liquidAccountCodes verificati esplicitamente. Maggiori uscite nette per registrazione, categorie solo come conti contropartita univoci attestati; beneficiari non dedotti. Totali completi distinti dalla pagina. Seguire nextOffset con snapshot; nessun saldo bancario riconciliato o valuta attestata.',inputSchema:objectSchema({...inputSchema.properties,liquidAccountCodes:inputSchema.properties.accountCodes,offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:50},snapshot:{type:'string',pattern:'^[a-f0-9]{64}$'},expectedNetMovement:{type:'string',pattern:'^-?[0-9]+(?:\\.[0-9]{1,6})?$'},topLimit:{type:'integer',minimum:1,maximum:30}},['year','accountCodes']),execute:input=>execute(input,true)}
 };
}
