const numeric=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))?Number(v):null;
export const sumAvailable=values=>{const known=values.map(numeric).filter(v=>v!==null);return known.length?known.reduce((a,b)=>a+b,0):null;};
const difference=(a,b)=>a!=null&&b!=null?a-b:null;
const materials=rows=>sumAvailable(rows.map(r=>numeric(r.quantity)!==null&&Number(r.quantity)>=0&&numeric(r.unitCost)!==null?Number(r.quantity)*Number(r.unitCost):null));

// Reporting values do not overwrite complete accounting values or source snapshots.
// Missing inputs remain unknown; every derived partial amount carries a flag.
export function availableCosts(r) {
 const phases=r.phases||[],bulk=phases.filter(p=>p.phase==="Semilavorato"),filling=phases.filter(p=>["Confezionamento","Astucciatura"].includes(p.phase));
 const original=r.baseline||r.historicalBaseline;
 const values={plannedMaterialCost:r.plannedMaterialSummary?.value??r.plannedMaterialCost,actualMaterialCost:r.actualMaterialSummary?.value??r.actualMaterialCost,
  plannedPackagingCost:r.plannedPackagingCost??materials(original?.packaging||[]),
  actualPackagingCost:r.actualPackagingCost??materials(r.productSl?.length?r.productSl.flatMap(d=>(d.materials||[]).slice(1)):(r.recoveredProducts||[]).filter(x=>x.kind==="Packaging"))};
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
 values.unitCost=filling.length&&values.productActualTotal!==null&&r.goodQuantity>0?values.productActualTotal/r.goodQuantity:null;
 const comparable=values.productActualTotal!==null&&r.goodQuantity>0&&numeric(r.invoicedQuantity)!==null&&r.invoicedQuantity>=0&&r.invoicedQuantity<=r.goodQuantity?values.productActualTotal*r.invoicedQuantity/r.goodQuantity:null;
 values.plannedMargin=difference(r.plannedRevenue,values.productPlannedTotal);values.actualMargin=difference(r.actualRevenue,comparable);
 const objective=sumAvailable(bulk.map(p=>p.actualGain));
 values.plannedObjective=r.plannedObjective??(new Set(bulk.map(p=>p.machineId)).size===1?sumAvailable(bulk.map(p=>p.plannedGain)):null);
 values.invoicedObjective=r.invoicedObjective??(new Set(bulk.map(p=>p.machineId)).size===1&&objective!==null&&comparable!==null?objective*r.invoicedQuantity/r.goodQuantity:null);
 values.plannedObjectiveVariance=difference(values.plannedMargin,values.plannedObjective);values.actualObjectiveVariance=difference(values.actualMargin,values.invoicedObjective);
 values.totalVariance=difference(values.actualTotal,values.plannedTotal);
 const partial=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v!=null&&r[k]==null]));
 partial.totalVariance=values.totalVariance!==null&&(partial.actualTotal||partial.plannedTotal);
 return {values,partial};
}
