import crypto from 'node:crypto';
import {AMAZON_CUSTOMER_CODE,amazonOrderDate} from './amazon-cox.js';
import {sameFirstDecimal} from '../../shared/moneyFirstDecimal.js';

const cents=value=>value!=null && value!=='' && Number.isFinite(Number(value))?Math.round(Number(value)*100):null;
const text=value=>String(value ?? '').trim();
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const scalar=value=>Array.isArray(value)?value[0]?.[1]:value;
export const refundMarker=eventId=>'RESO:'+crypto.createHash('sha256').update(eventId).digest('hex').slice(0,24);

// The financial event identifies the refund. A physical return alone never
// invents a refund amount, and absent disposition never restocks a sale SKU.
export function buildRefundCox(refund,{customer,articles,mappings,dispositions=new Map()}) {
  assert(refund.event_id && /^\d{3}-\d{7}-\d{7}$/.test(refund.amazon_order_id),'Identità rimborso Amazon non valida.');
  assert(refund.currency==='EUR','Rimborso Amazon in valuta diversa da EUR.');
  assert(customer?.codice===AMAZON_CUSTOMER_CODE && text(customer.ragione_sociale).toUpperCase()==='CLIENTE AMAZON','Cliente Amazon non verificato.');
  assert(Array.isArray(refund.items) && refund.items.length>0,'Rimborso senza righe finanziarie.');
  const prepared=refund.items.flatMap(item=>{
    const quantity=Number(item.quantity),gross=cents(item.gross),net=cents(item.net),tax=cents(item.tax);
    assert(Number.isSafeInteger(quantity) && quantity>0,'Quantità rimborsata non disponibile.');
    assert(gross>0 && net>=0 && tax>=0 && net+tax===gross,'Importi rimborso non riconciliati.');
    const disposition=dispositions.get(item.line_id);
    const realQuantity=disposition?.confirmed===true?Number(disposition.sellableQuantity || 0):0;
    assert(Number.isSafeInteger(realQuantity) && realQuantity>=0 && realQuantity<=quantity,'Quantità vendibile del reso non verificata.');
    const matches=mappings.filter(m=>m.external_sku===item.sku && m.marketplace===refund.marketplace && m.status==='matched');
    assert(!realQuantity || (matches.length===1 && /^IT/i.test(matches[0].codice_mexal)),'Articolo del reso vendibile non associato in modo univoco.');
    return [[matches[0]?.codice_mexal,realQuantity],['RESOAMAZON',quantity-realQuantity]].filter(([,n])=>n>0).map(([code,n])=>{
      const article=articles.get(code);
      assert(article && text(article.codice)===code,'Articolo Mexal del reso non verificato: '+code);
      const vat=refund.vat_code==='N41'?'N41':text(article.alq_iva);
      assert(vat,'Codice IVA del reso non disponibile.');
      return {code,quantity:-n,price:Number((gross/100/quantity).toFixed(4)),vat,gross:gross*n/quantity,net:net*n/quantity,tax:tax*n/quantity};
    });
  });
  const total=prepared.reduce((sum,row)=>sum+row.gross,0),tax=prepared.reduce((sum,row)=>sum+row.tax,0);
  assert(Math.abs(total-cents(refund.gross))<0.00001 && Math.abs(tax-cents(refund.tax))<0.00001,'Totale righe rimborso diverso dal totale finanziario Amazon.');
  const matrix=key=>prepared.map((row,index)=>[index+1,row[key]]);
  return {
    sigla:'CO',cod_modulo:'X',serie:1,numero:0,cod_conto:AMAZON_CUSTOMER_CODE,data_documento:amazonOrderDate(refund.posted_at),
    id_causale:[[1,2]],id_magazzino:4,id_magazzino_a:0,
    nota:[[1,`${refund.amazon_order_id} ${refundMarker(refund.event_id)}`]],
    id_pagamento:Number(customer.cod_pagamento)||4,codice_agente:text(customer.cod_agente),acconto_pagato:-total/100,
    tp_porto:[[1,'F']],tp_spese_sped:[[1,'V']],val_spese_sped:[[1,0]],
    id_riga:prepared.map((_,i)=>[i+1,0]),tp_riga:prepared.map((_,i)=>[i+1,'R']),
    codice_articolo:matrix('code'),quantita:matrix('quantity'),prezzo:matrix('price'),cod_iva:matrix('vat'),
    id_mag_da_riga:prepared.map((_,i)=>[i+1,4]),tp_um_articolo:prepared.map((_,i)=>[i+1,'1']),sconto:prepared.map((_,i)=>[i+1,'']),
    id_lotto:[],qta_lotto:[],
  };
}

