import test from 'node:test';
import assert from 'node:assert/strict';
import { isForeignOrderCustomer, applyOrderVatPolicy } from '../src/modules/orders/services/orderVatPolicy.js';
import { calculateOrderEconomics } from '../src/modules/orders/services/orderEconomics.js';
import { applyOrderShipping } from '../src/modules/orders/services/orderShipping.js';
import { buildOrderPdfModel } from '../src/modules/orders/services/orderPdf.js';
import { prepareOrderVat } from '../server/mexal/order-vat.js';
import { buildRootMatrixRows } from '../server/mexal/order-documents.js';
import { buildOrderEmailQueueRows } from '../server/orders/order-email-queue.js';
const product={codice_articolo:'IT1',quantita:2,prezzo_listino:50,aliquota_iva:22,codice_iva_mexal:'22,0',sconto_commerciale:'10',sconto_pagamento:'5',iva:22};
test('foreign policy requires a known country and recognizes Italian aliases',()=>{
 for(const paese of [null,'',' ','IT','ita',' Italia ','ITALY','380']) assert.equal(isForeignOrderCustomer({paese}),false);
 for(const paese of ['FR','DE','ES','US','CH']) assert.equal(isForeignOrderCustomer({paese}),true);
});
test('foreign VAT stays null with discounts, totals, shipping and PDF in all modules',()=>{
 for(const moduleCode of ['prof','ph','private']) {
  const lines=applyOrderShipping([applyOrderVatPolicy(product,{paese:'FR'})],{importo_minimo_porto_franco:100,addebito_spedizione:10},{moduleCode});
  const result=calculateOrderEconomics(lines);
  assert.equal(result.totale_imponibile,95.5); assert.equal(result.totale_iva,0); assert.equal(result.totale_documento,95.5);
  for(const line of result.righe) {assert.equal(line.aliquota_iva,null);assert.equal(line.codice_iva_mexal,null);}
  const pdf=buildOrderPdfModel({},lines); assert.deepEqual(pdf.vat,[]); assert.equal(pdf.totals.totale_documento,95.5);
 }
});
test('switching back to an Italian customer restores product VAT',()=>{
 const foreign=applyOrderVatPolicy(product,{paese:'DE'});
 const domestic=applyOrderVatPolicy({...foreign,aliquota_iva:product.aliquota_iva,codice_iva_mexal:product.codice_iva_mexal},{paese:'IT'});
 const result=calculateOrderEconomics([domestic]); assert.equal(result.totale_iva,18.81);assert.equal(result.righe[0].aliquota_iva,22);
});
test('Mexal foreign preflight clears stale tax codes in every document without article lookup',async()=>{
 const documents=Object.fromEntries(['OCM','OCX','OCI','OCT'].map(kind=>[kind,[{...product,cod_iva:'22,0',quantita_documento:2}]]));
 const result=await prepareOrderVat(documents,{}, {customer:{paese:'US'},loadArticle:async()=>assert.fail('foreign IVA must not be refilled')});
 for(const [kind,lines] of Object.entries(result.documents)) assert.deepEqual(buildRootMatrixRows(lines,5,null,kind).cod_iva,[[1,'']]);
 assert.equal(documents.OCM[0].cod_iva,'22,0'); assert.deepEqual(result.updates,[]);
});
test('unknown country still blocks missing article VAT',async()=>{
 await assert.rejects(prepareOrderVat({OCM:[{codice_articolo:'IT1'}]}, {}, {customer:{paese:null},loadArticle:async()=>({codice:'IT1'})}),/Codice IVA/);
});
test('new confirmation uses a new email key while retries share the same key',()=>{
 const args={order:{id:'order',versione_conferma:1},recipients:[{email:'client@example.com',type:'cliente'}]};
 const first=buildOrderEmailQueueRows(args)[0];const retry=buildOrderEmailQueueRows(args)[0];const second=buildOrderEmailQueueRows({...args,order:{...args.order,versione_conferma:2}})[0];
 assert.equal(first.versione_conferma,retry.versione_conferma); assert.notEqual(first.versione_conferma,second.versione_conferma);assert.equal(first.destinatario,second.destinatario);
});
