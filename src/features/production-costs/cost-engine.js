// Shared deterministic accounting rules; null means unknown, never zero.
import { historicalConsumption } from "./history.js";
import { productionTurns,explicitOvertimeHours } from "./turns.js";
import { laborRules, validateLaborRules, roundedHours, stationPaidHours, rulesSummary } from "./labor-rules.js";
import { historicalStationTurns, historicalLabor,historyCalendar } from "./station-history.js";
import { after17Intervals,currentOvertime } from "./overtime.js";
import { fillingUnitLabor,isPieces } from "./filling-history.js";
import { materialBaseline,materialCode } from "./material-baseline.js";
import { availableCosts } from "./available-costs.js";
export const number = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
export const sumKnown = (values) => values.length && values.every(v => number(v) !== null) ? values.reduce((s,v) => s + Number(v),0) : null;
export const delta = (actual, planned) => number(actual) !== null && number(planned) !== null ? actual-planned : null;
export const percent = (actual, planned) => number(planned) !== null && planned !== 0 && number(actual) !== null ? (actual-planned)/Math.abs(planned)*100 : null;
const hours = (a,b) => a && b ? Math.max(0,(new Date(b)-new Date(a))/3600000) : null;
const materialCost = (rows) => sumKnown(rows.map(x => number(x.unitCost) === null || number(x.quantity) === null || Number(x.quantity)<0 ? null : Number(x.quantity)*Number(x.unitCost)));
export function materialSummary(rows) {
 const known=rows.filter(x=>number(x.unitCost)!==null&&number(x.quantity)!==null&&Number(x.quantity)>=0);
 return {value:known.length?known.reduce((sum,x)=>sum+Number(x.quantity)*Number(x.unitCost),0):null,
  totalRows:rows.length,valuedRows:known.length,missingRows:rows.length-known.length,
  missingCodes:[...new Set(rows.filter(x=>!known.includes(x)).map(x=>materialCode(x.code)))]};
}
export const defaultSettings = () => ({ laborHourly: "", referenceShiftHours:8, mixingOperatorsCount:null, shifts:[{ name:"Turno ordinario",start:"08:00",end:"16:00",breakMinutes:0,days:[1,2,3,4,5] }], holidays:[], machines:[], prices:[] });

