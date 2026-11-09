const SCALE=1000000n;
const fail=message=>Object.assign(Error(message),{status:422});
function fixed(value){
 if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12)throw fail('Numero inventario non valido.');
 const text=value.toFixed(6);
 if(Math.abs(Number(text)-value)>1e-8)throw fail('Precisione inventario oltre sei decimali.');
 return BigInt(text.replace('.',''));
}
function decimal(value,scale=6){const negative=value<0n,x=negative?-value:value,power=10n**BigInt(scale);return (negative?'-':'')+(x/power)+'.'+(x%power).toString().padStart(scale,'0');}
const cents=value=>decimal(value,2);
const money=(quantity,price)=>(quantity*price+5000000000n)/10000000000n;
const key=(code,warehouse)=>code+'|'+warehouse;
const day=value=>{if(typeof value!=='string'||!/^\d{8}$/.test(value))return null;const iso=value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8),d=new Date(iso+'T00:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===iso?value:null;};
const sameKindOrigins={FT:['BC'],FF:['BF'],BS:['BC']};

// These are the standard inventory effects documented in the Mexal article
// progressives manual. Custom row effects and alternative units fail closed.
export function inventoryMovement(row){
 const q=fixed(row.quantita),sigla=row.sigla;
 if(Number(row.id_causale_riga)!==0)throw fail('Causale quantitativa di riga non supportata.');
 const currentDate=day(row.data_documento);if(!currentDate)throw fail('Data documento non valida.');
 let date=currentDate;
 if(row.sigla_doc_orig&&row.sigla_doc_orig!==sigla){
  if(!sameKindOrigins[sigla]?.includes(row.sigla_doc_orig)||!day(row.data_doc_orig))throw fail('Trasformazione documentale non verificata.');
  date=row.data_doc_orig;
 }
 // A value-only row has a nominal quantity but does not move physical stock.
 if(row.tp_um_articolo==='V')return {date,effects:[],valueOnly:true};
 if(row.tp_um_articolo!=='1')throw fail('Unità di misura alternativa non verificata.');
 const effects=[];
 const add=(warehouse,field,amount)=>{
  if(warehouse===0)return;
  if(!Number.isInteger(warehouse)||warehouse<1)throw fail('Magazzino di riga non valido.');
  effects.push({warehouse,field,amount});
 };
 const from=row.id_mag_da_riga,to=row.id_mag_a_riga;
 if(['FF','BF','CL'].includes(sigla)){add(from,'carico',q);if(sigla==='CL')add(to,'scarico',q);}
 else if(['FT','BC','CO','BS','SL'].includes(sigla)){add(from,'scarico',q);if(sigla==='SL')add(to,'carico',q);}
 else if(['NC','RC'].includes(sigla))add(from,'scarico',-q);
 else if(['NF','RF'].includes(sigla))add(from,'carico',-q);
 else if(['BD','DL'].includes(sigla)){add(from,'carico',-q);add(to,'carico',q);}
 else if(sigla!=='IN')throw fail('Tipo documento non verificato: '+String(sigla));
 return {date,effects,valueOnly:false,inventoryAdjustment:sigla==='IN'};
}

export function inventoryValuation({articles,movements,progressives,period,fromWarehouse=1,toWarehouse=10}){
 const master=new Map(),native=new Map(),ledger=new Map(),historical=[new Map(),new Map()],seen=new Set(),unresolved=[];
 const cuts=[period.from,period.to].map(d=>d.replaceAll('-',''));
 let valueOnlyRows=0,inventoryAdjustmentRows=0;
 for(const a of articles){if(master.has(a.codice))throw fail('Articolo ripetuto nell’anagrafica.');master.set(a.codice,a);}
 for(const p of progressives){
  if(!master.has(p.cod_articolo)||master.get(p.cod_articolo).um_principale!==p.um_principale)unresolved.push({code:p.cod_articolo,reason:'Anagrafica o unità di misura dei progressivi non coerente'});
  const k=key(p.cod_articolo,p.id_magazzino),r=native.get(k)||{code:p.cod_articolo,warehouse:p.id_magazzino,initial:0n,carico:0n,scarico:0n};
  r.initial+=fixed(p.qta_inventario);r.carico+=fixed(p.qta_carico);r.scarico+=fixed(p.qta_scarico);native.set(k,r);
 }
 for(const r of movements){
  const id=[r.sigla,r.serie,r.numero,r.cod_conto,r.id_rif_testata,r.id_riga].join('|');
  if(seen.has(id)){unresolved.push({code:r.codice_articolo,reason:'Chiave di riga duplicata',id});continue;}seen.add(id);
  let movement;try{movement=inventoryMovement(r);}catch(e){unresolved.push({code:r.codice_articolo,reason:e.message,id});continue;}
  if(movement.date.slice(0,4)!==String(period.year)){unresolved.push({code:r.codice_articolo,reason:'Movimento origine fuori esercizio',id});continue;}
  if(movement.valueOnly)valueOnlyRows++;
  if(movement.inventoryAdjustment)inventoryAdjustmentRows++;
  for(const e of movement.effects){
   if(e.warehouse<fromWarehouse||e.warehouse>toWarehouse)continue;
   const k=key(r.codice_articolo,e.warehouse),v=ledger.get(k)||{carico:0n,scarico:0n};v[e.field]+=e.amount;ledger.set(k,v);
   const delta=e.field==='carico'?e.amount:-e.amount;
   for(let i=0;i<2;i++)if(movement.date<=cuts[i])historical[i].set(r.codice_articolo,(historical[i].get(r.codice_articolo)||0n)+delta);
  }
 }
 const differences=[];
 for(const k of new Set([...native.keys(),...ledger.keys()])){
  const n=native.get(k)||{carico:0n,scarico:0n},l=ledger.get(k)||{carico:0n,scarico:0n};
  if(l.carico!==n.carico||l.scarico!==n.scarico)differences.push({key:k,caricoDifference:decimal(l.carico-n.carico),scaricoDifference:decimal(l.scarico-n.scarico)});
 }
 const initial=new Map();for(const p of native.values())initial.set(p.code,(initial.get(p.code)||0n)+p.initial);
 const codes=[...new Set([...initial.keys(),...historical.flatMap(m=>[...m.keys()])])].sort();
 const phase=[0,1].map(()=>({sum:0n,positiveArticles:0,negativeArticles:0,zeroArticles:0,missingCosts:[]}));
 const details=[];
 for(const code of codes){
  const a=master.get(code),quantities=historical.map(m=>(initial.get(code)||0n)+(m.get(code)||0n));
  const rawPrice=a?.costo_ult??a?.cos_ult;let price=null;
  try{if(rawPrice!==undefined&&rawPrice!==null&&rawPrice>0)price=fixed(rawPrice);}catch{price=null;}
  const values=[null,null];
  for(let i=0;i<2;i++){
   const p=phase[i],q=quantities[i];
   if(q<0n){p.negativeArticles++;continue;}if(q===0n){p.zeroArticles++;continue;}p.positiveArticles++;
   if(price===null){p.missingCosts.push({code,quantity:decimal(q),unit:a?.um_principale??null,reason:a?'Costo ultimo mancante o non positivo':'Anagrafica mancante'});continue;}
   values[i]=money(q,price);p.sum+=values[i];
  }
  details.push({code,name:a?.descrizione??null,unit:a?.um_principale??null,lastCost:price===null?null:decimal(price),openingQuantity:decimal(quantities[0]),closingQuantity:decimal(quantities[1]),openingValue:values[0]===null?null:cents(values[0]),closingValue:values[1]===null?null:cents(values[1])});
 }
 const quantitiesReconciled=differences.length===0&&unresolved.length===0;
 const complete=quantitiesReconciled&&phase.every(p=>p.missingCosts.length===0);
 return {complete,valuation:{method:'costo ultimo',priceBasis:'Costo ultimo anagrafico alla lettura, comune alle due date; non costo storico.',opening:complete?cents(phase[0].sum):null,closing:complete?cents(phase[1].sum):null,change:complete?cents(phase[1].sum-phase[0].sum):null,observedValuedSubtotals:{opening:cents(phase[0].sum),closing:cents(phase[1].sum)},dateBasis:'Fine giornata alle due date, estremi inclusi. Per fatture trasformate si usa la data della bolla origine. Gli IN sono già compresi nell’inventario iniziale Mexal.'},reconciliation:{quantitiesReconciled,positionsCompared:new Set([...native.keys(),...ledger.keys()]).size,differences,unresolved,valueOnlyRows,inventoryAdjustmentRows,transactionalSnapshot:false,officialInventoryPrintCompared:false},coverage:{opening:{positiveArticles:phase[0].positiveArticles,negativeArticles:phase[0].negativeArticles,zeroArticles:phase[0].zeroArticles,missingCosts:phase[0].missingCosts},closing:{positiveArticles:phase[1].positiveArticles,negativeArticles:phase[1].negativeArticles,zeroArticles:phase[1].zeroArticles,missingCosts:phase[1].missingCosts}},details};
}
