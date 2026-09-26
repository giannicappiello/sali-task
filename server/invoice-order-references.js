// Resolve explicit order references first. A missing delivery reference can only
// inherit from the same article AND the same Mexal lot in this invoice.
const code=v=>String(v??'').trim().toUpperCase();
const same=(a,b)=>String(a??'').trim()===String(b??'').trim();
export function invoiceOrderReferences(header,lines){
 const d=header.dati_mexal||{},value=(key,pos)=>(d[key]||[]).find(r=>same(r[0],pos))?.[1];
 const refs=(d.sigla_ordine||[]).map(([pos,sigla])=>({group:pos,reference:`${code(sigla)}+${Number(value('serie_ordine',pos))}+${Number(value('numero_ordine',pos))}`,year:Number(String(value('data_ordine',pos)||'').slice(0,4)),date:String(value('data_ordine',pos)||'')}));
 const unique=[...new Map(refs.map(r=>[r.reference+'/'+r.year,r])).values()];
 const own=lines.filter(l=>same(l.fattura_id,header.id));
 const direct=l=>{const group=value('id_rif_testata',l.posizione);return group!=null?refs.find(r=>same(r.group,group)):(unique.length===1?unique[0]:null);};
 const lots=l=>{const start=Number(value('pos_righe_lotto',l.posizione)),count=Number(value('nr_righe_lotto',l.posizione));if(!start||!count)return [];return Array.from({length:count},(_,i)=>value('id_lotto',start+i)).filter(v=>v!=null&&Number(v)>0).map(String);};
 return new Map(own.map(l=>{
  const explicit=direct(l);if(explicit)return [String(l.id),explicit];
  const group=value('id_rif_testata',l.posizione);
  // Incomplete or conflicting explicit fields must never be overwritten.
  if(group==null||['sigla_ordine','serie_ordine','numero_ordine','data_ordine'].some(k=>value(k,group)!=null))return [String(l.id),null];
  const lotIds=lots(l);if(!lotIds.length)return [String(l.id),null];
  const candidates=lotIds.map(id=>[...new Map(own.filter(other=>code(other.codice_articolo)===code(l.codice_articolo)&&lots(other).includes(id)&&direct(other)).map(other=>{const r=direct(other);return [r.reference+'/'+r.year,r];})).values()]);
  if(candidates.some(a=>a.length!==1))return [String(l.id),null];
  const identities=new Set(candidates.map(a=>a[0].reference+'/'+a[0].year));
  return [String(l.id),identities.size===1?{...candidates[0][0],viaLot:true}:null];
 }));
}
