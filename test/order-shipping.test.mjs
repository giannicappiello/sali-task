import test from "node:test";
import assert from "node:assert/strict";
import { applyOrderShipping, isShippingLine, normalizeShippingConfig } from "../src/modules/orders/services/orderShipping.js";
import { calculateOrderEconomics } from "../src/modules/orders/services/orderEconomics.js";
import { buildOrderPdfModel } from "../src/modules/orders/services/orderPdf.js";
import { classifyOrderLines, classifyPrivateOrderLines, buildMexalOrderDocument } from "../server/mexal/order-documents.js";
import { prepareOrderVat } from "../server/mexal/order-vat.js";
import { calculateCommissions } from "../server/mexal/commission-engine.js";
const config = { importo_minimo_porto_franco: 100, addebito_spedizione: 10 };
const product = (price=80, extra={}) => ({ codice_articolo:"IT1",quantita:1,prezzo_listino:price,aliquota_iva:22,codice_iva_mexal:"22,0",quantita_ocm:1,...extra });
const order = { id:"example",codice_cliente:"501.1",data_ordine:"2026-10-06",importo_minimo_porto_franco:100 };

test("addebita sotto soglia sul netto, anche se il totale IVA inclusa supera la soglia",()=>{
 const lines=applyOrderShipping([product(90)],config); const fee=lines.find(isShippingLine);
 assert.equal(fee.imponibile_riga,10); assert.equal(fee.iva_riga,2.2);
 assert.deepEqual([calculateOrderEconomics(lines).totale_imponibile,calculateOrderEconomics(lines).totale_documento],[100,122]);
});
test("porto franco alla soglia e sopra",()=>{for(const price of [100,100.01,200]) assert.equal(applyOrderShipping([product(price)],config).length,1);});
test("arrotonda il netto ai centesimi prima del confronto",()=>{assert.equal(applyOrderShipping([product(99.999)],config).length,1);});
test("include gli sconti commerciali e pagamento nel netto",()=>{
 const lines=applyOrderShipping([product(200,{sconto_commerciale:"50",sconto_pagamento:"10"})],config);
 assert.equal(lines.at(-1).dettaglio_calcolo.netto_merce,90); assert.equal(calculateOrderEconomics(lines).totale_imponibile,100);
});
test("ricalcolo idempotente elimina duplicati e rimuove la spedizione raggiunta la soglia",()=>{
 const once=applyOrderShipping([product()],config); const twice=applyOrderShipping(once,config);
 assert.equal(twice.filter(isShippingLine).length,1);
 assert.equal(applyOrderShipping([product(100),once.at(-1)],config).length,1);
 assert.equal(applyOrderShipping(twice,{...config,addebito_spedizione:15}).at(-1).imponibile_riga,15);
});
test("ordine vuoto, soglia zero o addebito zero non generano spedizione",()=>{
 assert.deepEqual(applyOrderShipping([],config),[]);
 assert.equal(applyOrderShipping([product()],{}).length,1);
 assert.equal(applyOrderShipping([product()],{...config,addebito_spedizione:0}).length,1);
});
test("valida importi negativi/non numerici e decimali italiani",()=>{
 assert.equal(normalizeShippingConfig({addebito_spedizione:"12,50"}).addebito_spedizione,12.5);
 for(const invalid of [-1,"NaN","abc",Infinity]) assert.throws(()=>normalizeShippingConfig({addebito_spedizione:invalid}));
});
test("spedizione non è un articolo e non impegna quantità",()=>{
 const fee=applyOrderShipping([product()],config).at(-1);
 assert.equal(fee.codice_articolo,null); assert.equal(fee.riga_descrittiva,true);
 assert.deepEqual([fee.quantita_ocm,fee.quantita_ocx,fee.quantita_oci],[0,0,0]);
});
test("IVA mista ripartita senza perdere centesimi e riportata nel PDF",()=>{
 const lines=applyOrderShipping([product(60),product(20,{codice_articolo:"IT2",aliquota_iva:10})],{...config,addebito_spedizione:9.99});
 const fee=lines.at(-1); assert.equal(fee.dettaglio_calcolo.ripartizione_iva.reduce((s,g)=>s+g.imponibile_riga,0),9.99);
 assert.equal(fee.iva_riga,1.9); const model=buildOrderPdfModel(order,lines);
 assert.equal(model.lines.at(-1).descrizione,"Spese di spedizione");
 assert.deepEqual(model.vat.map(([rate])=>rate).sort((a,b)=>a-b),[10,22]);
 assert.equal(model.totals.totale_imponibile,89.99);
});
test("addebito su un solo documento di un ordine suddiviso",()=>{
 const lines=applyOrderShipping([product(80,{quantita:2,prezzo_listino:40,quantita_ocm:1,quantita_ocx:1})],config);
 const documents=classifyOrderLines(lines);
 assert.equal(documents.OCM.filter(isShippingLine).length,1); assert.equal(documents.OCX.filter(isShippingLine).length,0);
 const payload=buildMexalOrderDocument(order,"OCM",documents.OCM);
 assert.deepEqual(payload.val_spese_sped,[[1,10]]); assert.deepEqual(payload.tp_spese_sped,[[1,"V"]]); assert.deepEqual(payload.tp_porto,[[1,"D"]]);
 assert.deepEqual(payload.codice_articolo,[[1,"IT1"]]);
 assert.deepEqual(buildMexalOrderDocument(order,"OCX",documents.OCX).val_spese_sped,[[1,0]]);
});
test("tutto backorder usa OCX, prenotazione usa OCI, importazioni IMP usano OCM",()=>{
 const lines=applyOrderShipping([product(80,{quantita_ocm:0,quantita_ocx:1})],config);
 assert.equal(classifyOrderLines(lines).OCX.at(-1).riga_spedizione,true);
 assert.equal(classifyOrderLines(lines,{reservation:true}).OCI.at(-1).riga_spedizione,true);
 const imported=applyOrderShipping([product(80,{codice_articolo:"IMP1",quantita_ocm:0})],config);
 assert.equal(classifyOrderLines(imported,{reservation:true}).OCM.at(-1).riga_spedizione,true);
});
test("Private resta un OCT con spesa fissa e nessun codice articolo fittizio",()=>{
 const lines=applyOrderShipping([product()],config); const documents=classifyPrivateOrderLines(lines);
 const payload=buildMexalOrderDocument(order,"OCT",documents.OCT,{moduleCode:"T"});
 assert.deepEqual(payload.codice_articolo,[[1,"IT1"]]); assert.deepEqual(payload.val_spese_sped,[[1,10]]);
});
test("zero addebito automatico neutralizza le spese di anagrafica solo nei nuovi ordini",()=>{
 const legacy={...order,importo_minimo_porto_franco:null,trasporto_mexal:{tp_porto:"D",tp_spese_sped:"M",val_spese_sped:5}};
 assert.deepEqual(buildMexalOrderDocument(legacy,"OCM",[{...product(),quantita_documento:1}]).val_spese_sped,[[1,5]]);
 assert.deepEqual(buildMexalOrderDocument({...legacy,importo_minimo_porto_franco:0},"OCM",[{...product(),quantita_documento:1}]).val_spese_sped,[[1,0]]);
});
test("IVA Mexal non cerca un articolo per le spese",async()=>{
 const documents=classifyPrivateOrderLines(applyOrderShipping([product()],config));
 const prepared=await prepareOrderVat(documents,{}, {loadArticle:()=>{throw new Error("Spedizione non deve consultare il catalogo");}});
 assert.equal(prepared.documents.OCT.at(-1).riga_spedizione,true);
});
test("spedizione esclusa dalle provvigioni",()=>{
 const fee=applyOrderShipping([product()],config).at(-1);
 const [result]=calculateCommissions({customer:{categoria_provvigionale_mexal:1},lines:[fee]});
 assert.equal(result.provvigione_percentuale,null); assert.match(result.provvigione_dettaglio_calcolo.motivo,/spedizione/);
});

