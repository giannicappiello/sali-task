import {octTargets} from '../src/features/production-costs/oct-evidence.js';
// Only a single explicit originating OCT and a unique production/article qualify.
export function automaticInvoiceMatches(e, allEvidence, headers, lines, allocations) {
 const result=[];
 for(const h of headers){
  if(h.sigla!=="FT"||h.codice_cliente!==e.customerCode)continue;
  const d=h.dati_mexal||{},value=(key,pos)=>(d[key]||[]).find(r=>r[0]===pos)?.[1];
  const refs=(d.sigla_ordine||[]).map(([pos,sigla])=>({reference:`${sigla}+${Number(value("serie_ordine",pos))}+${Number(value("numero_ordine",pos))}`,year:Number(String(value("data_ordine",pos)||"").slice(0,4))}));
  const unique=[...new Map(refs.map(r=>[r.reference+"/"+r.year,r])).values()];
  for(const l of lines.filter(l=>l.fattura_id===h.id&&l.codice_articolo===e.articleCode)){
  const group=value("id_rif_testata",Number(l.posizione));
  const ref=group!=null?refs.find((r,i)=>(d.sigla_ordine||[])[i][0]===group):(unique.length===1?unique[0]:null);
  if(!ref?.reference.startsWith("OC+")||!ref.year)continue;
  const candidates=allEvidence.filter(x=>x.customerCode===e.customerCode&&x.articleCode===e.articleCode&&octTargets(x).some(t=>t.reference===ref.reference&&Number(String(t.date||"").slice(0,4))===ref.year));
  if(candidates.length!==1||candidates[0].id!==e.id)continue;
   if(l.valore_netto==null||!Number.isFinite(Number(l.valore_netto))||allocations.some(a=>String(a.invoice_line_id)===String(l.id)))continue;
   result.push({id:`auto-${l.id}`,document:{id:h.id,sigla:h.sigla,serie:h.serie,numero:h.numero,data_documento:h.data_documento},amount:Number(l.valore_netto),quantity:null,source:"OC originale e articolo univoci"});
  }
 }
 return result;
}
