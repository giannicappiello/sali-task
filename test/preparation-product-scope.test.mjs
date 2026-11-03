/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {initialPacking, comparePacking, allocateFifo, distributeLots, packingSummary, physicalPacking, isPackingProductCode} from '../shared/orderPreparation.js';
import {appendPreparationScan} from '../shared/preparationScanning.js';
import {loadOrderContext, buildDdt, verifyDdt} from '../server/order-preparation-mexal.js';
import {createOrderPreparationHandler} from '../server/order-preparation-handler.js';
import {preparationDatabase, supabaseAdapter, mexalFixture, actor, event} from './order-preparation-fixture.mjs';
import {buildPreparationPdf} from '../src/pages/Warehouse/preparationPdf.js';

function addService(raw) {
  const values={id_riga:24,tp_riga:'R',tipo_stato_riga:'S',codice_articolo:'SERV01',descr_riga:'Servizio di trasporto',quantita:1.5,tp_um_articolo:'2',id_mag_riga:0,prezzo:20,cod_iva:'22'};
  for(const [field,value] of Object.entries(values)) (raw[field] ||= []).push([4,value]);
}
function makeHandler(db,mexal) {
  const handler=createOrderPreparationHandler({authorize:async()=>({db,profile:{id:actor},canWrite:true,canConfigure:false}),clientFactory:()=>mexal});
  return async (operation,input={})=>{
    const res={setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};
    await handler({method:'POST',body:{operation,eventId:event(),...input}},res);
    assert.equal(res.statusCode,200,JSON.stringify(res.data));return res.data;
  };
}

test('packing families exclude services, including historical readings, without hiding genuine IT/MKT discrepancies',()=>{
  assert(isPackingProductCode('it0056'));assert(isPackingProductCode('MKT0096'));assert(!isPackingProductCode('SERV01'));
  const state=initialPacking(),box=state.packages[0].id;
  state.scans.push({id:event(),packageId:box,code:'IT0001',quantity:2,mode:'carton',barcode:'000001'});
  const ignoredBox={id:event(),number:2,palletId:null};state.packages.push(ignoredBox);
  state.scans.push({id:event(),packageId:ignoredBox.id,code:'SERV01',quantity:1.5,mode:'carton',barcode:'service'});
  const original=structuredClone(state),lines=[{code:'IT0001',quantity:2},{code:'SERV01',quantity:1.5}];
  assert(comparePacking(lines,state).ok);
  const allocations=allocateFifo([{code:'SERV01',quantity:1.5}],[],[],'20261103');assert.deepEqual(allocations,[]);
  const contents=distributeLots(state,[{code:'IT0001',quantity:2,lotId:1}]);
  const summary=packingSummary(state,contents,lines);
  assert.equal(summary.totalPieces,2);assert.equal(summary.totalPackages,1);assert(!JSON.stringify(summary).includes('SERV01'));
  const pdf=buildPreparationPdf({source:{series:1,number:900,customerName:'Cliente prova'},verification:{summary}}).output();
  assert(!pdf.includes('SERV01'));assert(pdf.includes('IT0001'));
  assert.deepEqual(state,original,'interpretation must not mutate the historical data');
  state.scans.push({id:event(),packageId:box,code:'MKT0096',quantity:1,mode:'piece',barcode:'MKT0096'});
  assert.equal(comparePacking(lines,state).discrepancies[0].kind,'wrong');
  assert.throws(()=>appendPreparationScan(state,{code:'SERV01'},{mode:'piece',packageId:box},event(),actor,event,new Date().toISOString()),/Solo gli articoli/);
  const trulyEmpty=initialPacking();assert(!comparePacking(lines,trulyEmpty).ok);
  assert.equal(physicalPacking(trulyEmpty).packages.length,1);
});

