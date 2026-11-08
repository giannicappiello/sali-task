import {createHash} from 'node:crypto';
import {buildMexalClient} from '../mexal/sync-products.js';
import {canReadFinance,requireFinanceAdmin,financeCatalog,checkedFinancePath} from './mexal-finance.js';
import {hasCredentials} from './credential-guard.js';
import {objectSchema,validateInput} from './schema.js';
import {cashAmount,iso,money} from './mexal-cashflow-core.js';

const fail=(message,status=422)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceFields={
 '/conti':'codice,ragione_sociale,bil_34dir_ue_d,bil_34dir_ue_a',
 '/prima-nota':'data_registr,progressivo,cau_contabile',
 '/prima-nota/righe':'data_registr,progressivo,cau_contabile,codice_conto,importo_riga',
};
const labels={A1:'Ricavi vendite e prestazioni',A2:'Variazione rimanenze prodotti',A3:'Variazione lavori in corso',A4:'Incrementi immobilizzazioni per lavori interni',A5:'Altri ricavi e proventi',B6:'Materie prime, sussidiarie, consumo e merci',B7:'Servizi',B8:'Godimento beni di terzi',B9:'Personale',B10:'Ammortamenti e svalutazioni',B11:'Variazione rimanenze materie e merci',B12:'Accantonamenti rischi',B13:'Altri accantonamenti',B14:'Oneri diversi gestione',C15:'Proventi partecipazioni',C16:'Altri proventi finanziari',C17:'Interessi e altri oneri finanziari',C17BIS:'Utili/perdite cambi',D18:'Rivalutazioni finanziarie',D19:'Svalutazioni finanziarie','20':'Imposte sul reddito'};
// Only the current UE assignments supplied by Mexal are used. Account names,
// account-number prefixes and obsolete CEE assignments are never classifiers.
export function economicClass(value){
 const code=String(value||'').trim().toUpperCase();
 const match=/^(A[1-5]|B(?:1[0-4]|[6-9])|C(?:17BIS|1[5-7])|D1[89]|20)(?:[A-Z][A-Z0-9]*)?$/.exec(code);
 if(match)return {kind:'economic',code,group:match[1]};
 if(/^(?:A(?:I|II|III|IV|V|VI|VII|VIII|IX|X)[A-Z0-9]*|B(?:I|II|III)[A-Z0-9]*|B[1-4]|C(?:I|II|III|IV)[A-Z0-9]*|C|D(?:[1-9]|1[0-4])[AB]?|D|E)$/.test(code))return {kind:'balanceSheet',code};
 return {kind:'unknown',code:code||null};
}
const cause=r=>String(r.cau_contabile||'').trim().toUpperCase();
const journalKey=r=>{
 const date=iso(r.data_registr);
 if(!Number.isSafeInteger(r.progressivo)||r.progressivo<1||!date)throw fail('Identificativo registrazione non valido.');
 // GRE publishes custom numeric causes (e.g. "24") as well as fixed letters.
 // Their original code is compared with the header; no meaning is inferred.
 if(!/^[A-Z0-9]{2}$/.test(cause(r)))throw fail('Causale non attestata.');
 return date+'|'+r.progressivo;
};

export async function collectIncomeSource(client,path,{capabilities,sources,now,started,deadlineMs}){
 const cap=capabilities.find(c=>{try{return new RegExp(c.pattern).test(path);}catch{return false;}});
 const rows=[],pagesSeen=new Set(),cursors=new Set();let complete=false,reason=null,next=null,pages=0;
 if(!cap)reason='Risorsa GET non pubblicata';
 else {
  checkedFinancePath(path,cap);
  while(pages<2000&&rows.length<1000000){
   if(now()-started>=deadlineMs){reason='Budget di lettura esaurito';break;}
   const q=new URLSearchParams({max:'1000',fields:sourceFields[path]});if(next)q.set('next',next);
   let payload;try{payload=await client.getJson(path+'?'+q);}catch{reason='Lettura origine interrotta';break;}
   if(hasCredentials(payload))throw fail('Risposta origine non esportabile.');
   const page=Array.isArray(payload)?payload:payload?.dati;
   if(!Array.isArray(page)||page.some(r=>!r||typeof r!=='object'||Array.isArray(r))){reason='Formato collezione non attestato';break;}
   const digest=hash(page);if(pagesSeen.has(digest)){reason='Pagina origine ripetuta';break;}pagesSeen.add(digest);
   if(rows.length+page.length>1000000){reason='Limite righe raggiunto';break;}
   rows.push(...page);pages++;
   const cursor=Array.isArray(payload)?null:payload.next;
   if(cursor===null||cursor===undefined||cursor===''){complete=true;break;}
   if(typeof cursor!=='string'||cursor.length>4000||cursors.has(cursor)){reason='Cursore non valido o ripetuto';break;}
   cursors.add(cursor);next=cursor;
  }
 }
 sources.push({path,fields:sourceFields[path],pages,rows:rows.length,complete,reason:reason||(!complete?'Limite pagine o righe raggiunto':null),snapshot:hash(rows)});
 return {rows,complete};
}

