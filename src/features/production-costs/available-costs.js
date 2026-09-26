import { isPieces } from "./filling-history.js";
import { packagingBaseline, productRows } from "./packaging-evidence.js";
const numeric=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))?Number(v):null;
export const sumAvailable=values=>{const known=values.map(numeric).filter(v=>v!==null);return known.length?known.reduce((a,b)=>a+b,0):null;};
const difference=(a,b)=>a!=null&&b!=null?a-b:null;
const materials=rows=>sumAvailable(rows.map(r=>numeric(r.quantity)!==null&&Number(r.quantity)>=0&&numeric(r.unitCost)!==null?Number(r.quantity)*Number(r.unitCost):null));

// Reporting values do not overwrite complete accounting values or source snapshots.
// Missing inputs remain unknown; every derived partial amount carries a flag.
export function availableCosts(r) {
 const phases=r.phases||[],bulk=phases.filter(p=>p.phase==="Semilavorato"),filling=phases.filter(p=>["Confezionamento","Astucciatura"].includes(p.phase));
 const values={plannedMaterialCost:r.plannedMaterialSummary?.value??r.plannedMaterialCost,actualMaterialCost:r.actualMaterialSummary?.value??r.actualMaterialCost,
  plannedPackagingCost:r.plannedPackagingCost??materials(r.plannedPackaging||packagingBaseline(r).rows),
  actualPackagingCost:r.actualPackagingCost??materials(r.actualPackagingRows||(r.productSl?.length?productRows(r).filter(m=>m.kind==="Packaging"):(r.recoveredProducts||[]).filter(x=>x.kind==="Packaging")))};
 for(const k of ["plannedLabor","actualLabor","plannedWash","actualWash"])values[k]=r[k]??sumAvailable(phases.map(p=>p[k]));
 values.lossCost=r.lossCost??sumAvailable(phases.flatMap(p=>p.lossesConfirmed?(p.losses||[]).map(l=>l.amount):[]));
 const bulkCost=side=>bulk.length?sumAvailable([values[side+"MaterialCost"],...bulk.flatMap(p=>[p[side+"Labor"],p[side+"Wash"]])]):null;
 values.bulkProcessingCost=bulkCost("actual");values.plannedBulkProcessingCost=bulkCost("planned");
 const fillingCost=side=>filling.length?sumAvailable([values[side+"PackagingCost"],...filling.flatMap(p=>[p[side+"Labor"],p[side+"Wash"]]),...(side==="actual"&&filling.some(p=>p.losses?.length)?[values.lossCost]:[])]):null;
 values.fillingProcessingCost=fillingCost("actual");values.plannedFillingProcessingCost=fillingCost("planned");
 const actualTransfer=numeric(r.commercial?.bulkTransferCost)??numeric(r.commercial?.bulkTransferAvailable);
 const plannedTransfer=numeric(r.commercial?.plannedBulkTransferCost)??numeric(r.commercial?.plannedBulkTransferAvailable);
 // Do not let an inapplicable zero packaging/loss row invent a zero total.
 values.plannedTotal=r.plannedTotal??sumAvailable([values.plannedMaterialCost,...(filling.length?[values.plannedPackagingCost]:[]),values.plannedLabor,values.plannedWash]);
 values.actualTotal=r.actualTotal??sumAvailable([bulk.length?values.actualMaterialCost:actualTransfer,...(filling.length?[values.actualPackagingCost]:[]),values.actualLabor,values.actualWash,...(phases.some(p=>p.losses?.length)?[values.lossCost]:[])]);
 values.directActualTotal=bulk.length?values.actualTotal:values.fillingProcessingCost;
 values.productActualTotal=r.productActualTotal??(filling.length?sumAvailable([actualTransfer,values.fillingProcessingCost]):values.actualTotal);
 values.productPlannedTotal=r.productPlannedTotal??(filling.length?sumAvailable([plannedTransfer,values.plannedFillingProcessingCost]):values.plannedTotal);
 values.unitCostApplicable=Boolean(filling.length&&isPieces(r.unit));
 values.unitCost=values.unitCostApplicable&&values.productActualTotal!==null&&r.goodQuantity>0?values.productActualTotal/r.goodQuantity:null;
 const comparable=values.productActualTotal!==null&&r.goodQuantity>0&&numeric(r.invoicedQuantity)!==null&&r.invoicedQuantity>=0&&r.invoicedQuantity<=r.goodQuantity?values.productActualTotal*r.invoicedQuantity/r.goodQuantity:null;
 values.plannedMargin=difference(r.plannedRevenue,values.productPlannedTotal);values.actualMargin=difference(r.actualRevenue,comparable);
 const objective=sumAvailable(bulk.map(p=>p.actualGain));
 values.plannedObjective=r.plannedObjective??(new Set(bulk.map(p=>p.machineId)).size===1?sumAvailable(bulk.map(p=>p.plannedGain)):null);
 values.invoicedObjective=r.invoicedObjective??(new Set(bulk.map(p=>p.machineId)).size===1&&objective!==null&&comparable!==null?objective*r.invoicedQuantity/r.goodQuantity:null);
 values.plannedObjectiveVariance=difference(values.plannedMargin,values.plannedObjective);values.actualObjectiveVariance=difference(values.actualMargin,values.invoicedObjective);
 values.totalVariance=difference(values.plannedTotal,values.actualTotal);
 values.variancePercent=values.plannedTotal!=null&&values.plannedTotal!==0&&values.totalVariance!==null?values.totalVariance/Math.abs(values.plannedTotal)*100:null;
 // The OCT amount is the share already attributed to this production, not the
 // whole customer document and never the configured estimated selling price.
 values.octRevenue=numeric(r.commercial?.octRevenue);
 const targetObjective=values.plannedObjective;
 values.plannedWithObjective=values.plannedTotal!=null&&targetObjective!=null?values.plannedTotal+targetObjective:null;
 values.actualWithObjective=values.actualTotal!=null&&targetObjective!=null?values.actualTotal+targetObjective:null;
 values.octPlannedMargin=difference(values.octRevenue,values.plannedWithObjective);
 values.octActualMargin=difference(values.octRevenue,values.actualWithObjective);
 const stationTurns=bulk.length&&bulk.every(p=>p.actualTurns!=null)?bulk.reduce((s,p)=>s+p.actualTurns,0):null;
 values.realGainPerShift=r.closed&&!r.commercial?.octPartial&&new Set(bulk.map(p=>p.machineId)).size===1&&stationTurns>0&&values.octRevenue!=null&&values.actualTotal!=null?(values.octRevenue-values.actualTotal)/stationTurns:null;
 const partial=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v!=null&&r[k]==null]));
 partial.realGainPerShift=values.realGainPerShift!=null&&partial.actualTotal;
 partial.totalVariance=values.totalVariance!==null&&(partial.actualTotal||partial.plannedTotal);
 partial.variancePercent=values.variancePercent!==null&&partial.totalVariance;
 partial.octRevenue=values.octRevenue!==null&&Boolean(r.commercial?.octPartial);
 partial.actualWithObjective=partial.actualTotal||partial.plannedObjective;
 partial.plannedWithObjective=partial.plannedTotal||partial.plannedObjective;
 partial.octActualMargin=values.octActualMargin!==null&&(partial.octRevenue||partial.actualTotal);
 return {values,partial};
}