export function validateSettings(settings) {
 validateLaborRules(settings);
 if (!settings || number(settings.laborHourly) === null || number(settings.laborHourly)<0) throw new Error("Inserire il costo ora/uomo, anche zero se esplicitamente previsto.");
 if(number(settings.referenceShiftHours??8)===null||Number(settings.referenceShiftHours??8)<=0||Number(settings.referenceShiftHours??8)>24)throw new Error("La durata del turno di riferimento deve essere maggiore di zero e al massimo 24 ore.");
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
function materialsVariance(planned,actual,confirmed=true,plannedComplete=false) {
 const group=rows=>{const map=new Map();for(const r of rows){const k=materialCode(r.code);const v=map.get(k)||{quantity:0,amount:0,known:true,quantityKnown:true};const q=number(r.quantity);v.quantityKnown&&=q!==null&&q>=0;v.quantity+=q??0;v.known&&=number(r.unitCost)!==null;v.amount+=(q??0)*Number(r.unitCost||0);map.set(k,v);}return map;};
 const p=group(planned),a=group(actual);
 return [...new Set([...p.keys(),...a.keys()])].map(code=>{
  const x=p.get(code),y=a.get(code),pq=x?(x.quantityKnown?x.quantity:null):plannedComplete?0:null,aq=y?(y.quantityKnown?y.quantity:null):0;
  const pc=x?.known&&pq?x.amount/pq:null,ac=y?.known&&aq?y.amount/aq:null;
  return {code,plannedQuantity:pq,actualQuantity:confirmed?aq:null,plannedUnitCost:pc,actualUnitCost:ac,
   usageVariance:!confirmed||pq===null||aq===null||pc===null?null:(aq-pq)*pc,priceVariance:!confirmed||pq===null||aq===null||pc===null||ac===null?null:aq*(ac-pc)};
 });
}

export function calculateRecord(evidence,configuration,adjustment={},commercial={},now=new Date().toISOString(),stationContext=null,fillingContext=null) {
 const settings=configuration?.settings, original=evidence.baseline||evidence.historicalBaseline, warnings=[];
 const rules=laborRules(settings);
 const historicalMode=Boolean(stationContext?.policy)||rules.station.basis==="historical_productivity";
 const history=stationContext?.history,stationSettings=stationContext?.policy?.settings||settings;
 const fillingHistoricalMode=Boolean(fillingContext?.policy)||rules.filling.basis==="historical_pieces";
 const fillingSettings=fillingContext?.policy?.settings||settings, fillingHistory=fillingContext?.history;
 const unitLabor=fillingHistoricalMode?fillingUnitLabor(fillingHistory,fillingSettings?.laborHourly):null;
 const recoveredConsumption=!evidence.bulkSl?.length?historicalConsumption(evidence):[];
 const recoveredProducts=!evidence.productSl?.length?(evidence.historicalProductConsumption||[]).filter(x=>x.consumedAt).map(x=>({...x,unitCost:number(x.currentUnitCost)>0?Number(x.currentUnitCost):null})):[];
 const materialPlan=materialBaseline(evidence);
 const reconstructed=Boolean(materialPlan.recovered||(!evidence.baseline&&evidence.historicalBaseline)||recoveredConsumption.length||recoveredProducts.length);
 if(evidence.workspaceSnapshot)warnings.push("Riferimenti storici importati dalle conferme Workspace. Aggiornare MES e importare lo storico per tempi, stato attuale e consumi.");
 if(!evidence.baseline)warnings.push(evidence.historicalBaseline?"Preventivo ricostruito dalla revisione formula collegata, valorizzato ai costi ultimi disponibili; non è il preventivo economico originale.":"Preventivo originario non congelato: formula storica non ancora recuperata.");
 if(recoveredConsumption.length)warnings.push("Consumi recuperati dai prelievi scaricati in MES e valorizzati ai costi ultimi disponibili. Valorizzazione ricostruita, non prezzi storici dello SL.");
 if(!settings)warnings.push("Configurazione costi non disponibile per questa produzione.");
 const plannedMaterials=materialPlan.rows,plannedPackaging=original?.packaging||[];
 if(materialPlan.recovered)warnings.push("Quantità formula mancanti recuperate dalla revisione collegata alla lavorazione e dalla quantità del lotto. Per i componenti assenti dal preventivo si usano i costi ultimi disponibili, non prezzi storici; i prezzi originali registrati restano prioritari. Il preventivo salvato resta invariato.");
 if(!plannedMaterials.length)warnings.push("Quantità formula non disponibili: manca un preventivo materiali utilizzabile o la revisione formula storica collegata. I consumi SL non vengono copiati nel preventivo.");
 const bulkMaterials=evidence.bulkSl?.length?evidence.bulkSl.flatMap(x=>x.materials||[]):recoveredConsumption;
 const productMaterials=evidence.productSl?.length?evidence.productSl.flatMap(x=>x.materials||[]):recoveredProducts;
 if(recoveredProducts.length)warnings.push("Bulk/confezionamento ricostruiti dagli impegni V4 marcati consumati: quantità fabbisogno e costi ultimi, non righe SL originali.");
 const ops=original?.operations||evidence.operations||[];
 const works=[...new Map((evidence.works||[]).filter(w=>w.state!=="Annullato").map(w=>[w.id,w])).values()];
 for(const [type,phase] of [["Production","Semilavorato"],["Packaging","Confezionamento"],["Cartoning","Astucciatura"]]){
  for(const machineId of new Set(ops.filter(x=>x.type===type).map(x=>Number(x.impiantoId)))){
   if(!works.some(w=>w.machineId===machineId&&w.phase===phase))works.push({
    id:-(machineId*10+["Production","Packaging","Cartoning"].indexOf(type)+1),machineId,phase,state:"DaAvviare",
    start:null,end:null,goodQuantity:0,scrapQuantity:0,downtimeMinutes:0,personnel:[],losses:[],plannedOnly:true
   });
  }
 }
 const fillingWorks=works.filter(w=>w.phase==="Confezionamento");
 // Order quantity is counted once, not once per daily planning interval/machine.
 const plannedPieces=isPieces(evidence.unit)?number(original?.quantity)??number(evidence.quantity):null;
 const fillingWeight=fillingWorks.reduce((s,w)=>s+Math.max(0,number(w.goodQuantity)??0),0);
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
  const laborOps=[...plannedOps,...(rules.filling.includeCleaning?ops.filter(x=>Number(x.impiantoId)===Number(w.machineId)&&x.type==="Cleaning"):[])];
  const plannedPersonHours=sumKnown(laborOps.map(x=>{const h=rules.filling.plannedTime==="elapsed"?hours(x.start,x.end):scheduledHours(x.start,x.end,settings);return h===null||number(x.operators)===null?null:roundedHours(h,rules.filling.roundingMinutes)*Number(x.operators)*share;}));
  const actualPersonHours=sumKnown((w.personnel||[]).map(x=>hours(x.start,x.end||w.end||now)));
  const personHoursInShifts=sumKnown((w.personnel||[]).map(x=>scheduledHours(x.start,x.end||w.end||now,settings)));
  const isStation=w.phase==="Semilavorato";
  const shiftHours=(isStation&&historicalMode)||(!isStation&&fillingHistoricalMode)?8:number(settings?.referenceShiftHours??8);
  const mixingOperatorsCount=isStation&&historicalMode?number(history?.mixingOperatorsCount):number(settings?.mixingOperatorsCount)??number(evidence.mixingOperatorsCount);
  const countTurns=(start,end,down=0)=>isStation&&historicalMode?historicalStationTurns(start,end,history,down):!isStation&&fillingHistoricalMode?historicalStationTurns(start,end,fillingHistory,down):productionTurns(start,end,settings,down);
  const plannedShiftCounts=plannedOps.map(op=>countTurns(op.start,op.end));
  const actualShiftCounts=w.state==="DaAvviare"?null:countTurns(w.start,w.pausedAt||w.end||history?.asOfLocal||now,Number(w.downtimeMinutes||0)/60);
  const plannedTurns=plannedShiftCounts.length&&plannedShiftCounts.every(Boolean)?plannedShiftCounts.reduce((sum,x)=>sum+x.turns,0)*share:null;
  const actualTurns=actualShiftCounts?.turns??null;
  const plannedOvertimeHours=plannedShiftCounts.length&&plannedShiftCounts.every(Boolean)?plannedShiftCounts.reduce((sum,x)=>sum+x.overtimeHours,0)*share:null;
  const explicitIntervals=currentOvertime((adjustment.overtime||[]).filter(x=>x.productionId===w.id),w.start,w.pausedAt||w.end||history?.asOfLocal||now);
  const economicCalendar=isStation&&historicalMode?historyCalendar(history):settings;
  const explicitHours=isStation&&economicCalendar?explicitOvertimeHours(historicalMode?explicitIntervals:after17Intervals(explicitIntervals),economicCalendar):0;
  const actualOvertimeHours=actualShiftCounts?(actualShiftCounts.overtimeHours+explicitHours):null;
  const plannedPaidHours=isStation&&historicalMode?null:sumKnown(plannedShiftCounts.map(x=>stationPaidHours(x,settings)));
  const actualPaidHours=isStation&&historicalMode?null:stationPaidHours(actualShiftCounts?{...actualShiftCounts,overtimeHours:actualOvertimeHours}:null,settings);
  const plannedCostPersonHours=isStation&&historicalMode?historicalLabor(plannedTurns,history,1):isStation?(mixingOperatorsCount===null||plannedPaidHours===null?null:mixingOperatorsCount*plannedPaidHours*share):plannedPersonHours;
  const actualCostPersonHours=isStation&&historicalMode?historicalLabor(actualTurns===null?null:actualTurns+explicitHours*laborRules(stationSettings).station.overtimeMultiplier/8,history,1):isStation?(mixingOperatorsCount===null||actualPaidHours===null?null:mixingOperatorsCount*actualPaidHours):sumKnown((w.personnel||[]).map(x=>roundedHours(hours(x.start,x.end||w.end||now),rules.filling.roundingMinutes)));
  const hourly=isStation&&historicalMode?number(stationSettings?.laborHourly):number(settings?.laborHourly);
  let plannedLabor=hourly===null||plannedCostPersonHours===null?null:plannedCostPersonHours*hourly;
  let actualLabor=hourly===null||actualCostPersonHours===null?null:actualCostPersonHours*hourly;
  const pieceShare=fillingWeight>0?Math.max(0,number(w.goodQuantity)??0)/fillingWeight:1/Math.max(1,fillingWorks.length);
  const plannedLaborPieces=w.phase==="Confezionamento"&&plannedPieces!==null&&plannedPieces>=0?plannedPieces*pieceShare:null;
  const actualLaborPieces=w.phase==="Confezionamento"&&w.state==="Terminato"&&w.end&&w.end>=w.start&&isPieces(w.unit||evidence.unit)&&number(w.goodQuantity)!==null&&Number(w.goodQuantity)>=0?Number(w.goodQuantity):null;
  const laborIncludedInFilling=fillingHistoricalMode&&w.phase==="Astucciatura"&&fillingWorks.length>0;
  if(fillingHistoricalMode&&!isStation){
   plannedLabor=w.phase==="Confezionamento"?unitLabor===null||plannedLaborPieces===null?null:unitLabor*plannedLaborPieces:laborIncludedInFilling?0:null;
   actualLabor=w.phase==="Confezionamento"?unitLabor===null||actualLaborPieces===null?null:unitLabor*actualLaborPieces:laborIncludedInFilling?0:null;
  }
  const wash=adjustment.washes?.find(x=>Number(x.productionId)===w.id);
  const plannedWashes=ops.filter(x=>Number(x.impiantoId)===w.machineId&&x.type==="Cleaning").length*share;
  const plannedWash=number(machine?.washCost)===null?null:plannedWashes*Number(machine.washCost);
  const actualWash=number(wash?.count)===null||number(machine?.washCost)===null?null:Number(wash.count)*Number(machine.washCost);
  const gain=number(machine?.gainPerShift);
  return {...w,machine,plannedHours,actualHours,downtimeHours:stop,plannedPersonHours,actualPersonHours,personHoursInShifts,plannedLabor,actualLabor,
   mixingOperatorsCount,referenceShiftHours:shiftHours,plannedTurns,actualTurns,plannedOvertimeHours,actualOvertimeHours,
   plannedCostPersonHours:fillingHistoricalMode&&!isStation?null:plannedCostPersonHours,actualCostPersonHours:fillingHistoricalMode&&!isStation?null:actualCostPersonHours,
   plannedLaborPieces,actualLaborPieces,laborIncludedInFilling,laborUnitCost:fillingHistoricalMode&&w.phase==="Confezionamento"?unitLabor:null,
   plannedWashes,actualWashes:number(wash?.count),actualWashMinutes:number(wash?.minutes),plannedWash,actualWash,
   plannedWashMinutes:number(machine?.washMinutes)===null?null:plannedWashes*Number(machine.washMinutes),
   plannedGain:isStation&&plannedTurns!==null&&gain!==null?plannedTurns*gain:null,
   actualGain:isStation&&actualTurns!==null&&gain!==null?actualTurns*gain:null,
   productivity:actualHours>0?w.goodQuantity/actualHours:null,personProductivity:actualPersonHours>0?w.goodQuantity/actualPersonHours:null};
 });
 const filling=phases.filter(x=>x.phase==="Confezionamento"||x.phase==="Astucciatura"),bulk=phases.filter(x=>x.phase==="Semilavorato");
 const closed=works.length>0&&works.every(x=>x.state==="Terminato");
 const plannedMaterialCost=materialCost(plannedMaterials),actualMaterialCost=materialCost(bulkMaterials);
 const plannedMaterialSummary=materialSummary(plannedMaterials),actualMaterialSummary=materialSummary(bulkMaterials);
 const plannedPackagingCost=plannedPackaging.length?materialCost(plannedPackaging):filling.length?null:0;
 // The first finished-product SL row is the bulk transfer; do not add it again
 // when the same bulk production is already included in this order.
 const transferredBulk=evidence.productSl?.length?productMaterials[0]:recoveredProducts.find(x=>x.kind==="Bulk");
 const recoveredPackaging=recoveredProducts.filter(x=>x.kind==="Packaging");
 const actualPackagingCost=evidence.productSl?.length?materialCost(evidence.productSl.flatMap(d=>(d.materials||[]).slice(1))):recoveredPackaging.length?materialCost(recoveredPackaging):filling.length?null:0;
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
 if(!evidence.bulkSl?.length&&bulk.length&&!recoveredConsumption.length)warnings.push("SL e prelievi scaricati non disponibili: consumi consuntivi non recuperabili.");
 if(actualWash===null)warnings.push("Lavaggi effettivi non rilevati: confermare conteggio nel dettaglio.");
 if(actualLabor===null)warnings.push("Costo personale incompleto: verificare tariffa, calendario e organico; per FILLING media storica, pezzi chiusi e unità pezzi, oppure presenze secondo il criterio scelto.");
 if(filling.length&&fillingHistoricalMode){
  warnings.push(rulesSummary(fillingSettings)[1]);
  if(!fillingHistory||fillingHistory.error)warnings.push(fillingHistory?.error||"Media storica FILLING non acquisita: costo non calcolabile.");
  if(!isPieces(evidence.unit))warnings.push("Unità della lavorazione non in pezzi: costo FILLING non calcolabile.");
  if(!fillingWorks.length)warnings.push("Astucciatura senza lavorazione FILLING collegata: costo reparto non attribuibile.");
  warnings.push("Manodopera FILLING ricalcolata anche sulle produzioni concluse. Pezzi astucciati separati e nessun addebito aggiuntivo di presenze o straordinari nel metodo a pezzi.");
 }
 if(bulk.length)warnings.push(rulesSummary(historicalMode?stationSettings:settings)[0]+(historicalMode?"":" Organico della versione costi, oppure organico MES disponibile per ricostruzione."));
 if(bulk.length&&historicalMode){
  if(!history||history.error)warnings.push(history?.error||"Media storica MES non acquisita: costo non calcolabile.");
  if(history?.calendar?.historyWarning)warnings.push(history.calendar.historyWarning);
  warnings.push("Manodopera STATION ricalcolata anche sullo storico; snapshot di formula, SL e configurazioni originali non modificati.");
 }
 if(bulk.some(p=>p.downtimeHours>0))warnings.push("Fermi STATION sottratti dalle ore entro calendario: la collocazione oraria dei fermi storici non è disponibile.");
 if(actualRevenue===null)warnings.push("Fatture non collegate univocamente alla produzione.");
 if(filling.length&&knownTransfer===null)warnings.push("Costo del bulk condiviso da riconciliare prima del costo per pezzo.");
 if(configuration?.created_at && String(configuration.created_at).slice(0,10)>String(original?.capturedAt||evidence.date).slice(0,10))warnings.push("Tariffe inserite dopo la lavorazione: valorizzazione ricostruita, non tariffa storica rilevata.");
 const knownSubtotal=values=>values.some(v=>number(v)!==null)?values.reduce((s,v)=>s+(number(v)??0),0):null;
 const actualKnownSubtotal=knownSubtotal([...(bulk.length?[actualMaterialSummary.value]:[]),...(filling.length?[actualPackagingCost]:[]),actualLabor,actualWash,...(losses.length?[lossCost]:[])]);
 const plannedKnownSubtotal=knownSubtotal([plannedMaterialSummary.value,...(filling.length?[plannedPackagingCost]:[]),plannedLabor,plannedWash]);
 const oneStation=new Set(bulk.map(p=>p.machineId)).size===1;
 const plannedObjective=oneStation?sumKnown(bulk.map(p=>p.plannedGain)):null;
 const actualObjective=oneStation?sumKnown(bulk.map(p=>p.actualGain)):null;
 const invoicedObjective=actualObjective!==null&&comparableCost!==null?actualObjective*invoicedQuantity/goodQuantity:null;
 if(bulk.length&&!oneStation)warnings.push("Margine per singola STATION non attribuibile: più STATION condividono il ricavo. Nessuna ripartizione automatica inventata.");
 return {...evidence,configuration,phases,closed,warnings,reconstructed,recoveredConsumption,recoveredProducts,actualKnownSubtotal,plannedKnownSubtotal,plannedMaterialSummary,actualMaterialSummary,plannedMaterialCost,actualMaterialCost,plannedPackagingCost,actualPackagingCost,
  adjustment,stationContext,stationHistory:historicalMode?history:null,stationHistoricalHourly:historicalMode?number(stationSettings?.laborHourly):null,
  fillingContext,fillingHistory:fillingHistoricalMode?fillingHistory:null,fillingHistoricalHourly:fillingHistoricalMode?number(fillingSettings?.laborHourly):null,
  fillingUnitLabor:unitLabor,
  laborCriteria:[rulesSummary(historicalMode?stationSettings:settings)[0],rulesSummary(fillingHistoricalMode?fillingSettings:settings)[1],rulesSummary(settings)[2]],plannedObjective,invoicedObjective,plannedObjectiveVariance:delta(delta(revenue,productPlannedTotal),plannedObjective),actualObjectiveVariance:delta(delta(actualRevenue,comparableCost),invoicedObjective),
  plannedLabor,actualLabor,plannedWash,actualWash,lossCost,plannedTotal,actualTotal,goodQuantity,
  bulkProcessingCost,plannedBulkProcessingCost,plannedFillingProcessingCost,fillingProcessingCost,directActualTotal,productActualTotal,productPlannedTotal,
  unitCost:filling.length&&productActualTotal!==null&&goodQuantity>0?productActualTotal/goodQuantity:null,
  totalVariance:delta(actualTotal,plannedTotal),variancePercent:percent(actualTotal,plannedTotal),
  plannedGain:sumKnown(phases.filter(x=>x.phase==="Semilavorato").map(x=>x.plannedGain)),
  actualGain:sumKnown(phases.filter(x=>x.phase==="Semilavorato").map(x=>x.actualGain)),
  plannedRevenue:revenue,actualRevenue,invoicedQuantity,plannedMargin:delta(revenue,productPlannedTotal),
  actualMargin:delta(actualRevenue,comparableCost),commercial,
  materialVariances:materialsVariance(plannedMaterials,bulkMaterials,Boolean(evidence.bulkSl?.length||recoveredConsumption.length),materialPlan.complete),
  historical:!evidence.baseline,provisional:!closed||actualTotal===null||reconstructed};
}