export function incomeStatement({chart,journal,headers,period,sources,principalId,company,input}){
 const accounts=new Map(),duplicateAccounts=new Set(),groups=new Map(),head=new Map();
 const counts={invalidRows:0,invalidHeaders:0,duplicateHeaders:0,missingHeaders:0,headersWithoutRows:0,inconsistentCauses:0,unbalancedJournals:0,outsidePeriodRows:0,excludedAPCHRows:0,retainedBARows:0,unknownAccounts:0};
 for(const r of chart.rows){if(typeof r.codice!=='string'||!r.codice){counts.invalidRows++;continue;}if(accounts.has(r.codice))duplicateAccounts.add(r.codice);accounts.set(r.codice,r);}
 for(const r of headers.rows){try{const key=journalKey(r);if(head.has(key))counts.duplicateHeaders++;head.set(key,cause(r));}catch{counts.invalidHeaders++;}}
 for(const r of journal.rows){
  try{
   const key=journalKey(r),amount=cashAmount(r.importo_riga);
   if(typeof r.codice_conto!=='string'||!r.codice_conto)throw fail('Conto mancante.');
   const g=groups.get(key)||{date:iso(r.data_registr),cause:cause(r),sum:0n,rows:[]};
   if(g.cause!==cause(r))counts.inconsistentCauses++;
   g.sum+=amount;g.rows.push({...r,amount});groups.set(key,g);
  }catch{counts.invalidRows++;}
 }
 for(const [key,g] of groups){if(!head.has(key))counts.missingHeaders++;else if(head.get(key)!==g.cause)counts.inconsistentCauses++;if(g.sum!==0n)counts.unbalancedJournals++;}
 for(const key of head.keys())if(!groups.has(key))counts.headersWithoutRows++;
 const net=new Map();
 let firstPostingDate=null,lastPostingDate=null;
 for(const g of groups.values()){
  if(g.date<period.from||g.date>period.to){counts.outsidePeriodRows+=g.rows.length;continue;}
  // BA is an adjustment and must remain. CH/AP are closing/opening transfers.
  if(['AP','CH'].includes(g.cause)){counts.excludedAPCHRows+=g.rows.length;continue;}
  if(!firstPostingDate||g.date<firstPostingDate)firstPostingDate=g.date;
  if(!lastPostingDate||g.date>lastPostingDate)lastPostingDate=g.date;
  if(g.cause==='BA')counts.retainedBARows+=g.rows.length;
  for(const r of g.rows){const a=net.get(r.codice_conto)||{amount:0n,rows:0};a.amount+=r.amount;a.rows++;net.set(r.codice_conto,a);}
 }
 const buckets=new Map(),details=[];
 for(const [code,a] of net){
  const account=accounts.get(code);
  // A missing opposite-side code reuses the sole assignment for reversals;
  // two assignments use the sign of the account's period net balance.
  const debit=account?.bil_34dir_ue_d,credit=account?.bil_34dir_ue_a;
  const classification=duplicateAccounts.has(code)?{kind:'unknown',code:null}:economicClass(a.amount<0n?(credit||debit):(debit||credit));
  if(classification.kind==='unknown')counts.unknownAccounts++;
  if(classification.kind==='economic'){
   const b=buckets.get(classification.group)||{amount:0n,rows:0,accounts:0};b.amount+=a.amount;b.rows+=a.rows;b.accounts++;buckets.set(classification.group,b);
  }
  details.push({code,name:account?.ragione_sociale||null,classification,debitUE:debit||null,creditUE:credit||null,registeredNetDebit:money(a.amount),rows:a.rows});
 }
 details.sort((a,b)=>a.code.localeCompare(b.code));
 const cursorsExhausted=chart.complete&&journal.complete&&headers.complete;
 const reconciliationOK=cursorsExhausted&&!duplicateAccounts.size&&['invalidRows','invalidHeaders','duplicateHeaders','missingHeaders','headersWithoutRows','inconsistentCauses','unbalancedJournals'].every(k=>counts[k]===0);
 const recordedCoverageComplete=reconciliationOK&&counts.unknownAccounts===0;
 const observed=key=>{
  const b=buckets.get(key);if(!b)return null;
  return money((key.startsWith('A')||['C15','C16','D18'].includes(key)?-1n:1n)*b.amount);
 };
 const metric=key=>({amount:null,registeredAmount:recordedCoverageComplete?observed(key):null,observedClassifiedSubtotal:observed(key),classification:key,registeredRows:buckets.get(key)?.rows||0,accrualAttested:false,source:['/conti','/prima-nota/righe'],basis:'Data registrazione; nessuna imputazione automatica per competenza'});
 const snapshot=hash({principalId,company,period,sources});
 if(input.snapshot&&input.snapshot!==snapshot)throw fail('Fonti o periodo cambiati: ricominciare da offset zero.',409);
 const offset=input.offset||0,limit=input.limit||50;
 if(offset>0&&!input.snapshot)throw fail('Paginazione dettagli richiede snapshot.',400);
 const operating=[...buckets].filter(([key])=>/^[AB]/.test(key));
 const registeredDifference=recordedCoverageComplete&&operating.length?money(-operating.reduce((n,[,b])=>n+b.amount,0n)):null;
 return {
  complete:false,recordedCoverageComplete,officialFinancialStatement:false,
  ricavi:metric('A1'),altriRicavi:metric('A5'),costiPerNatura:Object.keys(labels).filter(k=>k.startsWith('B')).map(key=>({label:labels[key],...metric(key)})),
  EBITDA:{amount:null,reason:'Competenza, rettifiche e perimetro EBITDA non attestati; nessun EBITDA dedotto dai soli movimenti.'},
  EBIT:{amount:null,reason:'Competenza, rimanenze e ammortamenti completi non attestati.'},
  anteImposte:{amount:null,reason:'Rettifiche e componenti finanziarie per competenza non riconciliati con un bilancio ufficiale.'},
  registeredComponents:Object.keys(labels).map(key=>({label:labels[key],...metric(key)})),
  registeredOperatingDifference:{amount:registeredDifference,label:'Differenza A-B delle sole registrazioni classificate, non EBIT per competenza'},
  rimanenze:{opening:null,closing:null,valuationMethod:null,registeredVariations:{A2:metric('A2'),B11:metric('B11')},reason:'Le variazioni registrate non attestano saldi e valorizzazione iniziale/finale.'},
  ammortamenti:{amount:null,registeredDepreciationAndImpairments:metric('B10'),reason:'B10 comprende svalutazioni; cespiti ed extracontabili non pubblicati da questo contratto.'},
  coverage:{cursorsExhausted,recordedCoverageComplete,firstPostingDate,lastPostingDate,accrual:false,extracontabili:false,inventoryValuation:false,depreciationCompleteness:false,transactionalSnapshot:false,...counts,duplicateAccounts:duplicateAccounts.size},
  reconciliation:{journalBalanceAndHeaderCoverage:reconciliationOK,officialStatement:null,officialDifference:null,classificationComplete:counts.unknownAccounts===0,method:'Quadratura dare/avere per data e progressivo, confronto testate/righe e codici UE correnti. Nessun confronto con saldi ufficiali disponibili.'},
  accounts:details.slice(offset,offset+limit),pagination:{offset,limit,total:details.length,nextOffset:offset+limit<details.length?offset+limit:null,snapshot},
  limitations:[
   'amount=null significa risultato per competenza non attestabile. registeredAmount riguarda solo le registrazioni; observedClassifiedSubtotal è un subtotale diagnostico e può essere parziale.',
   'Nessuna classificazione da descrizioni o prefissi conti. Codici UE assenti, sconosciuti o conti mancanti bloccano i totali registrati; codici CEE storici non sostituiscono UE.',
   'Conti patrimoniali, inclusa IVA, esclusi dagli aggregati economici. IVA indetraibile già contabilizzata a costo non viene sottratta una seconda volta.',
   'AP e CH escluse, BA mantenute. Date documento e pagamento non sostituiscono competenza; nessuna ripartizione o rettifica inventata.',
   'Letture paginate non transazionali: esaurimento cursori e quadratura non attestano registrazioni mancanti, definitività, competenza o saldi iniziali. Lo snapshot controlla la rilettura dei dettagli, non blocca Mexal.',
  ],sources,
 };
}

