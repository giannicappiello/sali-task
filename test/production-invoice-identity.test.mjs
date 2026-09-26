import test from 'node:test';import assert from 'node:assert/strict';import {recoverInvoiceIdentity as recover} from '../server/production-invoice-identity.js';
const e={id:1,orderNumber:'OC/2/159',articleCode:'A',date:'2026-08-01',customerCode:''};
const h={id:'H',sigla:'FT',codice_cliente:'C',dati_mexal:{id_rif_testata:[[2,1]],sigla_ordine:[[1,'OC']],serie_ordine:[[1,2]],numero_ordine:[[1,159]],data_ordine:[[1,'20260522']]}};
const l={id:'L',fattura_id:'H',codice_articolo:'A',posizione:2};
test('recovers only explicit unique order/article identity with provenance',()=>{const r=recover(e,[e],[h],[l]);assert.equal(r.customerCode,'C');assert.equal(r.commercialIdentity.date,'2026-05-22');assert.equal(r.commercialIdentity.invoiceLineId,'L');assert.equal(r.sourceOrder,undefined);});
test('rejects ambiguous customers productions years and missing line group',()=>{assert.equal(recover(e,[e,{...e,id:2}],[h],[l]),e);assert.equal(recover(e,[e],[h,{...h,id:'H2',codice_cliente:'D'}],[l,{...l,id:'L2',fattura_id:'H2'}]),e);assert.equal(recover({...e,date:'2024-01-01'},[{...e,date:'2024-01-01'}],[h],[l]).customerCode,'');assert.equal(recover(e,[e],[h],[{...l,posizione:3}]),e);});
test('does not overwrite preserved customer or order links',()=>{const existing={...e,customerCode:'X'};assert.equal(recover(existing,[existing],[h],[l]),existing);});
