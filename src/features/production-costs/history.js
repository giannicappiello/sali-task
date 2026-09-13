const number = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

export function evidenceDate(evidence) {
 // A reconstructed formula is not a new production date.
 return String(evidence.baseline?.capturedAt || evidence.works?.find(w => w.start)?.start || evidence.date || "").slice(0,10);
}
export function applicableConfiguration(evidence, configurations) {
 const date=evidenceDate(evidence);
 return configurations.filter(c=>c.effective_from<=date).sort((a,b)=>
  b.effective_from.localeCompare(a.effective_from)||String(b.created_at).localeCompare(String(a.created_at)))[0]||null;
}
export function historicalConsumption(evidence) {
 return (evidence.historicalMaterials||[]).filter(m=>m.withdrawnAt).map(m=>({...m,
  unitCost:number(m.currentUnitCost)>0?Number(m.currentUnitCost):null,
  valuationSource:"Quantità scaricata in MES; valorizzazione ricostruita al costo ultimo disponibile, non prezzo SL storico",
 }));
}
export function legacyOrderRevenue(evidence, allEvidence) {
 const source=evidence.sourceOrder;
 if(!source||!source.mesLineId||source.articleCode!==evidence.articleCode||!source.unit||
  source.unit.toUpperCase()!==String(evidence.unit).toUpperCase()||!(source.quantity>0)||!(source.lineValue>0))return null;
 const siblings=allEvidence.filter(e=>e.sourceOrder?.mesLineId===source.mesLineId);
 if(siblings.some(e=>e.articleCode!==source.articleCode||String(e.unit).toUpperCase()!==source.unit.toUpperCase()))return null;
 if(siblings.reduce((sum,e)=>sum+Number(e.quantity||0),0)>Number(source.quantity)+0.000001)return null;
 return Number(source.lineValue)*Number(evidence.quantity)/Number(source.quantity);
}
