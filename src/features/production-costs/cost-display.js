import { availableCosts } from "./available-costs.js";
export function displayRecord(record) {
 const {values,partial}=availableCosts(record);
 return {...record,...values,costPartial:partial,completeCosts:record};
}
export function costRows(record) {
 const r=record.completeCosts||record,shown=displayRecord(r);
 const partial=(value,complete)=>value!=null&&complete==null;
 return [
  {name:"Materie prime",p:r.plannedMaterialSummary?.value??r.plannedMaterialCost,a:r.actualMaterialSummary?.value??r.actualMaterialCost,
   pp:partial(r.plannedMaterialSummary?.value,r.plannedMaterialCost),ap:partial(r.actualMaterialSummary?.value,r.actualMaterialCost),
   info:`Somma quantità × prezzo dei componenti valorizzati. Componenti senza valorizzazione preventiva: ${(r.plannedMaterialSummary?.missingCodes||[]).join(", ")||"nessuno rilevato"}; consuntiva: ${(r.actualMaterialSummary?.missingCodes||[]).join(", ")||"nessuno rilevato"}. I dati mancanti sono consultabili in Materiali e SL; non vengono trattati come zero.`},
  {name:"Packaging",p:r.plannedPackagingCost,a:r.actualPackagingCost,info:"Materiali di confezionamento. Il trasferimento del bulk non viene addebitato una seconda volta."},
  {name:"Personale",p:r.plannedLabor,a:r.actualLabor,info:"Costo calcolato secondo i criteri STATION e FILLING configurati. Criteri e medie storiche sono consultabili nell’icona informazioni del dettaglio."},
  {name:"Lavaggi (esclusa manodopera)",p:r.plannedWash,a:r.actualWash,info:"Numero lavaggi × costo configurato. La manodopera resta nella voce Personale. Il consuntivo richiede il conteggio confermato."},
  {name:"Perdite componenti SL",p:0,a:r.lossCost,info:"Perdite dei componenti documentate e confermate nello SL, aggiunte una sola volta ai costi."},
  {name:"Totale costi",p:r.plannedTotal??r.plannedKnownSubtotal,a:r.actualTotal??r.actualKnownSubtotal,
   pp:partial(r.plannedKnownSubtotal,r.plannedTotal),ap:partial(r.actualKnownSubtotal,r.actualTotal),
   info:"Somma di tutti i costi disponibili. Anche margini e costo al pezzo vengono calcolati con queste somme: Parziale indica che il risultato non include le componenti ancora mancanti."},
  {name:"Ricavo OCT / fatture",p:r.plannedRevenue,a:r.actualRevenue,separate:true,info:"Preventivo da OCT o stima configurata; consuntivo dalle fatture attribuite. Non vengono sommati tra loro. IVA esclusa; fatturato non equivale a incasso."},
  {name:"Margine (consuntivo sulla quantità fatturata)",p:r.plannedMargin,a:r.actualMargin,separate:true,info:"Ricavo meno costi disponibili attribuiti alla stessa quantità. Se i costi sono parziali, il margine è provvisorio e può diminuire quando vengono valorizzate le componenti mancanti."},
  {name:"Margine obiettivo STATION (consuntivo proporzionato al fatturato)",p:r.plannedObjective,a:r.invoicedObjective,separate:true,info:"Obiettivo configurato per STATION e turni, proporzionato alla quantità fatturata quando il collegamento è verificabile."},
  {name:"Margine oltre / sotto obiettivo STATION",p:r.plannedObjectiveVariance,a:r.actualObjectiveVariance,separate:true,info:"Differenza tra margine sui costi disponibili e obiettivo STATION. Resta non disponibile solo quando mancano le basi del confronto, come il ricavo o l’obiettivo."}
 ].map((row,i)=>{
  const keys=[["plannedMaterialCost","actualMaterialCost"],["plannedPackagingCost","actualPackagingCost"],["plannedLabor","actualLabor"],["plannedWash","actualWash"],[null,"lossCost"],["plannedTotal","actualTotal"],["plannedRevenue","actualRevenue"],["plannedMargin","actualMargin"],["plannedObjective","invoicedObjective"],["plannedObjectiveVariance","actualObjectiveVariance"]][i];
  return {...row,...(keys[0]?{p:shown[keys[0]],pp:Boolean(shown.costPartial[keys[0]])}:{}),a:shown[keys[1]],ap:Boolean(shown.costPartial[keys[1]])};
 });
}
