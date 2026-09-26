import {invoiceOrderReferences} from './invoice-order-references.js';
import {octTargets} from '../src/features/production-costs/oct-evidence.js';
// Match imported invoice rows on every report read; never cache absence of an invoice.
const code=value=>String(value??'').trim().toUpperCase();
const same=(a,b)=>String(a??'').trim()===String(b??'').trim();
export function automaticInvoiceMatches(e, allEvidence, headers, lines, allocations) {
 const result=[],seen=new Set();
 for(const h of headers){
  if(code(h.sigla)!=="FT"||code(h.codice_cliente)!==code(e.customerCode))continue;
  const refs=invoiceOrderReferences(h,lines);
  for(const l of lines.filter(l=>same(l.fattura_id,h.id)&&code(l.codice_articolo)===code(e.articleCode))){
  const ref=refs.get(String(l.id));
  if(!ref?.reference.startsWith("OC+")||!ref.year)continue;
  const candidates=allEvidence.filter(x=>code(x.customerCode)===code(e.customerCode)&&code(x.articleCode)===code(e.articleCode)&&octTargets(x).some(t=>t.reference===ref.reference&&Number(String(t.date||"").slice(0,4))===ref.year));
  if(candidates.length!==1||!same(candidates[0].id,e.id))continue;
   if(l.valore_netto==null||!Number.isFinite(Number(l.valore_netto))||allocations.some(a=>String(a.invoice_line_id)===String(l.id)))continue;
   if(seen.has(String(l.id)))continue;seen.add(String(l.id));
   result.push({invoiceLineId:l.id,invoiceQuantity:l.quantita==null?null:Number(l.quantita),orderReference:ref.reference,orderYear:ref.year,id:`auto-${l.id}`,document:{id:h.id,sigla:h.sigla,serie:h.serie,numero:h.numero,data_documento:h.data_documento},amount:Number(l.valore_netto),quantity:null,source:ref.viaArticle?"Righe valorizzate dello stesso articolo nella fattura, con OC univoco":ref.viaLot?"Stesso articolo e lotto Mexal di una riga con OC esplicito":"OC originale e articolo univoci"});
  }
 }
 return result;
}
