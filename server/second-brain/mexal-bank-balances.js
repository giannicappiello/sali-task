import {buildMexalClient} from '../mexal/sync-products.js';
import {canReadFinance,requireFinanceAdmin,financeCatalog} from './mexal-finance.js';
import {hasCredentials} from './credential-guard.js';
import {objectSchema} from './schema.js';
import {collectCashflowSource} from './mexal-cashflow.js';
import {cashAmount,cashflowMovements,iso,money} from './mexal-cashflow-core.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const cause=row=>String(row.cau_contabile||'').trim().toUpperCase();
export const openingDocumentation='https://www.edupass.it/manuali/manualistica-mexal/manuale-prodotto?a=manuale-prodotto/contabilita/stampe-contabili/bilanci/bilancio-di-verifica';

// An AP is evidence of a recorded opening, never proof of a reconciled bank balance.
// Absence of AP is deliberately not interpreted as an opening of zero.
export function bankBalances({rows,chart,codes,year,asOf,complete,readAt,sources}) {
 const from=`${year}-01-01`,period={from,to:asOf};
 const summary=cashflowMovements(rows,codes,period);
 const accounts=codes.map(code=>{
  const account=chart.find(r=>r.codice===code),selected=rows.filter(r=>String(r.codice_conto)===code);
  const openings=selected.filter(r=>cause(r)==='AP');
  const reasons=[],evidence=[];let opening=0n;
  if(!complete)reasons.push('Prima nota non esaurita: base iniziale non attestabile.');
  if(!openings.length)reasons.push('Nessuna scrittura AP per il conto: saldo iniziale sconosciuto, non zero.');
  for(const row of openings){
   try{
    const date=iso(row.data_registr);
    if(date!==from)throw fail('AP con data diversa dal 1 gennaio: competenza iniziale non attestata.');
    if(!Number.isSafeInteger(row.progressivo)||row.progressivo<1)throw fail('Progressivo AP non valido.');
    const journal=rows.filter(r=>String(r.data_registr)===String(row.data_registr)&&r.progressivo===row.progressivo);
    if(journal.some(r=>cause(r)!=='AP')||journal.reduce((n,r)=>n+cashAmount(r.importo_riga),0n)!==0n)throw fail('Scrittura AP non bilanciata o causali incoerenti.');
    const amount=cashAmount(row.importo_riga);opening+=amount;
    evidence.push({path:'/prima-nota/righe',date,progressivo:row.progressivo,cause:'AP',amount:money(amount)});
   }catch(error){reasons.push(error.message);}
  }
  const movement=cashflowMovements(rows,[code],period);
  // BA/CH are excluded by cashflow: never silently present their omission as an accounting balance.
  const special=selected.filter(r=>['BA','CH'].includes(cause(r)));
  let excludedAccountingRows=0;
  for(const row of special){try{if(iso(row.data_registr)<=asOf)excludedAccountingRows++;}catch{excludedAccountingRows++;}}
  if(excludedAccountingRows)reasons.push('BA/CH presenti entro la data: rettifiche non coperte dal prospetto cashflow.');
  const openingKnown=complete&&openings.length>0&&evidence.length===openings.length&&reasons.every(r=>r.startsWith('BA/CH'));
  const finalKnown=openingKnown&&excludedAccountingRows===0&&movement.invalidRows===0;
  if(movement.invalidRows)reasons.push('Righe di movimento non interpretabili.');
  const configuredFacilities={};
  for(const field of ['fido_scoperto','fido_castel_eff'])if(account[field]!==undefined&&account[field]!==null){
   try{configuredFacilities[field]={amount:money(cashAmount(account[field])),source:'/conti',field,readAt,validAt:null,historicalValidityVerified:false};}catch{/* Preserve missing/invalid as unavailable. */}
  }
  return {code,name:account.ragione_sociale||null,currency:{code:null,valueDate:null},
   openingBalance:{amount:openingKnown?money(opening):null,date:from,kind:'recordedAccountingOpening',source:evidence,attested:openingKnown},
   movements:{...movement.totals,complete:complete&&movement.invalidRows===0,period,source:'/prima-nota/righe',method:'MEXAL_CASHFLOW_READ / cashflowMovements; AP/BA/CH escluse'},
   closingBalance:{amount:finalKnown?money(opening+cashAmount(movement.totals.netMovement)):null,date:asOf,kind:'derivedAccountingBalance',method:'Saldo AP attestato + variazione del motore MEXAL_CASHFLOW_READ',source:['/prima-nota/righe'],complete:finalKnown},
   bankReconciledBalance:null,availableBalance:null,bankReconciled:false,exposure:null,creditFacilitiesAtDate:null,configuredFacilities,
   completeness:{opening:openingKnown,movements:complete&&movement.invalidRows===0,closing:finalKnown,bankReconciliation:false,reasons},excludedAccountingRows};
 });
 return {readOnly:true,saved:false,year,period,readAt,accounts,complete:accounts.every(a=>a.completeness.closing),movementSummary:summary,sources,
  source:'Mexal WebAPI /conti e /prima-nota/righe',openingDocumentation,
  limitations:['Saldo contabile derivato da apertura registrata, non saldo bancario riconciliato o disponibile. AP assente non equivale a zero.',
   'Validità storica e data valuta degli affidamenti non attestate: i campi anagrafici sono configurazioni lette ora, non disponibilità alla data.',
   'Solo aperture AP bilanciate al 1 gennaio; esercizi non solari e AP su altre date richiedono una fonte ufficiale aggiuntiva.',
   'Lettura paginata non transazionale; esaurire i cursori non prova correttezza contabile, definitività delle aperture o riconciliazione bancaria.',
   'Valuta monetaria e date valuta non attestate da queste risorse. Nessuna conversione o previsione.']};
}

