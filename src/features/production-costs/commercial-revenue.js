import { legacyOrderRevenue } from "./history.js";
import { octTargets,recoveredOctShare,octReference } from "./oct-evidence.js";

const numeric=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))?Number(v):null;
const unit=v=>String(v||"").trim().toUpperCase();

// Only explicit line relationships are used. Customer/name matches cannot
// establish an allocation, especially between bulk KG and finished pieces.
export function resolveOctRevenue(evidence, orderLines, allEvidence) {
 const override=evidence.authorizedInvoicePricing;
 if(override?.authorized===true&&String(override.productionId)===String(evidence.id)&&
   override.reference===octReference(evidence.sourceOrder?.reference||evidence.orderNumber)&&
   override.customerCode===evidence.customerCode&&unit(override.articleCode)===unit(evidence.articleCode)&&
   unit(override.unit)===unit(evidence.unit)&&numeric(override.quantity)===numeric(evidence.quantity)&&
   numeric(override.unitPrice)!==null&&override.unitPrice>=0&&override.quantity>0){
  return {octRevenue:Math.round(override.unitPrice*override.quantity*100)/100,octPartial:false,
   octSource:"Valore OC ricostruito su autorizzazione: prezzo netto unitario della fattura × quantità della lavorazione",
   octReasons:[`Prezzo da ${override.invoiceReference}; quantità di riferimento ${override.quantity} ${override.unit}. Non è il fatturato effettivo.`]};
 }
 const reasons=[],amounts=[];
 const targets=octTargets(evidence),recovered=[];
 for(const target of targets){
  const share=recoveredOctShare(evidence,target,allEvidence);
  if(share.value!==null)recovered.push(share);
  else if((evidence.recoveredOctLines||[]).some(r=>r.targetKey===target.key))reasons.push(`${target.reference}: ${share.reason}`);
  else if((evidence.recoveredOctLines||[]).length){
   const link=(evidence.links||[]).find(l=>String(l.lineId)===target.key);
   const row=link&&orderLines.find(r=>String(r.id)===target.key);
   const qty=numeric(link?.quantity),ordered=numeric(row?.quantita),net=numeric(row?.imponibile_riga);
   if(row&&unit(link.unit)&&unit(link.unit)===unit(row.unita_misura_oct)&&
    (!row.codice_articolo||unit(row.codice_articolo)===unit(target.articleCode))&&
    qty>0&&ordered>0&&qty<=ordered+0.000001&&net!==null)recovered.push({value:net*qty/ordered,workspace:true});
   else reasons.push(`${target.reference}: riga OCT non recuperata né valorizzabile dai collegamenti Workspace.`);
  }
 }
 if(recovered.length===targets.length&&recovered.length)return {
  octRevenue:recovered.reduce((sum,r)=>sum+r.value,0),octPartial:false,
  octSource:recovered.some(r=>r.workspace)?"Righe OCT originali Mexal e righe Workspace attribuite alla produzione":"Righe originali Mexal verificate, proporzionate alla quantità della produzione",octReasons:evidence.octRecovery?.warnings||[]
 };
 // A verified original that cannot be allocated must not fall back to a stale
 // legacy amount (or to an estimated selling price).
 if((evidence.recoveredOctLines||[]).length)return {octRevenue:recovered.length?recovered.reduce((sum,r)=>sum+r.value,0):null,
  octPartial:recovered.length>0,octSource:recovered.length?"Righe originali Mexal verificate":null,
  octReasons:[...reasons,...(evidence.octRecovery?.warnings||[])]};
 for(const link of evidence.links||[]){
  const row=orderLines.find(x=>String(x.id)===String(link.lineId));
  const reference=link.oct||link.lineId;
  if(!row){reasons.push(`OCT ${reference}: riga Workspace non disponibile o non accessibile.`);continue;}
  if(row.codice_articolo&&evidence.articleCode&&String(row.codice_articolo).trim().toUpperCase()!==String(evidence.articleCode).trim().toUpperCase()){
   reasons.push(`OCT ${reference}: articolo della riga diverso dall'articolo della produzione.`);continue;
  }
  if(!unit(link.unit)||unit(row.unita_misura_oct)!==unit(link.unit)){
   reasons.push(`OCT ${reference}: unità della riga ordine e del collegamento assenti o diverse.`);continue;
  }
  const qty=numeric(link.quantity),ordered=numeric(row.quantita),net=numeric(row.imponibile_riga);
  if(qty===null||qty<=0||ordered===null||ordered<=0||qty>ordered+0.000001){
   reasons.push(`OCT ${reference}: quantità attribuita non verificabile rispetto alla riga ordine.`);continue;
  }
  if(net===null){reasons.push(`OCT ${reference}: imponibile della riga ordine non disponibile.`);continue;}
  amounts.push(net*qty/ordered);
 }
 if(amounts.length)return {octRevenue:amounts.reduce((a,b)=>a+b,0),octPartial:reasons.length>0,octSource:"Righe OCT Workspace attribuite alla produzione",octReasons:reasons};
 const legacy=legacyOrderRevenue(evidence,allEvidence);
 if(legacy!==null)return {octRevenue:legacy,octPartial:false,octSource:"Riga ordine cliente storica MES, proporzionata alla quantità della produzione",octReasons:[]};
 const s=evidence.sourceOrder;
 if(!s?.mesLineId)reasons.push("Collegamento alla riga ordine cliente storica MES non disponibile.");
 else if(s.articleCode!==evidence.articleCode)reasons.push(`Articolo ordine ${s.articleCode||"assente"} diverso dall’articolo prodotto ${evidence.articleCode||"assente"}: ricavo non ripartibile automaticamente.`);
 else if(!unit(s.unit)||unit(s.unit)!==unit(evidence.unit))reasons.push("Unità ordine e produzione assenti o diverse: conversione economica non disponibile.");
 else if(!(s.lineValue>0))reasons.push("Valore netto della riga ordine storica MES non disponibile.");
 else reasons.push("Quantità della riga ordine storica MES non disponibile o superata dalle produzioni collegate.");
 return {octRevenue:null,octPartial:false,octSource:null,octReasons:[...reasons,...(evidence.octRecovery?.warnings||[])]};
}