// Transfer actual bulk costs by the exact common bulk lot and the quantity sent
// in the filling SL. A missing/ambiguous source remains unknown. Global totals
// use direct costs, whereas per-piece margins use allocated product costs.
export function allocateBulkCosts(records) {
 return records.map(r=>{
  if(!r.phases.some(x=>x.phase==="Confezionamento"||x.phase==="Astucciatura"))return r;
  const lot=r.bulkLot;
  const sources=lot?records.filter(x=>(x.bulkLot===lot||x.lot===lot)&&x.phases.some(p=>p.phase==="Semilavorato")):[];
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
  const available=availableCosts(source).values;
  const commercial={...r.commercial,bulkTransferCost:source.bulkProcessingCost===null?null:source.bulkProcessingCost*used/produced,plannedBulkTransferCost,
   bulkTransferAvailable:available.bulkProcessingCost===null?null:available.bulkProcessingCost*used/produced,
   plannedBulkTransferAvailable:plannedProduced>0&&plannedUsed!==null&&available.plannedBulkProcessingCost!==null?available.plannedBulkProcessingCost*plannedUsed/plannedProduced:null,
   bulkSourceOrder:source.orderNumber,bulkUsed:used,bulkProduced:produced};
  return {...calculateRecord(r,r.configuration,r.adjustment||{},commercial,undefined,r.stationContext,r.fillingContext),audit:r.audit,refreshedAt:r.refreshedAt};
 });
}
