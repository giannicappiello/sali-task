import test from 'node:test';import assert from 'node:assert/strict';import {automaticInvoiceMatches as match} from '../server/production-invoice-links.js';
const e={id:1,customerCode:'C',articleCode:'A',date:'2026-01-01',links:[{oct:'OC/2/92',lineId:1}]};
const h={id:'H',sigla:'FT',codice_cliente:'C',dati_mexal:{sigla_ordine:[[1,'OC']],serie_ordine:[[1,2]],numero_ordine:[[1,92]],data_ordine:[[1,'20260101']]}};
const l={id:'L',fattura_id:'H',codice_articolo:'A',valore_netto:300};
test('unique explicit invoice order and article match',()=>assert.equal(match(e,[e],[h],[l],[])[0].amount,300));
test('no duplication of manually allocated invoice',()=>assert.equal(match(e,[e],[h],[l],[{invoice_line_id:'L'}]).length,0));
test('ambiguous productions, customers and years rejected',()=>{assert.equal(match(e,[e,{...e,id:2}],[h],[l],[]).length,0);assert.equal(match(e,[e],[{...h,codice_cliente:'OTHER'}],[l],[]).length,0);assert.equal(match({...e,date:'2025-01-01'},[{...e,date:'2025-01-01'}],[h],[l],[]).length,0);});
test('multi-order invoice uses explicit line header group and rejects missing group',()=>{const multi={...h,dati_mexal:{sigla_ordine:[[1,'OC'],[2,'OC']],serie_ordine:[[1,2],[2,2]],numero_ordine:[[1,92],[2,93]],data_ordine:[[1,'20260101'],[2,'20260101']],id_rif_testata:[[28,1],[29,2]]}};assert.equal(match(e,[e],[multi],[{...l,posizione:28}],[])[0].amount,300);assert.equal(match(e,[e],[multi],[{...l,posizione:29}],[]).length,0);assert.equal(match(e,[e],[multi],[l],[]).length,0);});

test('normalizes imported codes and numeric header group identifiers',()=>{
 const header={...h,codice_cliente:' C ',sigla:'ft',dati_mexal:{...h.dati_mexal,id_rif_testata:[['28','1']]}};
 const line={...l,codice_articolo:' a ',posizione:28};
 assert.equal(match(e,[{...e,id:'1'}],[header],[line],[])[0].amount,300);
});
test('an invoice imported later is picked up on the next report read',()=>{
 assert.deepEqual(match(e,[e],[],[],[]),[]);
 assert.equal(match(e,[e],[h],[l],[])[0].document.id,'H');
});
test('sums separate invoice lines without reusing manual allocations',()=>{
 const lines=[l,{...l,id:'L2',valore_netto:25}];
 assert.equal(match(e,[e],[h],lines,[]).reduce((s,x)=>s+x.amount,0),325);
 assert.equal(match(e,[e],[h],lines,[{invoice_line_id:'L'}])[0].amount,25);
});
import {invoiceReferences,groupedInvoices} from '../src/features/production-costs/invoice-summary.js';
const splitHeader={...h,dati_mexal:{...h.dati_mexal,id_rif_testata:[[11,1],[15,2]],pos_righe_lotto:[[11,1],[15,2]],nr_righe_lotto:[[11,1],[15,1]],id_lotto:[[1,9805],[2,9805]]}};
const splitLines=[{...l,id:'A',posizione:11,quantita:10000,valore_netto:2700},{...l,id:'B',posizione:15,quantita:5000,valore_netto:1350}];
test('split delivery same article and lot recovers missing order and totals all invoice lines',()=>{
 const r=match(e,[e],[splitHeader],splitLines,[]);assert.equal(r.length,2);assert.equal(r.reduce((s,x)=>s+x.invoiceQuantity,0),15000);assert.equal(r.reduce((s,x)=>s+x.amount,0),4050);assert.equal(invoiceReferences(r).length,1);assert.equal(groupedInvoices(r)[0].amount,4050);
});
test('different prices sum actual net amounts rather than extrapolating the first price',()=>{
 assert.equal(match(e,[e],[splitHeader],[splitLines[0],{...splitLines[1],valore_netto:1500}],[]).reduce((s,x)=>s+x.amount,0),4200);
});
test('valued same article rows share the unique OC even without a matching lot',()=>{
 for(const d of [{...splitHeader.dati_mexal,id_lotto:[[1,9805],[2,9999]]},{...splitHeader.dati_mexal,id_lotto:[]}])assert.equal(match(e,[e],[{...h,dati_mexal:d}],splitLines,[]).reduce((s,x)=>s+x.amount,0),4050);
});
test('explicit different OC stays separate despite matching article',()=>{
 const d={...splitHeader.dati_mexal,sigla_ordine:[[1,'OC'],[2,'OC']],serie_ordine:[[1,2],[2,2]],numero_ordine:[[1,92],[2,93]],data_ordine:[[1,'20260101'],[2,'20260101']]};
 assert.equal(match(e,[e],[{...h,dati_mexal:d}],splitLines,[]).length,1);
});
test('repeated input rows and manual allocations never double invoice amounts',()=>{
 assert.equal(match(e,[e],[splitHeader,splitHeader],[...splitLines,...splitLines],[]).reduce((s,x)=>s+x.amount,0),4050);
 assert.equal(match(e,[e],[splitHeader],splitLines,[{invoice_line_id:'A'}]).reduce((s,x)=>s+x.amount,0),1350);
});
test('same lot linked explicitly to different orders leaves continuation unresolved',()=>{
 const header={...splitHeader,dati_mexal:{...splitHeader.dati_mexal,sigla_ordine:[[1,'OC'],[3,'OC']],serie_ordine:[[1,2],[3,2]],numero_ordine:[[1,92],[3,93]],data_ordine:[[1,'20260101'],[3,'20260101']],id_rif_testata:[[11,1],[15,2],[20,3]],pos_righe_lotto:[[11,1],[15,2],[20,3]],nr_righe_lotto:[[11,1],[15,1],[20,1]],id_lotto:[[1,9805],[2,9805],[3,9805]]}};
 assert.equal(match(e,[e],[header],[...splitLines,{...l,id:'C',posizione:20}],[]).length,1);
});
