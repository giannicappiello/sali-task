// Shared deterministic accounting rules; null means unknown, never zero.
export const number = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
export const sumKnown = (values) => values.length && values.every(v => number(v) !== null) ? values.reduce((s,v) => s + Number(v),0) : null;
export const delta = (actual, planned) => number(actual) !== null && number(planned) !== null ? actual-planned : null;
export const percent = (actual, planned) => number(planned) !== null && planned !== 0 && number(actual) !== null ? (actual-planned)/Math.abs(planned)*100 : null;
const hours = (a,b) => a && b ? Math.max(0,(new Date(b)-new Date(a))/3600000) : null;
const materialCost = (rows) => sumKnown(rows.map(x => number(x.unitCost) === null ? null : Number(x.quantity)*Number(x.unitCost)));
export const defaultSettings = () => ({ laborHourly: "", shifts:[{ name:"Turno ordinario",start:"08:00",end:"16:00",breakMinutes:0,days:[1,2,3,4,5] }], holidays:[], machines:[], prices:[] });

export function validateSettings(settings) {
 if (!settings || number(settings.laborHourly) === null || number(settings.laborHourly)<0) throw new Error("Inserire il costo ora/uomo, anche zero se esplicitamente previsto.");
 if (!Array.isArray(settings.shifts) || !settings.shifts.length) throw new Error("Definire almeno un turno.");
 for (const s of settings.shifts) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) || s.start===s.end || !s.days?.length || s.days.some(d=>!Number.isInteger(d)||d<0||d>6)) throw new Error("Turno non valido.");
  if (number(s.breakMinutes)===null || s.breakMinutes<0 || s.breakMinutes>=shiftDuration(s)*60 + Number(s.breakMinutes)) throw new Error("Pausa non valida.");
 }
 for (let day=0;day<7;day++) {
  const intervals=[];
  for (const s of settings.shifts) for(const offset of [-1,0]) if(s.days.includes((day+offset+7)%7)) {
   const a=clockMinutes(s.start)+offset*1440, b=a+((clockMinutes(s.end)-clockMinutes(s.start)+1440)%1440);
   if(b>0&&a<1440) intervals.push([Math.max(0,a),Math.min(1440,b)]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);
  if(intervals.some((x,i)=>i>0&&x[0]<intervals[i-1][1])) throw new Error("I turni non possono sovrapporsi.");
 }
 for(const m of settings.machines||[]) for(const key of ["washMinutes","washCost","gainPerShift"]) if(m[key]!=="" && (number(m[key])===null || number(m[key])<0)) throw new Error("Costi/tempi macchina non validi.");
 for(const p of settings.prices||[]) if(!p.articleCode?.trim() || !p.unit?.trim() || number(p.price)===null || p.price<0) throw new Error("Prezzo stimato: articolo, unità e valore obbligatori.");
 if((settings.holidays||[]).some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("Date di chiusura non valide.");
 return settings;
}
const clockMinutes = (value) => { const [h,m]=value.split(":").map(Number);return h*60+m; };
export function shiftDuration(s) { return (((clockMinutes(s.end)-clockMinutes(s.start)+1440)%1440)-Number(s.breakMinutes||0))/60; }
// MES timestamps are local plant timestamps. Preserve their wall-clock dates,
// independent of the server's timezone; overnight shifts are supported.
function wall(value) { return new Date(String(value).replace(/(Z|[+-]\d\d:\d\d)$/,"")+"Z"); }
export function scheduledHours(start,end,settings) {
 if(!start||!end||!settings?.shifts?.length) return null;
 const from=wall(start),to=wall(end); if(!Number.isFinite(+from)||!Number.isFinite(+to)||to<from)return null;
 let total=0; const day=new Date(from);day.setUTCHours(0,0,0,0);day.setUTCDate(day.getUTCDate()-1);
 for(let count=0;day<to&&count<36600;count++,day.setUTCDate(day.getUTCDate()+1)){
  if((settings.holidays||[]).includes(day.toISOString().slice(0,10)))continue;
  for(const s of settings.shifts) if(s.days.includes(day.getUTCDay())){
   const a=new Date(+day+clockMinutes(s.start)*60000);let b=new Date(+day+clockMinutes(s.end)*60000);if(b<=a)b=new Date(+b+86400000);
   const overlap=Math.max(0,Math.min(+to,+b)-Math.max(+from,+a))/3600000;
   // Break placement is not recorded: prorated breaks are explicitly accounting estimates.
   total+=overlap*(shiftDuration(s)/((b-a)/3600000));
  }
 }
 return total;
}
function materialsVariance(planned,actual,confirmed=true) {
 const group=rows=>{const map=new Map();for(const r of rows){const k=r.code;const v=map.get(k)||{quantity:0,amount:0,known:true};v.quantity+=Number(r.quantity||0);v.known&&=number(r.unitCost)!==null;v.amount+=Number(r.quantity||0)*Number(r.unitCost||0);map.set(k,v);}return map;};
 const p=group(planned),a=group(actual);
 return [...new Set([...p.keys(),...a.keys()])].map(code=>{
  const x=p.get(code),y=a.get(code),pq=x?.quantity||0,aq=y?.quantity||0;
  const pc=x?.known&&pq?x.amount/pq:null,ac=y?.known&&aq?y.amount/aq:null;
  return {code,plannedQuantity:pq,actualQuantity:confirmed?aq:null,plannedUnitCost:pc,actualUnitCost:ac,
   usageVariance:!confirmed||pc===null?null:(aq-pq)*pc,priceVariance:!confirmed||pc===null||ac===null?null:aq*(ac-pc)};
 });
}

export function calculateRecord(evidence,configuration,adjustment={},commercial={},now=new Date().toISOString()) {
 const settings=configuration?.settings, original=evidence.baseline, warnings=[];
 if(evidence.workspaceSnapshot)warnings.push("Riferimenti storici importati dalle conferme Workspace. Aggiornare MES e importare lo storico per tempi, stato attuale e consumi.");
 if(!original)warnings.push("Preventivo originario non congelato: storico incompleto.");
 if(!settings)warnings.push("Configurazione costi non disponibile per questa produzione.");
 const plannedMaterials=original?.materials||[],plannedPackaging=original?.packaging||[];
 const bulkMaterials=(evidence.bulkSl||[]).flatMap(x=>x.materials||[]);
 const productMaterials=(evidence.productSl||[]).flatMap(x=>x.materials||[]);
 const ops=original?.operations||evidence.operations||[];
 const works=(evidence.works||[]).filter(w=>w.state!=="Annullato");
 for(const [type,phase] of [["Production","Semilavorato"],["Packaging","Confezionamento"],["Cartoning","Astucciatura"]]){
  for(const machineId of new Set(ops.filter(x=>x.type===type).map(x=>Number(x.impiantoId)))){
   if(!works.some(w=>w.machineId===machineId&&w.phase===phase))works.push({
    id:-(machineId*10+["Production","Packaging","Cartoning"].indexOf(type)+1),machineId,phase,state:"DaAvviare",
    start:null,end:null,goodQuantity:0,scrapQuantity:0,downtimeMinutes:0,personnel:[],losses:[],plannedOnly:true
   });
  }
 }
 const phases=works.map(w=>{
  const machine=settings?.machines?.find(m=>Number(m.id)===Number(w.machineId));
  const plannedOps=ops.filter(x=>Number(x.impiantoId)===Number(w.machineId)&&x.type===({Confezionamento:"Packaging",Astucciatura:"Cartoning",Semilavorato:"Production"}[w.phase]));
  const siblings=works.filter(x=>x.machineId===w.machineId&&x.phase===w.phase);
  const siblingQuantity=siblings.reduce((s,x)=>s+Number(x.goodQuantity||0),0);
  const share=siblings.length<=1?1:siblingQuantity>0?Number(w.goodQuantity||0)/siblingQuantity:1/siblings.length;
  const rawPlannedHours=sumKnown(plannedOps.map(x=>scheduledHours(x.start,x.end,settings)));
  const plannedHours=rawPlannedHours===null?null:rawPlannedHours*share;
  const actualElapsed=w.state==="DaAvviare"?null:hours(w.start,w.end||now);
  const stop=(Number(w.downtimeMinutes||0)/60)+(w.pausedAt?hours(w.pausedAt,w.end||now):0);
  const actualHours=actualElapsed===null?null:Math.max(0,actualElapsed-stop);
  const laborOps=[...plannedOps,...ops.filter(x=>Number(x.impiantoId)===Number(w.machineId)&&x.type==="Cleaning")];
  const plannedPersonHours=sumKnown(laborOps.map(x=>{const h=scheduledHours(x.start,x.end,settings);return h===null?null:h*Number(x.operators||0)*share;}));
  const actualPersonHours=sumKnown((w.personnel||[]).map(x=>hours(x.start,x.end||w.end||now)));
  const personHoursInShifts=sumKnown((w.personnel||[]).map(x=>scheduledHours(x.start,x.end||w.end||now,settings)));
  const plannedLabor=number(settings?.laborHourly)===null||plannedPersonHours===null?null:plannedPersonHours*Number(settings.laborHourly);
  const actualLabor=number(settings?.laborHourly)===null||actualPersonHours===null?null:actualPersonHours*Number(settings.laborHourly);
  const wash=adjustment.washes?.find(x=>Number(x.productionId)===w.id);
  const plannedWashes=ops.filter(x=>Number(x.impiantoId)===w.machineId&&x.type==="Cleaning").length*share;
  const plannedWash=number(machine?.washCost)===null?null:plannedWashes*Number(machine.washCost);
  const actualWash=number(wash?.count)===null||number(machine?.washCost)===null?null:Number(wash.count)*Number(machine.washCost);
  const shiftHours=settings?.shifts?.length?shiftDuration(settings.shifts[0]):null;
  const gain=number(machine?.gainPerShift),isStation=w.phase==="Semilavorato";
  return {...w,machine,plannedHours,actualHours,downtimeHours:stop,plannedPersonHours,actualPersonHours,personHoursInShifts,plannedLabor,actualLabor,
   plannedWashes,actualWashes:number(wash?.count),actualWashMinutes:number(wash?.minutes),plannedWash,actualWash,
   plannedWashMinutes:number(machine?.washMinutes)===null?null:plannedWashes*Number(machine.washMinutes),
   plannedGain:isStation&&shiftHours&&plannedHours!==null&&gain!==null?plannedHours/shiftHours*gain:null,
   actualGain:isStation&&shiftHours&&actualHours!==null&&gain!==null?actualHours/shiftHours*gain:null,
   productivity:actualHours>0?w.goodQuantity/actualHours:null,personProductivity:actualPersonHours>0?w.goodQuantity/actualPersonHours:null};
 });
 const filling=phases.filter(x=>x.phase==="Confezionamento"||x.phase==="Astucciatura"),bulk=phases.filter(x=>x.phase==="Semilavorato");
 const closed=works.length>0&&works.every(x=>x.state==="Terminato");
 const plannedMaterialCost=materialCost(plannedMaterials),actualMaterialCost=materialCost(bulkMaterials);
 const plannedPackagingCost=plannedPackaging.length?materialCost(plannedPackaging):filling.length?null:0;
 // The first finished-product SL row is the bulk transfer; do not add it again
 // when the same bulk production is already included in this order.
 const transferredBulk=productMaterials.length?productMaterials[0]:null;
 const actualPackagingCost=productMaterials.length?materialCost((evidence.productSl||[]).flatMap(d=>(d.materials||[]).slice(1))):filling.length?null:0;
 const losses=phases.flatMap(x=>(x.losses||[]).map(l=>x.lossesConfirmed?number(l.amount):null));
 const lossCost=losses.length?sumKnown(losses):0;
 const plannedLabor=sumKnown(phases.map(x=>x.plannedLabor)),actualLabor=sumKnown(phases.map(x=>x.actualLabor));
 const plannedWash=sumKnown(phases.map(x=>x.plannedWash)),actualWash=sumKnown(phases.map(x=>x.actualWash));
 const knownTransfer=number(commercial.bulkTransferCost);
 const materialsActual=bulk.length?actualMaterialCost:transferredBulk?knownTransfer:null;
 const plannedTotal=sumKnown([plannedMaterialCost,plannedPackagingCost,plannedLabor,plannedWash]);
 const actualTotal=sumKnown([materialsActual,actualPackagingCost,actualLabor,actualWash,lossCost]);
 const bulkProcessingCost=bulk.length?sumKnown([actualMaterialCost,sumKnown(bulk.map(x=>x.actualLabor)),sumKnown(bulk.map(x=>x.actualWash))]):null;
 const plannedBulkProcessingCost=bulk.length?sumKnown([plannedMaterialCost,sumKnown(bulk.map(x=>x.plannedLabor)),sumKnown(bulk.map(x=>x.plannedWash))]):null;
 const plannedFillingProcessingCost=filling.length?sumKnown([plannedPackagingCost,sumKnown(filling.map(x=>x.plannedLabor)),sumKnown(filling.map(x=>x.plannedWash))]):null;
 const fillingProcessingCost=filling.length?sumKnown([actualPackagingCost,sumKnown(filling.map(x=>x.actualLabor)),sumKnown(filling.map(x=>x.actualWash)),lossCost]):null;
 const directActualTotal=bulk.length?actualTotal:fillingProcessingCost;
 const finalFilling=filling.some(x=>x.phase==="Astucciatura")?filling.filter(x=>x.phase==="Astucciatura"):filling;
 const goodQuantity=finalFilling.length?finalFilling.reduce((n,x)=>n+Number(x.goodQuantity||0),0):bulk.reduce((n,x)=>n+Number(x.goodQuantity||0),0);
 const estimate=settings?.prices?.filter(p=>p.articleCode===evidence.articleCode&&p.unit===evidence.unit&&(!p.customerCode||p.customerCode===evidence.customerCode)&&(!p.orderNumber||p.orderNumber===evidence.orderNumber))
  .sort((a,b)=>(Number(Boolean(b.orderNumber))*2+Number(Boolean(b.customerCode)))-(Number(Boolean(a.orderNumber))*2+Number(Boolean(a.customerCode))))[0];
 const revenue=number(commercial.octRevenue)??(estimate?Number(estimate.price)*Number(evidence.quantity):null);
 const actualRevenue=number(commercial.invoiceRevenue),invoicedQuantity=number(commercial.invoicedQuantity);
 const productActualTotal=filling.length&&knownTransfer!==null?sumKnown([knownTransfer,fillingProcessingCost]):filling.length?null:actualTotal;
 const productPlannedTotal=filling.length?sumKnown([number(commercial.plannedBulkTransferCost),plannedFillingProcessingCost]):plannedTotal;
 const comparableCost=productActualTotal!==null&&goodQuantity>0&&invoicedQuantity!==null&&invoicedQuantity>=0&&invoicedQuantity<=goodQuantity?productActualTotal/goodQuantity*invoicedQuantity:null;
 if(!evidence.bulkSl?.length&&bulk.length)warnings.push("SL storico/privo di prezzi congelati: consumi valorizzati a consuntivo non disponibili.");
 if(actualWash===null)warnings.push("Lavaggi effettivi non rilevati: confermare conteggio nel dettaglio.");
 if(actualLabor===null)warnings.push("Presenze effettive o costo ora/uomo mancanti.");
 if(actualRevenue===null)warnings.push("Fatture non collegate univocamente alla produzione.");
 if(filling.length&&knownTransfer===null)warnings.push("Costo del bulk condiviso da riconciliare prima del costo per pezzo.");
 if(configuration?.created_at && String(configuration.created_at).slice(0,10)>String(original?.capturedAt||evidence.date).slice(0,10))warnings.push("Tariffe inserite dopo la lavorazione: valorizzazione ricostruita, non tariffa storica rilevata.");
 return {...evidence,configuration,phases,closed,warnings,plannedMaterialCost,actualMaterialCost,plannedPackagingCost,actualPackagingCost,
  plannedLabor,actualLabor,plannedWash,actualWash,lossCost,plannedTotal,actualTotal,goodQuantity,
  bulkProcessingCost,plannedBulkProcessingCost,plannedFillingProcessingCost,fillingProcessingCost,directActualTotal,productActualTotal,productPlannedTotal,
  unitCost:filling.length&&productActualTotal!==null&&goodQuantity>0?productActualTotal/goodQuantity:null,
  totalVariance:delta(actualTotal,plannedTotal),variancePercent:percent(actualTotal,plannedTotal),
  plannedGain:sumKnown(phases.filter(x=>x.phase==="Semilavorato").map(x=>x.plannedGain)),
  actualGain:sumKnown(phases.filter(x=>x.phase==="Semilavorato").map(x=>x.actualGain)),
  plannedRevenue:revenue,actualRevenue,invoicedQuantity,plannedMargin:delta(revenue,productPlannedTotal),
  actualMargin:delta(actualRevenue,comparableCost),commercial,
  materialVariances:materialsVariance(plannedMaterials,bulkMaterials,Boolean(evidence.bulkSl?.length)),
  historical:!original,provisional:!closed||actualTotal===null};
}

// Transfer actual bulk costs by the exact common bulk lot and the quantity sent
// in the filling SL. A missing/ambiguous source remains unknown. Global totals
// use direct costs, whereas per-piece margins use allocated product costs.
export function allocateBulkCosts(records) {
 return records.map(r=>{
  if(!r.phases.some(x=>x.phase==="Confezionamento"||x.phase==="Astucciatura"))return r;
  const lot=r.bulkLot;
  const sources=lot?records.filter(x=>(x.bulkLot===lot||x.lot===lot)&&x.bulkProcessingCost!==null&&x.phases.some(p=>p.phase==="Semilavorato")):[];
  if(sources.length!==1)return r;
  const source=sources[0];
  const produced=source.phases.filter(p=>p.phase==="Semilavorato").reduce((s,p)=>s+Number(p.goodQuantity||0),0);
  const used=(r.productSl||[]).reduce((s,d)=>s+Number(d.materials?.[0]?.quantity||0),0);
  if(produced<=0||used<=0||used>produced)return r;
  const consumers=records.filter(x=>x.bulkLot===lot);
  const totalUsed=consumers.reduce((s,x)=>s+(x.productSl||[]).reduce((t,d)=>t+Number(d.materials?.[0]?.quantity||0),0),0);
  if(totalUsed>produced+0.000001)return r;
  const plannedProduced=(source.baseline?.operations||[]).filter(o=>o.type==="Production").reduce((s,o)=>s+Number(o.quantity||0),0);
  const plannedUsed=number(r.baseline?.bulkQuantity);
  const plannedBulkTransferCost=plannedProduced>0&&plannedUsed!==null&&source.plannedBulkProcessingCost!==null
   ?source.plannedBulkProcessingCost*plannedUsed/plannedProduced:null;
  const commercial={...r.commercial,bulkTransferCost:source.bulkProcessingCost*used/produced,plannedBulkTransferCost,bulkSourceOrder:source.orderNumber,bulkUsed:used,bulkProduced:produced};
  return {...calculateRecord(r,r.configuration,r.audit?.find(x=>x.details?.washes)?.details||{},commercial),audit:r.audit,refreshedAt:r.refreshedAt};
 });
}
