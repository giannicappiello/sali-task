import test from 'node:test';
import assert from 'node:assert/strict';
import { amazonOrderDate, buildAmazonCox, verifyAmazonCox, emitAmazonCox, synchronizeAmazonCox, AMAZON_CUSTOMER_CODE, createdCoxReference, reconcileAmazonCox } from './amazon-cox.js';

const order = { id:'order1', external_id:'123-1234567-1234567', marketplace:'IT', stato:'SHIPPED', currency:'EUR', ordered_at:'2026-10-19T08:00:00Z', fulfilled_at:'2026-10-21T22:30:00Z', gross_revenue:29.8, net_revenue:24.43 };
const customer = { codice:AMAZON_CUSTOMER_CODE, ragione_sociale:'Cliente AMAZON', cod_pagamento:4 };
const lines = [{ external_sku:'AMZ1', quantity:2, line_revenue:29.8 }];
const mappings = [{ external_sku:'AMZ1', marketplace:'IT', status:'matched', codice_mexal:'IT0060' }];
const articles = new Map([['IT0060',{ codice:'IT0060', alq_iva:'22,0' }]]);
const payload = () => buildAmazonCox(order,lines,mappings,articles,customer);
const actual = () => ({ ...payload(), numero:123, tot_documento:[[1,29.8]], tot_iva:[[1,5.37]] });

test('COX has Amazon customer, warehouse 4 and actual shipment date in Italian calendar', () => {
  const p=payload();
  assert.equal(p.sigla,'CO');assert.equal(p.cod_modulo,'X');assert.equal(p.cod_conto,AMAZON_CUSTOMER_CODE);
  assert.equal(p.id_magazzino,4);assert.deepEqual(p.id_mag_da_riga,[[1,4]]);
  assert.equal(p.data_documento,'20261022');assert.equal(p.nota[0][1],order.external_id);
  assert.deepEqual(p.prezzo,[[1,14.9]]);assert.deepEqual(p.quantita,[[1,2]]);
  assert.equal(amazonOrderDate('2026-01-01T23:30:00Z'),'20260102');
  assert.equal(amazonOrderDate('2026-06-30T22:30:00Z'),'20260701');
});
test('unshipped and partly shipped orders, unknown mappings and provisional totals cannot be exported', () => {
  for(const stato of ['UNSHIPPED','PARTIALLY_SHIPPED','CANCELED','pending','UNKNOWN']) assert.throws(()=>buildAmazonCox({...order,stato},lines,mappings,articles,customer),/spediti/);
  assert.throws(()=>buildAmazonCox({...order,fulfilled_at:null},lines,mappings,articles,customer),/Data effettiva/);
  assert.throws(()=>buildAmazonCox(order,lines,[],articles,customer),/associazione/);
  assert.throws(()=>buildAmazonCox(order,[{...lines[0],line_revenue:null}],mappings,articles,customer),/definitivo/);
  assert.throws(()=>buildAmazonCox({...order,gross_revenue:35},lines,mappings,articles,customer),/Totale righe/);
  assert.throws(()=>buildAmazonCox({...order,currency:'USD'},lines,mappings,articles,customer),/Valuta/);
  assert.throws(()=>buildAmazonCox({...order,net_revenue:null},lines,mappings,articles,customer),/IVA definitivo/);
  assert.throws(()=>buildAmazonCox(order,lines,mappings,articles,{...customer,ragione_sociale:'Altro'}),/anagrafica/i);
});
test('readback checks customer, original date, warehouse, lines, reference, gross total and VAT', () => {
  assert.deepEqual(verifyAmazonCox(actual(),payload(),order),{year:'2026',series:1,number:123,date:'20261022'});
  for(const mutation of [{id_magazzino:5},{cod_modulo:'M'},{data_documento:'20261023'},{tot_documento:[[1,30]]},{tot_iva:[[1,5.38]]},{nota:[[1,'Altro ordine']]},{id_mag_da_riga:[[1,5]]},{quantita:[[1,1]]}]) assert.throws(()=>verifyAmazonCox({...actual(),...mutation},payload(),order));
});
test('lot-managed articles defer allocation to explicit FIFO preflight',()=>{
  const p=buildAmazonCox(order,lines,mappings,new Map([['IT0060',{...articles.get('IT0060'),cod_tp_lotto:'aj',gest_rich_lotto:'S'}]]),customer);
  assert.deepEqual(p.id_lotto,[]);assert.deepEqual(p.qta_lotto,[]);assert.deepEqual(p.id_mag_da_riga,[[1,4]]);
});

