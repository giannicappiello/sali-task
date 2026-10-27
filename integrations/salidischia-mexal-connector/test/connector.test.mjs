import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareOrder, documentPayload, decimal } from '../src/order.mjs';
import { Journal } from '../src/journal.mjs';
import { syncOrder,resumeOrder } from '../src/sync.mjs';
import { exampleOrder, options, config } from './fixtures.mjs';

test('preserva dati fiscali, PEC/SDI e indirizzi distinti', () => {
  const p = prepareOrder(exampleOrder(), options);
  assert.equal(p.customer.pec, 'pec@example.invalid');
  assert.equal(p.customer.sdi, 'ABC1234');
  assert.equal(p.customer.vat, '00000000000');
  assert.equal(p.customer.billing.address_2, 'Scala B');
  assert.equal(p.customer.shipping.city, 'Roma');
});
test('OC standard senza X e alias esplicito mantengono prezzi ordine e SKU originale tracciabile',()=>{
 const order=exampleOrder();order.line_items[0].sku='IT0017-1';
 const p=prepareOrder(order,{...options,catalogSkuAliases:{'IT0017-1':'IT0017'}}),d=documentPayload(p,'501.1',{...config,module:''});
 assert.equal(d.sigla,'OC');assert.equal(d.cod_modulo,'');assert.equal(p.lines[0].sku,'IT0017');assert.equal(p.lines[0].sourceSku,'IT0017-1');assert.equal(p.lines[0].netCents,7711);
 assert.equal(d.codice_articolo[0][1],'IT0017');
 const original=exampleOrder();assert.equal(prepareOrder(original,options).hash,prepareOrder(original,{...options,catalogSkuAliases:{'IT0017-1':'IT0017'}}).hash);
});
test('OC: E, causale 2, spedizione netta e prezzi precisi dopo sconto', () => {
  const source = exampleOrder(); source.line_items[0].subtotal = '100.00';
  const p = prepareOrder(source, options), d = documentPayload(p, '501.00001', config);
  assert.equal(p.totalCents, 16010);
  assert.deepEqual(d.id_causale, [[1, 2]]);
  assert.deepEqual(d.tipo_stato_riga, [[1, 'E'], [2, 'E'], [3, 'E']]);
  assert.equal(d.prezzo[0][1], 6.425833);
  assert.equal(Math.round(d.prezzo[0][1] * 12 * 100), 7711);
  assert.deepEqual(d.val_spese_sped, [[1, 15]]);
  assert.deepEqual(d.sconto, [[1, ''], [2, ''], [3, '']]);
});
test('spedizione gratuita impostata a zero, nessun listino sostitutivo', () => {
  const o = exampleOrder(); o.shipping_lines=[];o.shipping_total='0';o.shipping_tax='0';o.total_tax='25.57';o.total='141.80';
  const d = documentPayload(prepareOrder(o, options), '501.00001', config);
  assert.deepEqual(d.val_spese_sped, [[1, 0]]);
  assert.deepEqual(d.tp_porto, [[1, 'F']]);
});

test('IVA vuota ammessa solo su riga a zero e hash identico allo zero esplicito',()=>{
 const o=exampleOrder();o.shipping_lines[0].total='0';o.shipping_lines[0].total_tax='0';o.shipping_lines[0].taxes[0].total='0';
 o.shipping_total='0';o.shipping_tax='0';o.total_tax='25.57';o.total='141.80';
 const hash=prepareOrder(o,options).hash;o.shipping_lines[0].taxes[0].total='';
 assert.equal(prepareOrder(o,options).hash,hash);
 const invalid=exampleOrder();invalid.shipping_lines[0].taxes[0].total='';assert.throws(()=>prepareOrder(invalid,options),/Importo non valido/);
});
test('riga omaggio mantiene il codice IVA anche quando imponibile e imposta sono zero',()=>{
 const o=exampleOrder();o.line_items.push({id:5,sku:'OMAGGIO',name:'Campione',quantity:1,subtotal:'0.00',total:'0.00',total_tax:'0.00',taxes:[{id:1,total:'0.00'}]});
 const p=prepareOrder(o,options);const d=documentPayload(p,'501.1',config);assert.equal(p.totalCents,16010);assert.deepEqual(d.cod_iva.at(-1),[4,'22']);assert.deepEqual(d.prezzo.at(-1),[4,0]);
});
test('carte e portafogli digitali conservano il pagamento configurato e i totali del sito',()=>{
 for(const method of['ppcp_card','ppcp_googlepay','ppcp_applepay']){
  const o=exampleOrder();o.payment_method=method;const p=prepareOrder(o,options);const d=documentPayload(p,'501.1',{...config,paymentCodes:{[method]:20}});
  assert.equal(d.id_pagamento,20);assert.equal(p.totalCents,16010);
 }
});
test('rifiuta ordini non pagati, rimborsi, dati incompleti e totali errati', () => {
  for (const mutate of [o=>o.date_paid=null,o=>o.status='pending',o=>o.refunds=[{id:1}],o=>o.total='160.20',o=>o.currency='USD',o=>o.billing.address_1='',o=>o.line_items[0].sku='',o=>o.fee_lines=[{total:'1'}],o=>o.line_items[0].total_tax='17.00']) {
    const o=exampleOrder();mutate(o);assert.throws(()=>prepareOrder(o,options));
  }
  assert.throws(()=>decimal('-1'));assert.throws(()=>decimal('1.001'));
});
test('blocca mappature IVA e spedizione non verificate', () => {
  const p=prepareOrder(exampleOrder(),options);
  assert.throws(()=>documentPayload(p,'501.1',{...config,taxCodes:{}}));
  assert.throws(()=>documentPayload(p,'501.1',{...config,shippingTaxVerified:false}));
});
function setup() {
  const journal=new Journal(':memory:');const calls=[];
  const mexal={
    async findExistingOrder(){calls.push('find');return null;},
    async preflight(){calls.push('preflight');},
    async ensureCustomer(customer){calls.push('customer');assert.equal(customer.sdi,'ABC1234');return '501.1';},
    async verifyCustomer(){calls.push('verifyCustomer');},
    async prepareDestination(){calls.push('destination');return '754';},
    async createOrder(){calls.push('create');return 'OC+1+999';},
    async verifyOrder(){calls.push('verifyOrder');},
  };
  return {journal,mexal,calls,config};
}
test('anteprima: nessuna scrittura o chiamata esterna',async()=>{
  const s=setup(),p=prepareOrder(exampleOrder(),options);
  assert.equal((await syncOrder(p,s)).mode,'preview');assert.deepEqual(s.calls,[]);assert.equal(s.journal.get(p.key),undefined);s.journal.close();
});
test('verifica anagrafica prima di OC; secondo invio idempotente',async()=>{
  const s=setup(),p=prepareOrder(exampleOrder(),options);
  assert.equal((await syncOrder(p,{...s,dryRun:false})).mode,'imported');
  assert.deepEqual(s.calls,['find','preflight','customer','verifyCustomer','destination','create','verifyOrder']);
  assert.equal((await syncOrder(p,{...s,dryRun:false})).mode,'already-imported');
  assert.equal(s.calls.filter(x=>x==='create').length,1);s.journal.close();
});
test('timeout dopo POST: blocca ogni reinvio automatico',async()=>{
  const s=setup(),p=prepareOrder(exampleOrder(),options);
  s.mexal.createOrder=async()=>{s.calls.push('create');throw new Error('timeout');};
  await assert.rejects(syncOrder(p,{...s,dryRun:false}),/timeout/);
  await assert.rejects(syncOrder(p,{...s,dryRun:false}),/incerto/);
  assert.equal(s.calls.filter(x=>x==='create').length,1);s.journal.close();
});