export function mexalIncomeStatementTools(auth,{clientForYear=year=>buildMexalClient({year,warehouse:null,timeoutMs:30000}),now=()=>Date.now(),deadlineMs=200000}={}){
 if(!canReadFinance(auth))return {};
 const inputSchema=objectSchema({year:{type:'integer',minimum:2000,maximum:2100},from:{type:'string',format:'date'},to:{type:'string',format:'date'},offset:{type:'integer',minimum:0,maximum:1000000},limit:{type:'integer',minimum:1,maximum:100},snapshot:{type:'string',pattern:'^[a-f0-9]{64}$'}});
 return {MEXAL_CONTO_ECONOMICO_READ:{effect:'read',inputSchema,description:'Conto economico Mexal GRE in sola lettura, periodo selezionabile (default 2026-01-01–2026-10-31). Solo Mexal, nessun MES. Verifica admin personale live e scope tutti, catalogo GET, paginazione, quadratura e codici UE. Distingue subtotali registrati da competenza: EBITDA, EBIT, ante imposte, rimanenze e valori non attestabili restano null. Segnalare copertura, riconciliazione e limiti; dettagli paginati con snapshot.',execute:async input=>{
  await requireFinanceAdmin(auth);validateInput(inputSchema,input);
  const year=input.year??(input.from?Number(input.from.slice(0,4)):2026);
  const from=iso(input.from||`${year}-01-01`),to=iso(input.to||(year===2026?'2026-10-31':`${year}-12-31`));
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date(now()));
  if(from>to||from.slice(0,4)!==String(year)||to.slice(0,4)!==String(year)||to>today)throw fail('Periodo non valido, futuro o fuori esercizio.',400);
  if((input.offset||0)>0&&!input.snapshot)throw fail('Paginazione dettagli richiede snapshot.',400);
  const client=clientForYear(year);if(client.azienda!=='GRE')throw fail('Connessione azienda Progre GRE non verificata.');
  const started=now(),help=await client.getJson('/help');if(hasCredentials(help))throw fail('Contratto origine non esportabile.');
  const capabilities=financeCatalog(help),sources=[];
  const officialCandidates=capabilities.filter(c=>/bilanc|conto[-_ /]?economic|sald[io]/i.test(c.pattern+' '+c.description));
  // No official balance/report route is published by GRE as verified on 2026-11-08.
  // A future route requires a verified response/period adapter, never a guessed URL.
  const collect=path=>collectIncomeSource(client,path,{capabilities,sources,now,started,deadlineMs});
  const chart=await collect('/conti'),journal=await collect('/prima-nota/righe'),headers=await collect('/prima-nota');
  return {source:'Mexal WebAPI',company:client.azienda,year,period:{from,to},readAt:new Date(now()).toISOString(),readOnly:true,saved:false,currency:{code:null,attested:false},
   officialEndpoint:{available:officialCandidates.length>0,used:false,candidates:officialCandidates,reason:officialCandidates.length?'Risorsa potenziale rilevata: adattatore di periodo e schema non verificato; nessun valore ufficiale dedotto.':'Nessun endpoint GET di bilancio/saldi pubblicato nel catalogo live.'},
   ...incomeStatement({chart,journal,headers,period:{from,to},sources,principalId:auth.profile.id,company:client.azienda,input})};
 }}};
}
