import {createHash} from 'node:crypto';
import {cashAmount,iso,money} from './mexal-cashflow-core.js';
const excluded=new Set(['AP','BA','CH']);
const cause=row=>String(row.cau_contabile||'').trim().toUpperCase();
const identity=row=>{const date=iso(row.data_registr);if(!Number.isSafeInteger(row.progressivo)||row.progressivo<1)throw Error('Identità non valida');return date+'|'+row.progressivo;};
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const sum=values=>values.reduce((a,b)=>a+b,0n);

// An explanatory projection of the official cashflow groups, never a second
// cashflow calculation. A counterparty account is not proof of a beneficiary.
export function cashflowDetail({rows,chart,headers,groups,summary,input,sourceComplete,headersComplete}){
 const selected=new Set(input.accountCodes),liquid=new Set([...selected,...(input.liquidAccountCodes||[])]);
 const names=new Map(),labels=new Map();
 for(const row of chart){const code=String(row.codice);if(!labels.has(code))labels.set(code,new Set());labels.get(code).add(row.ragione_sociale||null);}
 for(const [code,values] of labels)names.set(code,values.size===1?[...values][0]:null);
 const all=new Map(),head=new Map();let invalidContextRows=0;
 const exclusions=new Map(['AP','BA','CH'].map(c=>[c,{cause:c,rows:0,journals:new Set(),amount:0n,invalidAmounts:0}]));
 for(const row of rows){
  let key;
  try{key=identity(row);}catch{invalidContextRows++;continue;}
  const date=key.slice(0,10);if(date<input.from||date>input.to)continue;
  if(!all.has(key))all.set(key,[]);all.get(key).push(row);
  if(selected.has(String(row.codice_conto))&&excluded.has(cause(row))){
   const e=exclusions.get(cause(row));e.rows++;e.journals.add(key);
   try{e.amount+=cashAmount(row.importo_riga);}catch{e.invalidAmounts++;}
  }
 }
 for(const row of headers){try{const key=identity(row);if(!head.has(key))head.set(key,[]);head.get(key).push(row);}catch{invalidContextRows++;}}
 const projected=row=>({accountCode:String(row.codice_conto||''),accountName:names.get(String(row.codice_conto))||null,amount:(()=>{try{return money(cashAmount(row.importo_riga));}catch{return null;}})(),cause:cause(row),description:typeof row.descr_riga==='string'?row.descr_riga:null,documentNumber:row.nr_documento??null,documentDate:row.data_documento||null});
 let unclassified=0n,internalOutflow=0n,invalidJournals=0;
 const categories=new Map();
 const movements=groups.map(g=>{
  const lines=all.get(g.key)||[],other=lines.filter(r=>!selected.has(String(r.codice_conto))),h=head.get(g.key)||[];
  let balance=null;try{balance=sum(lines.map(r=>cashAmount(r.importo_riga)));}catch{ /* keep unknown, never zero */ }
  const causes=[...new Set(lines.map(cause))];
  const balanced=sourceComplete&&invalidContextRows===0&&balance===0n;
  const consistent=causes.length===1&&!excluded.has(causes[0]);
  const amountOf=r=>cashAmount(r.importo_riga);
  const nonzero=balance===null?[]:lines.filter(r=>amountOf(r)!==0n);
  const internal=balanced&&consistent&&nonzero.length>1&&nonzero.every(r=>liquid.has(String(r.codice_conto)))&&nonzero.some(r=>amountOf(r)>0n)&&nonzero.some(r=>amountOf(r)<0n);
  const complete=balanced&&consistent;
  if(!complete)invalidJournals++;
  const outflow=g.amount<0n?-g.amount:0n;
  const counterCodes=[...new Set(other.filter(r=>{try{return amountOf(r)!==0n;}catch{return true;}}).map(r=>String(r.codice_conto)))];
  // Only an unambiguous balanced one-sided entry can attribute its entire net
  // outflow to one original account. No proportional splits or text guessing.
  const category=outflow>0n&&!internal&&complete&&counterCodes.length===1&&names.get(counterCodes[0])&&g.rows.every(r=>amountOf(r)<=0n)&&other.every(r=>amountOf(r)>=0n)?{code:counterCodes[0],name:names.get(counterCodes[0]),basis:'Conto contropartita originale univoco; non categoria economica dedotta'}:null;
  if(outflow>0n){
   if(internal)internalOutflow+=outflow;
   else if(category){const c=categories.get(category.code)||{...category,amount:0n,journals:0};c.amount+=outflow;c.journals++;categories.set(category.code,c);}
   else unclassified+=outflow;
  }
  return {id:g.key,date:g.date,progressivo:g.progressivo,netMovement:money(g.amount),inflow:money(g.amount>0n?g.amount:0n),outflow:money(outflow),causes,
   description:h.length===1&&typeof h[0].descrizione==='string'?h[0].descrizione:null,headerStatus:h.length===1?'unique':h.length?'ambiguous':'unavailable',
   selectedLines:g.rows.slice(0,200).map(projected),counterpartLines:other.slice(0,200).map(projected),selectedLineCount:g.rows.length,counterpartLineCount:other.length,linesTruncated:g.rows.length>200||other.length>200,
   journalBalance:balance===null?null:money(balance),contextVerified:complete,
   transfer:internal?{status:'verified_internal',scope:other.length?'across_selected_scope':'within_selected_scope',basis:'Registrazione bilanciata composta esclusivamente da conti liquidi selezionati esplicitamente'}:{status:'not_verified',scope:null,basis:'Nessuna attribuzione automatica da nome conto o causale'},
   category,beneficiary:null,beneficiaryReason:'Il contratto non attesta un collegamento univoco al beneficiario del pagamento; descrizioni e conti non ne provano l’identità.'};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.progressivo-b.progressivo);
 const totals={inflow:money(sum(movements.map(r=>cashAmount(r.inflow)))),outflow:money(sum(movements.map(r=>cashAmount(r.outflow)))),netMovement:money(sum(groups.map(g=>g.amount)))};
 const differences=Object.fromEntries(Object.keys(totals).map(k=>[k,money(cashAmount(totals[k])-cashAmount(summary.totals[k]))]));
 const exact=Object.values(differences).every(v=>cashAmount(v)===0n);
 if(!exact)throw fail('Dettaglio non coerente con il prospetto cash flow.',500);
 const snapshot=createHash('sha256').update(JSON.stringify({companyScope:'cashflow-detail-v1',company:input.company??null,principalId:input.principalId??null,year:input.year,from:input.from,to:input.to,codes:input.accountCodes,liquid:input.liquidAccountCodes||[],rows,chart,headers,sourceComplete,headersComplete})).digest('hex');
 const offset=input.offset||0,limit=input.limit||20,topLimit=input.topLimit||10;
 if(offset&&!input.snapshot)throw fail('Per continuare la lettura occorre lo snapshot della prima pagina.',409);
 if(input.snapshot&&input.snapshot!==snapshot)throw fail('Le fonti o i filtri sono cambiati: ricominciare da offset zero.',409);
 const ranked=movements.filter(r=>cashAmount(r.outflow)>0n).sort((a,b)=>{const d=cashAmount(b.outflow)-cashAmount(a.outflow);return d>0n?1:d<0n?-1:a.id.localeCompare(b.id);});
 const categoryAggregates=[...categories.values()].map(c=>({...c,amount:money(c.amount)})).sort((a,b)=>a.code.localeCompare(b.code));
 const attributionTotal=sum([...categories.values()].map(c=>c.amount))+unclassified+internalOutflow;
 if(attributionTotal!==cashAmount(summary.totals.outflow))throw fail('Copertura delle uscite incoerente.',500);
 const output={movements:movements.slice(offset,offset+limit),pagination:{offset,limit,total:movements.length,nextOffset:offset+limit<movements.length?offset+limit:null,snapshot},
  largestOutflows:ranked.slice(0,topLimit),largestOutflowsCoverage:{total:ranked.length,returned:Math.min(topLimit,ranked.length),basis:'Uscita netta per registrazione; include giroconti verificati, identificati separatamente'},
  categoryAggregates,categoryCoverage:{verifiedOutflow:money(sum([...categories.values()].map(c=>c.amount))),unattributedOutflow:money(unclassified),internalTransferOutflow:money(internalOutflow),totalOutflow:summary.totals.outflow},
  beneficiaryAggregates:[],beneficiaryCoverage:{verifiedOutflow:'0.00',unattributedOutflow:summary.totals.outflow},
  excludedOpeningClosing:[...exclusions.values()].map(e=>({cause:e.cause,rows:e.rows,journals:e.journals.size,netMovement:e.invalidAmounts?null:money(e.amount),invalidAmounts:e.invalidAmounts,includedInCashflow:false})),
  reconciliation:{exact,scope:'Stessa lettura e stesso perimetro MEXAL_CASHFLOW_READ; parità analitica, non bancaria',totals,differences,sourceComplete:sourceComplete&&summary.invalidRows===0,bankReconciled:false},
  referenceComparison:input.expectedNetMovement===undefined?null:{expectedNetMovement:money(cashAmount(input.expectedNetMovement)),actualNetMovement:summary.totals.netMovement,difference:money(cashAmount(summary.totals.netMovement)-cashAmount(input.expectedNetMovement)),matches:cashAmount(summary.totals.netMovement)===cashAmount(input.expectedNetMovement)},
  detailComplete:sourceComplete&&headersComplete&&[...exclusions.values()].every(e=>e.invalidAmounts===0)&&summary.invalidRows===0&&invalidContextRows===0&&invalidJournals===0&&movements.every(r=>r.headerStatus==='unique'&&!r.linesTruncated),detailQuality:{invalidContextRows,unverifiedJournals:invalidJournals,headersComplete},
  detailLimitations:['Le categorie qui attestate sono conti contropartita originali univoci, non classificazioni economiche inventate.','Beneficiari non attestati: nessuna deduzione da descrizioni libere o denominazioni di conti.','Giroconti verificati solo con conti liquidi dichiarati esplicitamente. I trasferimenti fuori dal perimetro restano nei totali selezionati.','Le testate e le righe sono letture paginabili non transazionali. Lo snapshot controlla la ripetibilità della pagina, non certifica la riconciliazione bancaria.','Totali e aggregati riguardano tutte le registrazioni lette; movements è una pagina e largestOutflows è una classifica limitata. Righe per registrazione oltre 200 esplicitamente troncate.']};
 if(new TextEncoder().encode(JSON.stringify(output)).length>2000000)throw fail('Risposta dettaglio troppo grande: ridurre limit e topLimit. Nessun totale è stato troncato.',413);
 return output;
}