test('recupero esplicito conserva journal e richiede cliente noto e assenza OC',async()=>{
 const s=setup(),p=prepareOrder(exampleOrder(),options);s.journal.reserve(p);s.journal.set(p.key,'customer_pending','501.1');s.journal.fail(p.key,new Error('errore precedente'));
 assert.equal(s.journal.get(p.key).last_phase,'customer_pending');
 s.mexal.ensureCustomer=async(customer,{expectedCode})=>{assert.equal(expectedCode,'501.1');return expectedCode;};
 assert.equal((await resumeOrder(p,s)).documentRef,'OC+1+999');
 await assert.rejects(resumeOrder(p,s),/stato corrente/);assert.equal(s.calls.filter(x=>x==='create').length,1);s.journal.close();
});
test('OC preesistente nel vecchio connettore: nessuna scrittura',async()=>{
  const s=setup(),p=prepareOrder(exampleOrder(),options);s.mexal.findExistingOrder=async()=>true;
  await assert.rejects(syncOrder(p,{...s,dryRun:false}),/già presente/);assert.deepEqual(s.calls,[]);s.journal.close();
});
test('anagrafica riletta incompleta: impedisce la creazione OC',async()=>{
  const s=setup(),p=prepareOrder(exampleOrder(),options);s.mexal.verifyCustomer=async()=>{throw new Error('PEC assente');};
  await assert.rejects(syncOrder(p,{...s,dryRun:false}),/PEC/);assert.ok(!s.calls.includes('create'));s.journal.close();
});
test('totali riletti diversi: non marca verificato e non reinvia',async()=>{
  const s=setup(),p=prepareOrder(exampleOrder(),options);s.mexal.verifyOrder=async()=>{throw new Error('Totale diverso');};
  await assert.rejects(syncOrder(p,{...s,dryRun:false}),/Totale/);assert.equal(s.journal.get(p.key).status,'reconciliation_required');
  await assert.rejects(syncOrder(p,{...s,dryRun:false}),/incerto/);s.journal.close();
});
test('journal persiste dopo riavvio e impedisce importazione modificata',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sali-connector-'));const file=join(dir,'journal.sqlite');
  let j=new Journal(file);const p=prepareOrder(exampleOrder(),options);j.reserve(p);j.set(p.key,'verified','501.1','OC+1+999');j.close();
  j=new Journal(file);assert.equal(j.reserve(p).document_ref,'OC+1+999');assert.throws(()=>j.reserve({...p,hash:'changed'}),/modificato/);j.close();rmSync(dir,{recursive:true,force:true});
});
test('due processi sullo stesso journal non possono prenotare lo stesso ordine',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sali-connector-'));const file=join(dir,'journal.sqlite');const a=new Journal(file),b=new Journal(file),p=prepareOrder(exampleOrder(),options);
  a.reserve(p);assert.throws(()=>b.reserve(p),/incerto/);a.close();b.close();rmSync(dir,{recursive:true,force:true});
});
test('attivazione impedita senza verifica contratto e fermo precedente connettore',async()=>{
  const s=setup(),p=prepareOrder(exampleOrder(),options);
  await assert.rejects(syncOrder(p,{...s,config:{...config,cutoverVerified:false},dryRun:false}),/Attivazione bloccata/);assert.deepEqual(s.calls,[]);s.journal.close();
});
