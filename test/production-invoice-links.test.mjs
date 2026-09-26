import test from 'node:test';import assert from 'node:assert/strict';import {automaticInvoiceMatches as match} from '../server/production-invoice-links.js';
const e={id:1,customerCode:'C',articleCode:'A',date:'2026-01-01',links:[{oct:'OC/2/92',lineId:1}]};
const h={id:'H',sigla:'FT',codice_cliente:'C',dati_mexal:{sigla_ordine:[[1,'OC']],serie_ordine:[[1,2]],numero_ordine:[[1,92]],data_ordine:[[1,'20260101']]}};
const l={id:'L',fattura_id:'H',codice_articolo:'A',valore_netto:300};
test('unique explicit invoice order and article match',()=>assert.equal(match(e,[e],[h],[l],[])[0].amount,300));
test('no duplication of manually allocated invoice',()=>assert.equal(match(e,[e],[h],[l],[{invoice_line_id:'L'}]).length,0));
test('ambiguous productions, customers and years rejected',()=>{assert.equal(match(e,[e,{...e,id:2}],[h],[l],[]).length,0);assert.equal(match(e,[e],[{...h,codice_cliente:'OTHER'}],[l],[]).length,0);assert.equal(match({...e,date:'2025-01-01'},[{...e,date:'2025-01-01'}],[h],[l],[]).length,0);});
test('multi-order invoice uses explicit line header group and rejects missing group',()=>{const multi={...h,dati_mexal:{sigla_ordine:[[1,'OC'],[2,'OC']],serie_ordine:[[1,2],[2,2]],numero_ordine:[[1,92],[2,93]],data_ordine:[[1,'20260101'],[2,'20260101']],id_rif_testata:[[28,1],[29,2]]}};assert.equal(match(e,[e],[multi],[{...l,posizione:28}],[])[0].amount,300);assert.equal(match(e,[e],[multi],[{...l,posizione:29}],[]).length,0);assert.equal(match(e,[e],[multi],[l],[]).length,0);});
