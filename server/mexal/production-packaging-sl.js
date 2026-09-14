import { buildMexalClient } from "./sync-products.js";
import { materialCode } from "../../src/features/production-costs/material-baseline.js";
const text=v=>String(v??"").trim();
const num=v=>v===null||v===undefined||text(v)===""?null:Number.isFinite(Number(text(v).replace(",",".")))?Number(text(v).replace(",",".")):null;
const matrix=v=>new Map((Array.isArray(v)?v:[]).filter(r=>Array.isArray(r)&&r.length>=2).map(r=>[Number(r[0]),r[1]]));
const headerIndexes=new Map();
const collectionRows=p=>Array.isArray(p)?p:p?.dati||p?.records||p?.items||p?.data||[];
// Legacy MES orders can have lost their customer link. Resolve the account from
// the warehouse document index, never by guessing a customer or reading an OCT.
export async function slHeaders(mexal,reference,{deadline=Date.now()+40000,cache=headerIndexes}={}) {
 const key=[mexal.baseUrl,mexal.azienda,mexal.anno].join("|");
 let index=cache.get(key);
 if(!index||Date.now()-index.createdAt>300000){
  index={createdAt:Date.now(),next:null,seen:new Set(),rows:[],complete:false};cache.set(key,index);
  if(cache.size>8)cache.delete(cache.keys().next().value);
 }
 while(!index.complete&&Date.now()<deadline){
  const params=new URLSearchParams({max:"500",fields:"sigla,serie,numero,cod_conto,data_documento"});
  if(index.next)params.set("next",index.next);
  const result=await mexal.getJson("/documenti/movimenti-magazzino?"+params);
  const rows=collectionRows(result);
  if(!Array.isArray(rows))throw new Error("Indice documenti Mexal non leggibile.");
  index.rows.push(...rows.filter(r=>text(r.sigla).toUpperCase()==="SL"));
  const next=result?.next||null;
  if(next&&index.seen.has(next))throw new Error("Indice documenti Mexal non completato.");
  if(next)index.seen.add(next);
  index.next=next;index.complete=!next;
 }
 if(!index.complete)throw new Error("Indice SL ancora incompleto: ripetere il recupero.");
 return [...new Map(index.rows.filter(r=>num(r.serie)===reference.series&&num(r.numero)===reference.number)
  .map(r=>[text(r.cod_conto),r])).values()];
}
export function slReferences(value) {
 return [...new Map([...text(value).matchAll(/\bSL\s*[+ /]\s*(\d+)\s*[/+]\s*(\d+)\b/gi)]
  .map(m=>[Number(m[1])+"/"+Number(m[2]),{series:Number(m[1]),number:Number(m[2]),document:`SL ${Number(m[1])}/${Number(m[2])}`}])).values()];
}
export function parsePackagingSl(detail,{reference,year,customer,bulkCode,packagingCodes=[],now=new Date().toISOString()}) {
 const rawDate=text(detail.data_documento).replaceAll("-","").slice(0,8);
 if(text(detail.sigla).toUpperCase()!=="SL"||num(detail.serie)!==reference.series||num(detail.numero)!==reference.number||
    text(detail.cod_conto)!==customer||!/^\d{8}$/.test(rawDate)||Number(rawDate.slice(0,4))!==year)
  throw new Error("Identità SL non corrispondente a riferimento, anno e cliente.");
 const code=matrix(detail.codice_articolo),qty=matrix(detail.quantita),type=matrix(detail.tp_riga),
  description=matrix(detail.descr_articolo),cost=matrix(detail.costo_ult),price=matrix(detail.prezzo),
  unit=matrix(detail.unita_misura),lotPosition=matrix(detail.pos_righe_lotto),lotCount=matrix(detail.nr_righe_lotto),
  lots=matrix(detail.id_lotto),lotQuantities=matrix(detail.qta_lotto);
 const packaging=new Set(packagingCodes.map(materialCode));
 const hasBulk=Boolean(bulkCode&&[...code.values()].some(c=>materialCode(c)===materialCode(bulkCode)));
 const materials=[...code].sort((a,b)=>a[0]-b[0]).filter(([i,c])=>text(c)&&(!type.get(i)||type.get(i)==="R")).map(([i,c])=>{
  const normalized=materialCode(c),lotRows=[];
  const start=num(lotPosition.get(i)),count=num(lotCount.get(i));
  if(start!==null&&count>0)for(let n=start;n<start+Math.min(count,10000);n++)
   lotRows.push({lotId:lots.get(n)??null,quantity:num(lotQuantities.get(n))});
  return {position:i,code:text(c),description:description.get(i)||null,quantity:num(qty.get(i)),unit:unit.get(i)||null,
   unitCost:num(cost.get(i))>0?num(cost.get(i)):num(price.get(i))>0?num(price.get(i)):null,
   kind:normalized===materialCode(bulkCode)&&bulkCode?"Bulk":packaging.has(normalized)||hasBulk?"Packaging":"Unknown",
   lotId:lotRows.map(l=>l.lotId).filter(x=>x!==null).join(", ")||null,lots:lotRows};
 });
 if(!materials.length)throw new Error("SL senza righe articolo leggibili.");
 return {document:reference.document,year,customer,warehouse:detail.id_magazzino??null,
  date:`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`,recoveredAt:now,materials,
  valuationSource:"SL storico letto da Mexal: quantità e costi del documento disponibile. Prezzi assenti o zero non valorizzati; non è uno snapshot congelato all'emissione."};
}