test("IVA della spedizione segue il documento che riceve l’addebito, mentre la soglia usa tutto l’ordine",()=>{
 const lines=applyOrderShipping([product(40),product(40,{codice_articolo:"IT2",aliquota_iva:10,quantita_ocm:0,quantita_ocx:1})],config);
 assert.equal(lines.at(-1).dettaglio_calcolo.netto_merce,80);
 assert.equal(lines.at(-1).iva_riga,2.2);
 assert.equal(lines.at(-1).dettaglio_calcolo.documento_spedizione,"OCM");
});

test("PDF suddivisi includono la riga spedizione e il suo totale una sola volta",async()=>{
 const { createMexalDocumentPdfFiles }=await import("../src/modules/orders/services/orderPdf.js");
 const lines=applyOrderShipping([product(80,{quantita:2,prezzo_listino:40,quantita_ocm:1,quantita_ocx:1})],config);
 const files=await createMexalDocumentPdfFiles({...order,mexal_documents:[{tipo_documento:"OCM",serie:1,numero:101},{tipo_documento:"OCX",serie:1,numero:102}]},lines);
 const ocm=new TextDecoder().decode(files[0].data),ocx=new TextDecoder().decode(files[1].data);
 assert.match(ocm,/Spese di spedizione/); assert.doesNotMatch(ocx,/Spese di spedizione/);
 assert.match(ocm,/61,00/); assert.match(ocx,/48,80/);
});
