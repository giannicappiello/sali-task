import {createHash} from 'node:crypto';
import {buildMexalClient} from '../mexal/sync-products.js';
import {canReadFinance,requireFinanceAdmin,financeCatalog,checkedFinancePath} from './mexal-finance.js';
import {hasCredentials} from './credential-guard.js';
import {objectSchema} from './schema.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso=value=>{const s=String(value||'');const date=/^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`:s;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw fail('Data contabile non valida.',422);return date;};
export function cashAmount(value){
 const s=String(value);if(!/^-?\d+(?:\.\d{1,6})?$/.test(s))throw fail('Importo contabile non interpretabile senza arrotondamento.',422);
 const [whole,fraction='']=s.replace(/^-/,'').split('.');return (s.startsWith('-')?-1n:1n)*(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0')));
}
const money=value=>{const n=value<0n?-value:value;let f=(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'');f=f.padEnd(2,'0');return `${value<0n?'-':''}${n/1000000n}.${f}`;};
export function cashflowMovements(rows,accountCodes,{from,to}){
 const selected=new Set(accountCodes),groups=new Map(),accounts=new Map(accountCodes.map(code=>[code,0n]));
 let selectedRows=0,excludedOpeningClosingRows=0,invalidRows=0,outsidePeriodRows=0,lastPostingDate=null;
 for(const row of rows){
  if(!selected.has(String(row.codice_conto)))continue;
  try{
   const date=iso(row.data_registr);if(date<from||date>to){outsidePeriodRows++;continue;}
   if(['AP','BA','CH'].includes(String(row.cau_contabile).trim().toUpperCase())){excludedOpeningClosingRows++;continue;}
   if(!Number.isSafeInteger(row.progressivo)||row.progressivo<1)throw fail('Identificativo registrazione mancante.',422);
   const amount=cashAmount(row.importo_riga),key=date+'|'+row.progressivo;
   const group=groups.get(key)||{date,amount:0n,positive:false,negative:false};group.amount+=amount;group.positive||=amount>0n;group.negative||=amount<0n;groups.set(key,group);
   accounts.set(String(row.codice_conto),accounts.get(String(row.codice_conto))+amount);selectedRows++;if(!lastPostingDate||date>lastPostingDate)lastPostingDate=date;
  }catch{invalidRows++;}
 }
 const months=new Map();for(let year=Number(from.slice(0,4)),month=Number(from.slice(5,7));`${year}-${String(month).padStart(2,'0')}`<=to.slice(0,7);){months.set(`${year}-${String(month).padStart(2,'0')}`,{inflow:0n,outflow:0n,net:0n,journals:0});month++;if(month===13){month=1;year++;}}
 let inflow=0n,outflow=0n,net=0n,internalNetZeroJournals=0;
 for(const g of groups.values()){
  const m=months.get(g.date.slice(0,7));m.journals++;m.net+=g.amount;net+=g.amount;
  if(g.amount>0n){m.inflow+=g.amount;inflow+=g.amount;}else if(g.amount<0n){m.outflow-=g.amount;outflow-=g.amount;}else if(g.positive&&g.negative)internalNetZeroJournals++;
 }
 return {months:[...months].map(([month,m])=>({month,inflow:money(m.inflow),outflow:money(m.outflow),netMovement:money(m.net),journals:m.journals})),totals:{inflow:money(inflow),outflow:money(outflow),netMovement:money(net)},accountMovements:[...accounts].map(([code,n])=>({code,netMovement:money(n)})),selectedRows,journals:groups.size,internalNetZeroJournals,excludedOpeningClosingRows,invalidRows,outsidePeriodRows,lastPostingDate};
}
export function mexalCashflowTools(auth,{clientForYear=year=>buildMexalClient({year,warehouse:null,timeoutMs:30000}),now=()=>Date.now(),deadlineMs=200000}={}){
 if(!canReadFinance(auth))return {};
 return {MEXAL_CASHFLOW_READ:{effect:'read',description:'Usare per cash flow/andamento di cassa Mexal su richiesta. Senza accountCodes legge il piano dei conti e propone candidati con codici/descrizioni originali; scegliere solo i conti liquidi appropriati e richiamare con accountCodes espliciti. Legge tutta la prima nota paginata e aggrega i movimenti firmati per registrazione e mese, senza memorizzare. Esclude AP/BA/CH; i trasferimenti tra conti selezionati si compensano. Prospetto analitico dei movimenti registrati, non rendiconto finanziario ufficiale, saldo bancario riconciliato o previsione. Segnalare sempre incompletezza, conti esclusi e valuta non verificata.',inputSchema:objectSchema({year:{type:'integer',minimum:2000,maximum:2100},from:{type:'string',format:'date'},to:{type:'string',format:'date'},accountCodes:{type:'array',minItems:1,maxItems:40,items:{type:'string',minLength:1,maxLength:50}}},['year']),execute:async input=>{
  await requireFinanceAdmin(auth);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date(now()));
  const from=iso(input.from||`${input.year}-01-01`),to=iso(input.to||(`${input.year}-12-31`<today?`${input.year}-12-31`:today));
  if(from>to||from.slice(0,4)!==String(input.year)||to.slice(0,4)!==String(input.year))throw fail('Periodo non valido per l’esercizio richiesto.');
  const client=clientForYear(input.year),started=now(),help=await client.getJson('/help');
  if(hasCredentials(help))throw fail('Contratto contenente credenziali.',422);
  const capabilities=financeCatalog(help),sources=[];
  async function collect(path,fields){
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
  const chart=await collect('/conti','codice,ragione_sociale,bil_34dir_ue_d,bil_34dir_ue_a,bil_ivdir_cee_d,bil_ivdir_cee_a,id_banca');
  if(!chart.complete)throw fail('Piano dei conti non letto completamente: selezione conti non verificabile.',422);
  const candidates=chart.rows.filter(r=>[r.bil_34dir_ue_d,r.bil_ivdir_cee_d].some(v=>/^CIV[123]$/.test(String(v||'')))||/cassa|banc[ah]|c\/c|assegn/i.test(String(r.ragione_sociale||''))).map(r=>({code:r.codice,name:r.ragione_sociale,balanceDebitCode:r.bil_34dir_ue_d||r.bil_ivdir_cee_d||null,balanceCreditCode:r.bil_34dir_ue_a||r.bil_ivdir_cee_a||null,bankId:r.id_banca,selectionRequired:true}));
  const base={source:'Mexal WebAPI /conti e /prima-nota/righe',company:client.azienda,year:input.year,readOnly:true,saved:false,readAt:new Date(now()).toISOString(),period:{from,to},currency:{code:null,label:'Valuta contabile Mexal: denominazione non attestata da queste risorse'},officialFinancialStatement:false,bankReconciled:false};
  if(!input.accountCodes)return {...base,requiresAccountSelection:true,candidates,sources,instructions:'Selezionare i conti effettivamente liquidi dai codici e dalle descrizioni originali. Non includere automaticamente debiti bancari, interessi maturati, valori bollati o conti transitori. Nessuna modifica di configurazione è necessaria per questa selezione di analisi.'};
  const codes=[...new Set(input.accountCodes)];if(codes.some(c=>!chart.rows.some(r=>r.codice===c)))throw fail('Un conto selezionato non esiste nel piano dei conti corrente.',422);
  const journal=await collect('/prima-nota/righe','data_registr,progressivo,codice_conto,importo_riga,cau_contabile');
  const result=cashflowMovements(journal.rows,codes,{from,to});
  return {...base,requiresAccountSelection:false,accounts:codes.map(code=>({code,name:chart.rows.find(r=>r.codice===code).ragione_sociale})),...result,sources,complete:journal.complete&&result.invalidRows===0,openingBalance:null,closingBalance:null,method:'Somma esatta degli importi originali sui conti selezionati, compensati nella stessa registrazione (data/progressivo), poi per mese. Entrate e uscite sono nette per registrazione; AP, BA e CH escluse. Nessun ricalcolo di bilancio, margini o disponibilità bancaria.',limitations:['La prima nota non è un estratto conto bancario riconciliato. Scritture mancanti, rettifiche e conti esclusi possono modificare l’interpretazione.','Nessun saldo iniziale/finale verificato; la variazione non è il saldo disponibile.','Prospetto dei movimenti registrati, non rendiconto OIC né previsione da scadenziario.','Lettura paginata non transazionale; completezza significa esaurimento dei cursori, non riconciliazione della contabilità.']};
 }}};
}
