import { materialBaseline, materialCode } from "./material-baseline.js";

export function packagingBaseline(evidence) {
 const historical=evidence.historicalPackaging?.packaging ?? evidence.historicalBaseline?.packaging ?? [];
 return materialBaseline({baseline:{materials:evidence.baseline?.packaging||[]},
  historicalBaseline:{materials:historical}});
}
const documentKey=d=>String(d.document||"").toUpperCase().replace(/\s+/g,"").replaceAll("+","/");
// Frozen copies stay intact and take precedence for the same document. Historical
// retrieval may add missing documents, never add the same consumption twice.
export function productDocuments(evidence) {
 const originals=Array.isArray(evidence.productSl)?evidence.productSl:[];
 const keys=new Set(originals.filter(d=>d.materials?.length).map(documentKey));
 const recovered=new Map((evidence.historicalProductSl||[]).map(d=>[documentKey(d),d]));
 return [...originals.filter(d=>d.materials?.length).map(d=>{
  const historical=recovered.get(documentKey(d));
  if(!historical)return d;
  const merged=materialBaseline({baseline:{materials:d.materials.map((m,i)=>({...m,kind:m.kind||(i===0?"Bulk":"Packaging")}))},
   historicalBaseline:{materials:historical.materials||[]}});
  return {...d,materials:merged.rows,...(merged.recovered?{supplementedAt:historical.recoveredAt,
   valuationSource:(d.valuationSource||"Snapshot SL originale.")+" Righe mancanti integrate dallo SL storico Mexal."}:{})};
 }),
  ...(evidence.historicalProductSl||[]).filter(d=>d.materials?.length&&!keys.has(documentKey(d)))];
}
export function productRows(evidence) {
 const bulkCode=materialCode(evidence.historicalPackaging?.bulkCode);
 return productDocuments(evidence).flatMap(d=>(d.materials||[]).map((m,i)=>({...m,
  // Old MES snapshots have a documented bulk-first contract. Retrieved SLs use
  // explicit classification; their line order must never decide the material kind.
  kind:m.kind||(d.recoveredAt?(bulkCode&&materialCode(m.code)===bulkCode?"Bulk":"Unknown"):(i===0?"Bulk":"Packaging"))
 })));
}
