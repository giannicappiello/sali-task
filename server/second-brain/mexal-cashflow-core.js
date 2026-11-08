const fail=(message,status=400)=>Object.assign(Error(message),{status});
export const iso=value=>{const s=String(value||'');const date=/^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`:s;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw fail('Data contabile non valida.',422);return date;};
export function cashAmount(value){
 const s=String(value);if(!/^-?\d+(?:\.\d{1,6})?$/.test(s))throw fail('Importo contabile non interpretabile senza arrotondamento.',422);
 const [whole,fraction='']=s.replace(/^-/,'').split('.');return (s.startsWith('-')?-1n:1n)*(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0')));
}
export const money=value=>{const n=value<0n?-value:value;let f=(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'');f=f.padEnd(2,'0');return `${value<0n?'-':''}${n/1000000n}.${f}`;};
export function cashflowMovements(rows,accountCodes,{from,to},{onJournal}={}){
 const selected=new Set(accountCodes),groups=new Map(),accounts=new Map(accountCodes.map(code=>[code,0n]));
 let selectedRows=0,excludedOpeningClosingRows=0,invalidRows=0,outsidePeriodRows=0,lastPostingDate=null;
 for(const row of rows){
  if(!selected.has(String(row.codice_conto)))continue;
  try{
   const date=iso(row.data_registr);if(date<from||date>to){outsidePeriodRows++;continue;}
   if(['AP','BA','CH'].includes(String(row.cau_contabile).trim().toUpperCase())){excludedOpeningClosingRows++;continue;}
   if(!Number.isSafeInteger(row.progressivo)||row.progressivo<1)throw fail('Identificativo registrazione mancante.',422);
   const amount=cashAmount(row.importo_riga),key=date+'|'+row.progressivo;
   const group=groups.get(key)||{key,date,progressivo:row.progressivo,amount:0n,positive:false,negative:false,...(onJournal?{rows:[]}: {})};if(onJournal)group.rows.push(row);group.amount+=amount;group.positive||=amount>0n;group.negative||=amount<0n;groups.set(key,group);
   accounts.set(String(row.codice_conto),accounts.get(String(row.codice_conto))+amount);selectedRows++;if(!lastPostingDate||date>lastPostingDate)lastPostingDate=date;
  }catch{invalidRows++;}
 }
 const months=new Map();for(let year=Number(from.slice(0,4)),month=Number(from.slice(5,7));`${year}-${String(month).padStart(2,'0')}`<=to.slice(0,7);){months.set(`${year}-${String(month).padStart(2,'0')}`,{inflow:0n,outflow:0n,net:0n,journals:0});month++;if(month===13){month=1;year++;}}
 let inflow=0n,outflow=0n,net=0n,internalNetZeroJournals=0;
 for(const g of groups.values()){
  if(onJournal)onJournal(g);
  const m=months.get(g.date.slice(0,7));m.journals++;m.net+=g.amount;net+=g.amount;
  if(g.amount>0n){m.inflow+=g.amount;inflow+=g.amount;}else if(g.amount<0n){m.outflow-=g.amount;outflow-=g.amount;}else if(g.positive&&g.negative)internalNetZeroJournals++;
 }
 return {months:[...months].map(([month,m])=>({month,inflow:money(m.inflow),outflow:money(m.outflow),netMovement:money(m.net),journals:m.journals})),totals:{inflow:money(inflow),outflow:money(outflow),netMovement:money(net)},accountMovements:[...accounts].map(([code,n])=>({code,netMovement:money(n)})),selectedRows,journals:groups.size,internalNetZeroJournals,excludedOpeningClosingRows,invalidRows,outsidePeriodRows,lastPostingDate};
}
