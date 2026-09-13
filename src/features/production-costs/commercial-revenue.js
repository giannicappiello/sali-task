import { legacyOrderRevenue } from "./history.js";

const numeric=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))?Number(v):null;
const unit=v=>String(v||"").trim().toUpperCase();

// Only explicit line relationships are used. Customer/name matches cannot
// establish an allocation, especially between bulk KG and finished pieces.
export function resolveOctRevenue(evidence, orderLines, allEvidence) {
 const reasons=[],amounts=[];
 for(const link of evidence.links||[]){
  const row=orderLines.find(x=>String(x.id)===String(link.lineId));
  const reference=link.oct||link.lineId;
  if(!row){reasons.push(`OCT ${reference}: riga Workspace non disponibile o non accessibile.`);continue;}
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
 return {octRevenue:null,octPartial:false,octSource:null,octReasons:reasons};
}