function fixture({timeout=false,existing=false,claimed=true,failPreflight=false,wrongTotals=false,deliveryStatus="reconciliation_required"}={}) {
  const calls=[];let created=0;
  const db={
    async rpc(name,args){calls.push({name,args});return {data:name==='crm_claim_amazon_cox_service'?(claimed?'token':null):null};},
    from(name){return {async single(){return {data:{token:'token',status:deliveryStatus}};},select(){return this;},eq(){return this;},order(){return this;},in(){return this;},limit(){return Promise.resolve({data:name==='crm_external_order_lines'?lines:failPreflight?[]:mappings});}};},
  };
  const mexal={
    async getJson(path){if(path.startsWith('/clienti'))return customer;if(path.startsWith('/articoli'))return articles.get('IT0060');return actual();},
    async calculateDocument(){return {tot_imponibile:wrongTotals?1:24.43,tot_imposta:5.37};},
    async postJson(path,p){if(path.includes('/ricerca'))return {dati:existing||created?[{...actual(),nota:p.filtri.find(f=>f.campo==='nota').valore}]:[]};created++;if(timeout)throw new Error('Timeout');return {numero:123,serie:1};},
  };
  return {db,calls,mexal,get created(){return created;}};
}
test('new COX saves its verified reference; existing COX is linked without POST',async()=>{
  for(const existing of [false,true]){
    const f=fixture({existing});const r=await emitAmazonCox({db:f.db,connection:{id:'conn'},order,clientForYear:y=>{assert.equal(y,'2026');return f.mexal;}});
    assert.equal(r.status,'emitted');assert.equal(f.created,existing?0:1);
    assert.equal(f.calls.at(-1).args.p_reference.number,123);
  }
});
test('timeout is persisted as reconciliation required, and an existing claim is never retried',async()=>{
  const f=fixture({timeout:true});const r=await emitAmazonCox({db:f.db,connection:{id:'conn'},order,clientForYear:()=>f.mexal});
  assert.equal(r.status,'reconciliation_required');assert.equal(f.created,1);assert.equal(f.calls.at(-1).args.p_status,'reconciliation_required');
  const locked=fixture({claimed:false});assert.equal((await emitAmazonCox({db:locked.db,connection:{id:'conn'},order,clientForYear:()=>{throw new Error('Must not connect');}})).status,'skipped');
});
test('missing mappings and wrong preventive totals block all document writes',async()=>{
  for(const opts of [{failPreflight:true},{wrongTotals:true}]){
    const f=fixture(opts);const r=await emitAmazonCox({db:f.db,connection:{id:'conn'},order,clientForYear:()=>f.mexal});
    assert.equal(r.status,'blocked');assert.equal(f.created,0);
  }
});
test('cutoff is mandatory and old orders are skipped while scan advances',async()=>{
  await assert.rejects(synchronizeAmazonCox({db:{},connection:{}}),/data iniziale/);
  let updated;
  const db={from(){return {select(){return this;},eq(){return this;},ilike(){return this;},in(){return this;},order(){return this;},gt(){return this;},gte(){return this;},not(){return this;},limit(){return Promise.resolve({data:[{...order,id:'1',fulfilled_at:'2026-10-20T10:00:00Z'},{...order,id:'2',fulfilled_at:'2026-10-19T10:00:00Z'},{...order,id:'3'}]});},update(v){updated=v;return this;},then(resolve){return Promise.resolve({data:null}).then(resolve);}};}};
  const result=await synchronizeAmazonCox({db,connection:{id:'conn',amazon_cox_from:'2026-10-21',amazon_cox_state:{phase:'emit'}}});
  assert.equal(result.hasMore,true);assert.deepEqual(updated.amazon_cox_state,{active:true,phase:'emit',after:'2'});assert.equal(result.results.length,0);
});

test('COX reference supports body arrays and HTTP Location, rejects unrelated document keys',()=>{
 assert.deepEqual(createdCoxReference({dati:[{numero:2719,serie:1}]}),{number:2719,series:1});
 assert.deepEqual(createdCoxReference({mexalHttpResponse:{headers:{location:'/webapi/risorse/documenti/movimenti-magazzino/CO%2B1%2B2719%2B501.02156'}}}),{number:2719,series:1});
 assert.equal(createdCoxReference({mexalHttpResponse:{headers:{location:'/documenti/movimenti-magazzino/OC+1+2719+501.02156'}}}),null);
});
test('uncertain COX is recovered by verified readback without any document creation',async()=>{
 const f=fixture({existing:true});
 const result=await reconcileAmazonCox({db:f.db,connection:{id:'conn'},order,clientForYear:()=>f.mexal});
 assert.equal(result.status,'emitted');assert.equal(result.reference.number,123);assert.equal(f.created,0);
 assert.equal(f.calls.at(-1).args.p_status,'emitted');
});
test('missing or different uncertain documents stay unresolved and cannot be re-emitted',async()=>{
 for(const existing of [false,true]) {
  const f=fixture({existing});
  if(existing){const get=f.mexal.getJson;f.mexal.getJson=async path=>path.includes('/CO+')?{...actual(),tot_documento:[[1,999]]}:get(path);}
  const result=await reconcileAmazonCox({db:f.db,connection:{id:'conn'},order,clientForYear:()=>f.mexal});
  assert.equal(result.status,'reconciliation_required');assert.equal(f.created,0);assert.equal(f.calls.length,0);
 }
 const f=fixture({deliveryStatus:'processing'});
 assert.equal((await reconcileAmazonCox({db:f.db,connection:{id:'conn'},order,clientForYear:()=>{throw new Error('Do not read active document');}})).status,'skipped');
});

test('recovery phase advances its own cursor then emission starts separately',async()=>{
 let saved,queried;
 const db={from(table){ const q={select(){return q;},eq(field,value){if(field==='cox_status') queried=value;return q;},order(){return q;},gt(){return q;},ilike(){return q;},in(){return q;},gte(){return q;},not(){return q;},limit(){return Promise.resolve({data:[]});},update(value){saved=value;return q;},then(resolve){return Promise.resolve({data:null}).then(resolve);}};return q;}};
 const result=await synchronizeAmazonCox({db,connection:{id:'conn',amazon_cox_from:'2026-10-21'}});
 assert.equal(queried,'reconciliation_required');assert.equal(result.hasMore,true);
 assert.deepEqual(saved.amazon_cox_state,{active:true,phase:'emit'});
 const emitted=await synchronizeAmazonCox({db,connection:{id:'conn',amazon_cox_from:'2026-10-21',amazon_cox_state:{phase:'emit'}}});
 assert.equal(emitted.hasMore,false);assert.deepEqual(saved.amazon_cox_state,{});
});
test('legacy COX notes remain verifiable after the new number-first format',()=>{
 assert.equal(verifyAmazonCox({...actual(),nota:[[1,'Ordine Amazon '+order.external_id]]},payload(),order).number,123);
});