export function mexalBankBalanceTools(auth,{clientForYear=year=>buildMexalClient({year,warehouse:null,timeoutMs:30000}),now=()=>Date.now(),deadlineMs=200000}={}){
 if(!canReadFinance(auth))return {};
 return {MEXAL_BANK_BALANCES_READ:{effect:'read',description:'Legge saldi contabili per conti bancari espliciti: apertura AP al 1 gennaio solo se verificabile, variazioni con il motore MEXAL_CASHFLOW_READ e saldo finale derivato solo con base attestata. Nessuna AP non significa zero. Saldi riconciliati/disponibili ed esposizione restano null; eventuali fidi anagrafici hanno validità storica non verificata. Nessuna scrittura. Verificare completezza e fonti per conto.',
  inputSchema:objectSchema({year:{type:'integer',minimum:2000,maximum:2100},asOf:{type:'string',format:'date'},accountCodes:{type:'array',minItems:1,maxItems:40,uniqueItems:true,items:{type:'string',minLength:1,maxLength:50}}},['year','accountCodes']),
  execute:async input=>{
   await requireFinanceAdmin(auth);
   const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date(now()));
   const asOf=iso(input.asOf||(`${input.year}-12-31`<today?`${input.year}-12-31`:today));
   if(!Number.isInteger(input.year)||input.year<2000||input.year>2100||asOf.slice(0,4)!==String(input.year)||asOf>today)throw fail('Data non valida per l’esercizio o futura.');
   if(!Array.isArray(input.accountCodes)||input.accountCodes.length<1||input.accountCodes.length>40)throw fail('Selezionare conti bancari espliciti.');
   const codes=[...new Set(input.accountCodes)],client=clientForYear(input.year),started=now();
   const help=await client.getJson('/help');if(hasCredentials(help))throw fail('Contratto contenente credenziali.',422);
   const capabilities=financeCatalog(help),sources=[];
   const collect=(path,fields)=>collectCashflowSource(client,{now,started,deadlineMs,capabilities,sources},path,fields);
   const chart=await collect('/conti','codice,ragione_sociale,bil_34dir_ue_d,bil_ivdir_cee_d,id_banca,fido_scoperto,fido_castel_eff');
   if(!chart.complete)throw fail('Piano dei conti incompleto.',422);
   for(const code of codes){const matches=chart.rows.filter(r=>r.codice===code);if(matches.length!==1||![matches[0].bil_34dir_ue_d,matches[0].bil_ivdir_cee_d].includes('CIV1'))throw fail('Conto bancario non verificato univocamente nel piano corrente.',422);}
   const journal=await collect('/prima-nota/righe','data_registr,progressivo,codice_conto,importo_riga,cau_contabile');
   return {company:client.azienda,...bankBalances({rows:journal.rows,chart:chart.rows,codes,year:input.year,asOf,complete:journal.complete,readAt:new Date(now()).toISOString(),sources})};
  }}};
}