test('mixed OCM bypasses service catalog/unit/stock checks, ignores service scans and retains native DDT rows', {skip:!process.env.PGLITE_MODULE},async()=>{
  const {PGlite}=await import(process.env.PGLITE_MODULE),sql=await preparationDatabase(PGlite);
  try {
    const db=supabaseAdapter(sql),mexal=mexalFixture();addService(mexal.raw);
    const get=mexal.getJson;let serviceReads=0;
    mexal.getJson=async path=>{if(path==='/articoli/SERV01'){serviceReads++;throw Error('Service catalog must never be loaded');}return get(path);};
    const settings=(await sql.query('select * from warehouse_preparation_settings')).rows[0];
    const context=await loadOrderContext(mexal,'OC+1+900',db,settings);
    assert.equal(context.source.lines.length,2);assert.equal(context.source.excludedLines[0].code,'SERV01');assert.equal(serviceReads,0);
    const call=makeHandler(db,mexal);let {preparation:row}=await call('begin',{reference:'OC+1+900'});
    const before=(await sql.query('select count(*)::int n from warehouse_preparation_events')).rows[0].n;
    const input={id:row.id,version:row.version,packageId:row.state.packages[0].id,mode:'pallet',barcode:'SERV01'};
    const ignored=await call('scan',input);assert(ignored.ignored);assert.equal(ignored.preparation.version,row.version);assert.equal(ignored.preparation.state.scans.length,0);
    assert.equal((await sql.query('select count(*)::int n from warehouse_preparation_events')).rows[0].n,before);
    await sql.exec("insert into ordini_prodotti_cache(codice_articolo,ean,descrizione,unita_misura) values('SERV01','999999','Trasporto','ORE')");
    assert((await call('scan',{...input,barcode:'999999'})).ignored);
    const resolved=await call('resolve_product',{id:row.id,barcode:'SERV01'});assert(resolved.product.excluded);assert(!resolved.product.wrong);
    // Simulate a draft saved before this policy: reads interpret it safely,
    // without rewriting stored scans or immutable events behind the operator.
    const legacyState=structuredClone(row.state);
    legacyState.scans.push({id:event(),packageId:input.packageId,code:'SERV01',barcode:'999999',quantity:1.5,mode:'carton'});
    const legacySource={...row.source,lines:[...row.source.lines,...row.source.excludedLines]};delete legacySource.excludedLines;
    await sql.query('update warehouse_order_preparations set source=$1,state=$2 where id=$3',[legacySource,legacyState,row.id]);
    const reopened=await call('get',{id:row.id});
    assert.equal(reopened.preparation.source.lines.length,2);assert.equal(reopened.preparation.source.excludedLines.length,1);assert.equal(reopened.preparation.state.scans.length,0);
    assert.equal((await sql.query('select state from warehouse_order_preparations where id=$1',[row.id])).rows[0].state.scans.length,1);
    input.packageId=event();
    ({preparation:row}=await call('add_package',{id:row.id,version:row.version,packageId:input.packageId}));
    for(const [barcode,mode] of [['IT0001','carton'],['IT0002','piece']]) ({preparation:row}=await call('scan',{...input,version:row.version,barcode,mode}));
    const verified=await call('verify',{id:row.id,version:row.version});row=verified.preparation;
    assert(verified.verification.ok);assert.equal(verified.verification.summary.totalPieces,3);assert(!JSON.stringify(verified.verification.summary).includes('SERV01'));
    const prep={...row,source_raw:mexal.raw},payload=buildDdt(prep,context,verified.verification.allocations,settings,'20261103');
    assert.deepEqual(payload.quantita,mexal.raw.quantita);assert.deepEqual(payload.id_riga,mexal.raw.id_riga);
    const actual=await mexal.postJson('/documenti/movimenti-magazzino?sigla_trasformazione=BC',payload);
    assert.equal(verifyDdt(actual,prep,payload).signature,'BCF');
    const tampered=structuredClone(actual);tampered.quantita.find(row=>row[0]===4)[1]=2;
    assert.throws(()=>verifyDdt(tampered,prep,payload),/Quantità/);
    const missing=structuredClone(actual);missing.codice_articolo=missing.codice_articolo.filter(row=>row[0]!==4);
    assert.throws(()=>verifyDdt(missing,prep,payload),/Quantità/);
    assert.equal(serviceReads,0);
  } finally {await sql.close();}
});

test('orders containing only informational articles need no cartons, lots or product weights', {skip:!process.env.PGLITE_MODULE},async()=>{
  const {PGlite}=await import(process.env.PGLITE_MODULE),sql=await preparationDatabase(PGlite);
  try {
    const db=supabaseAdapter(sql),mexal=mexalFixture();addService(mexal.raw);
    for(const field of ['id_riga','tp_riga','tipo_stato_riga','codice_articolo','descr_riga','quantita','tp_um_articolo','id_mag_riga','prezzo','cod_iva','sconto']) mexal.raw[field]=mexal.raw[field].filter(row=>![2,3].includes(row[0]));
    const call=makeHandler(db,mexal),{preparation:row}=await call('begin',{reference:'OC+1+900'});
    assert.equal(row.source.lines.length,0);assert.equal(row.source.excludedLines.length,1);assert.equal(row.state.packages.length,0);
    const verified=await call('verify',{id:row.id,version:row.version});
    assert(verified.verification.ok);assert.equal(verified.verification.summary.totalPieces,0);
    const preview=await call('preview_dispatch',{id:row.id});
    const exported=await call('export',{id:row.id,version:verified.preparation.version,dispatchHash:preview.hash});
    assert.equal(exported.preparation.status,'completed');assert.equal(mexal.sends,1);
  } finally {await sql.close();}
});