export function verifyRefundTotals(refund,total,tax) {
  const expectedTotal=cents(refund.gross),expectedTax=cents(refund.tax);
  assert(total<0 && tax<=0 && sameFirstDecimal(-total,expectedTotal) && sameFirstDecimal(-tax,expectedTax),'Totale/IVA COX reso diverso dal rimborso Amazon alla prima cifra decimale.');
  return {policy:'first_decimal',sourceTotalCents:-expectedTotal,mexalTotalCents:total,sourceTaxCents:-expectedTax,mexalTaxCents:tax,totalDifferenceCents:total+expectedTotal,taxDifferenceCents:tax+expectedTax};
}

export function verifyRefundCox(actual,payload,refund) {
  assert(actual.sigla==='CO' && actual.cod_modulo==='X' && Number(actual.numero)>0,'Documento diverso dal COX reso.');
  for(const key of ['serie','cod_conto','data_documento','id_magazzino'])assert(text(actual[key])===text(payload[key]),'COX reso diverso: '+key);
  assert(text(scalar(actual.nota)).includes(refundMarker(refund.event_id)) && text(scalar(actual.nota)).includes(refund.amazon_order_id),'Identità reso diversa nelle note.');
  for(const key of ['codice_articolo','quantita','prezzo','id_mag_da_riga','cod_iva']) {
    assert(Array.isArray(actual[key]) && actual[key].length===payload[key].length,'Righe COX reso diverse: '+key);
    const values=new Map(actual[key]);
    for(const [index,value] of payload[key])assert(key==='prezzo'?Math.abs(Number(values.get(index))-value)<0.000001:
      key==='cod_iva'?text(values.get(index)).toUpperCase().replace(/[,.]0+$/,'')===text(value).toUpperCase().replace(/[,.]0+$/,''):
        text(values.get(index))===text(value),'Righe COX reso diverse: '+key);
  }
  if(payload.id_lotto?.length)for(const key of ['id_lotto','qta_lotto','pos_righe_lotto','nr_righe_lotto']){
    assert(Array.isArray(actual[key]) && actual[key].length===payload[key].length,'Lotti COX reso diversi: '+key);
    const values=new Map(actual[key]);
    for(const [index,value] of payload[key])assert(Number(values.get(index))===Number(value),'Lotti COX reso diversi: '+key);
  }
  const tax=refund.vat_code==='N41' && Array.isArray(actual.tot_iva) && !actual.tot_iva.length?0:cents(scalar(actual.tot_iva));
  const proof=verifyRefundTotals(refund,cents(scalar(actual.tot_documento)),tax);
  return {year:payload.data_documento.slice(0,4),series:Number(actual.serie),number:Number(actual.numero),date:payload.data_documento,
    ...(proof.totalDifferenceCents || proof.taxDifferenceCents?{moneyVerification:proof}:{})};
}

export function refundPlanFingerprint(payload){
  return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(['data_documento','cod_conto','id_magazzino','nota','codice_articolo','quantita','prezzo','cod_iva'].map(key=>[key,payload[key]])))).digest('hex');
}

export function refundUpdatePayload(actual,payload){
 const update={...payload,numero:Number(actual.numero),serie:Number(actual.serie)};
 for(const key of ['sigla_ordine','serie_ordine','numero_ordine','sigla_doc_orig','serie_doc_orig','numero_doc_orig']){
  assert(Array.isArray(actual[key]),'Riferimenti originali COX non verificabili: '+key);update[key]=actual[key];
 }
 const ids=new Map(actual.id_riga || []);
 update.id_riga=payload.id_riga.map(([index])=>[index,ids.get(index) || 0]);
 return update;
}
