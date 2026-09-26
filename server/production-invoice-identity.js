import {invoiceOrderReferences} from './invoice-order-references.js';
import {octReference} from '../src/features/production-costs/oct-evidence.js';
const norm=v=>String(v??'').trim().toUpperCase();
export function recoverInvoiceIdentity(e,all,headers,lines,now=new Date().toISOString()){
 if(norm(e.customerCode)||e.sourceOrder||(e.links||[]).length)return e;
 const reference=octReference(e.orderNumber);if(!reference)return e;
 const candidates=[];
 for(const h of headers){
  if(norm(h.sigla)!=='FT'||!norm(h.codice_cliente))continue;
  const refs=invoiceOrderReferences(h,lines);
  for(const l of lines.filter(l=>String(l.fattura_id)===String(h.id)&&norm(l.codice_articolo)===norm(e.articleCode))){
   if(!(h.dati_mexal?.id_rif_testata||[]).some(x=>String(x[0])===String(l.posizione)))continue;
   const resolved=refs.get(String(l.id)),ref=resolved?.reference;
   const raw=String(resolved?.date||'').replaceAll('-','');
   if(ref!==reference||!/^\d{8}$/.test(raw))continue;
   const year=Number(raw.slice(0,4)),productionYear=Number(String(e.date||e.works?.[0]?.start||'').slice(0,4));
   if(!productionYear||year>productionYear||year<productionYear-1)continue;
   const siblings=all.filter(x=>norm(x.articleCode)===norm(e.articleCode)&&octReference(x.sourceOrder?.reference||x.orderNumber)===reference&&(!norm(x.customerCode)||norm(x.customerCode)===norm(h.codice_cliente)));
   if(siblings.length!==1||String(siblings[0].id)!==String(e.id))continue;
   candidates.push({customerCode:h.codice_cliente,reference,date:`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`,invoiceId:h.id,invoiceLineId:l.id});
  }
 }
 const identities=new Set(candidates.map(x=>`${x.customerCode}/${x.reference}/${x.date}`));
 if(identities.size!==1)return e;
 return {...e,customerCode:candidates[0].customerCode,commercialIdentity:{...candidates[0],source:'Riferimento OC esplicito sulla riga fattura e articolo univoco',recoveredAt:now,evidence:candidates}};
}