// Only GET on exact existing documents. Bound each recovery to one production;
// failures leave prior evidence available and are returned as explicit diagnostics.
export async function recoverPackagingSl(evidence,{clientForYear=year=>buildMexalClient({year,warehouse:null,timeoutMs:7000}),findHeaders=slHeaders,now=new Date().toISOString()}={}) {
 const references=slReferences(evidence.productSlReference),documents=[],warnings=[];
 const works=(evidence.works||[]).filter(w=>["Confezionamento","Astucciatura"].includes(w.phase));
 const dates=works.flatMap(w=>[w.start,w.end]).filter(Boolean);
 const years=[...new Set((dates.length?dates:[evidence.date]).map(d=>Number(String(d).slice(0,4))).filter(y=>y>=2000&&y<=Number(now.slice(0,4))))];
 const customers=[...new Set([evidence.customerCode,...(evidence.links||[]).map(l=>l.customerCode)].map(text).filter(Boolean))];
 const codes=[...(evidence.baseline?.packaging||[]),...(evidence.historicalPackaging?.packaging||[]),
  ...(evidence.historicalBaseline?.packaging||[]),...(evidence.historicalProductConsumption||[]).filter(m=>m.kind==="Packaging")].map(m=>m.code);
 const bulkCode=evidence.historicalPackaging?.bulkCode||(evidence.historicalProductConsumption||[]).find(m=>m.kind==="Bulk")?.code;
 const deadline=Date.now()+45000;
 if(!references.length&&evidence.productSlReference)warnings.push("Riferimento SL confezionamento non riconosciuto.");
 for(const reference of references){
  const matches=[];let failed=false;
  if(!years.length){warnings.push(reference.document+": anno mancante.");continue;}
  for(const year of years){
   const mexal=clientForYear(year);
   let accounts=customers;
   if(!accounts.length){
    try{accounts=(await findHeaders(mexal,reference,{deadline})).map(r=>text(r.cod_conto));}
    catch{failed=true;continue;}
   }
   for(const customer of accounts){
   if(Date.now()>deadline){failed=true;continue;}
   try{
    const path=`/documenti/movimenti-magazzino/SL+${reference.series}+${reference.number}+${encodeURIComponent(customer)}`;
    const detail=await mexal.getJson(path);
    matches.push(parsePackagingSl(detail,{reference,year,customer,bulkCode,packagingCodes:codes,now}));
   }catch(error){
    // A transport/auth error must not allow a partial search to resolve ambiguity.
    if(![404,400].includes(error.httpStatus||error.status))failed=true;
   }
  }
  }
  if(matches.length===1&&!failed)documents.push(matches[0]);
  else warnings.push(reference.document+": "+(matches.length>1?"riferimento ambiguo tra anni/clienti.":failed?"lettura incompleta; riprovare il recupero.":"documento non trovato."));
 }
 const keys=new Set(documents.map(d=>d.document));
 return {documents:[...documents,...(evidence.historicalProductSl||[]).filter(d=>!keys.has(d.document)&&references.some(r=>r.document===d.document))],
  warnings,recoveredAt:now};
}
