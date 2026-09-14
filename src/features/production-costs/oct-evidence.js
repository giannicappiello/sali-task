const text=v=>String(v??"").trim();
export const octNumber=v=>v!==null&&v!==undefined&&text(v)!==""&&Number.isFinite(Number(v))?Number(v):null;
export const octCode=v=>text(v).toUpperCase();
export function octReference(value){
 const m=text(value).match(/^(?:OC|OCT)\s*[/+]\s*(\d+)\s*[/+]\s*(\d+)$/i);
 return m?`OC+${Number(m[1])}+${Number(m[2])}`:null;
}
export function octTargets(e){
 const source=e.sourceOrder,links=e.links||[];
 return (links.length?links.map(l=>({key:String(l.lineId),reference:octReference(l.oct),customerCode:l.customerCode,
  articleCode:l.articleCode||e.articleCode,unit:l.unit,quantity:l.quantity,date:l.date||source?.date||e.date,exactYear:Boolean(l.date||source?.date)})):
  [{key:"source",reference:octReference(source?.reference||e.orderNumber),customerCode:source?.customerCode||e.customerCode,
   articleCode:e.articleCode,unit:e.unit,quantity:e.quantity,date:source?.date||e.date,exactYear:Boolean(source?.date)}]);
}
export function recoveredOctShare(e,target,allEvidence){
 const found=(e.recoveredOctLines||[]).filter(r=>r.targetKey===target.key&&r.reference===target.reference&&
  octCode(r.articleCode)===octCode(target.articleCode)&&octCode(r.unit)===octCode(target.unit)&&
  (!target.exactYear||r.year===Number(String(target.date).slice(0,4)))&&
  (!target.customerCode||r.customerCode===target.customerCode));
 if(found.length!==1)return {value:null,reason:"Riga OCT originale non recuperata univocamente."};
 const row=found[0],qty=octNumber(target.quantity),ordered=octNumber(row.quantity),net=octNumber(row.lineValue);
 if(qty===null||qty<=0||ordered===null||ordered<=0||net===null)return {value:null,reason:"Quantità o importo netto OCT non disponibili."};
 // Include siblings not yet refreshed: a batch must not temporarily allocate the
 // complete order to every production. The original reference and article identify
 // the same commercial pool even when MES line IDs differ or are absent.
 let allocated=0;
 const records=new Map([...allEvidence,e].map(r=>[r.id??r,r]));
 for(const sibling of records.values())for(const t of octTargets(sibling)){
  if(t.reference!==target.reference||octCode(t.articleCode)!==octCode(row.articleCode))continue;
  if(t.customerCode&&t.customerCode!==row.customerCode)continue;
  const year=Number(String(t.date||"").slice(0,4));
  if(t.exactYear&&year!==row.year)continue;
  if(octCode(t.unit)!==octCode(row.unit)||octNumber(t.quantity)===null||Number(t.quantity)<=0)
   return {value:null,reason:"Produzioni collegate con quantità o unità non confrontabili."};
  allocated+=Number(t.quantity);
 }
 if(allocated>ordered+0.000001)return {value:null,reason:"Quantità complessiva delle produzioni superiore alla riga OCT: attribuzione da verificare."};
 return {value:net*qty/ordered,row};
}
