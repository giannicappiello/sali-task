import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {createOrderPreparationHandler} from '../server/order-preparation-handler.js';
import {preparationDatabase,supabaseAdapter,mexalFixture,actor,event} from './order-preparation-fixture.mjs';
import {productCodeInScan} from '../shared/productScan.js';
import {appendPreparationScan,palletQuantity} from '../shared/preparationScanning.js';
import {initialPacking} from '../shared/orderPreparation.js';
import {claimShipmentEmail,updateShipmentEmail} from '../server/shipment-email-worker.js';
import {buildPreparationPdf,preparationForPallet} from '../src/pages/Warehouse/preparationPdf.js';
import {validateDispatchSettings} from '../server/preparation-dispatch.js';
import {validateSpecification} from '../server/product-specifications.js';
const {PGlite}=await import(process.env.PGLITE_MODULE);

async function fixture() {
  const sql=await preparationDatabase(PGlite),db=supabaseAdapter(sql),mexal=mexalFixture();let writable=true,row;
  const handler=createOrderPreparationHandler({authorize:async()=>({db,profile:{id:actor},canWrite:writable,canConfigure:writable}),clientFactory:()=>mexal});
  async function call(operation,extra={}) {
    const response={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};
    await handler({method:'POST',body:{id:row?.id,version:row?.version,eventId:event(),operation,...extra}},response);
    if(response.data.preparation)row=response.data.preparation;
    return response;
  }
  return {sql,db,mexal,call,get row(){return row;},readonly(){writable=false;}};
}
const ok=response=>{assert.equal(response.statusCode,200,JSON.stringify(response.data));return response.data;};

test('MKT recognition retains ambiguities and pallet quantities cannot be forged or inferred',()=>{
  assert.equal(productCodeInScan('https://catalog.test/MKT-ALFA'),'MKT-ALFA');
  assert.equal(productCodeInScan('https://catalog.test/MKT001-CMP'),'MKT001-CMP');
  assert.equal(productCodeInScan('mkt001'),'MKT001');
  assert.throws(()=>productCodeInScan('IT001 MKT001'),/più codici/);
  assert.equal(palletQuantity(12,40),480);assert.throws(()=>palletQuantity(0,40));assert.throws(()=>palletQuantity(12,0));
  const state=initialPacking(),pallet=event();state.pallets=[{id:pallet,number:1}];state.packages[0].palletId=pallet;
  const result=appendPreparationScan(state,{code:'MKT001',scannedValue:'MKT001',piecesPerCarton:12,boxesPerPallet:2,packagingSpecificationVersion:3},
    {mode:'pallet',packageId:state.packages[0].id,palletId:pallet},event(),actor,event,'server');
  assert.equal(result.packages.length,2);assert.equal(result.scans.reduce((n,s)=>n+s.quantity,0),24);
  assert.ok(result.scans.every(s=>s.boxesPerPallet===2 && s.specificationVersion===3));
  assert.throws(()=>appendPreparationScan(result,{piecesPerCarton:12,boxesPerPallet:2},{mode:'pallet',packageId:result.packages[0].id,palletId:pallet},event(),actor,event,'server'),/vuoto/);
});

test('full pallet, replay, reopen, partial correction, fresh verification, BCF and immutable artifacts',async()=>{
  const f=await fixture();
  try {
    f.mexal.raw.quantita[0][1]=4;
    await f.sql.exec("update workspace_product_specifications set data=data||'{\"boxesPerPallet\":\"2\"}' where article_code='IT0001'");
    ok(await f.call('begin',{reference:'OC+1+900'}));const pallet=event();
    ok(await f.call('add_pallet',{palletId:pallet,assignUnassigned:true}));
    const request={eventId:event(),version:f.row.version,packageId:f.row.state.packages[0].id,palletId:pallet,barcode:'IT0001',mode:'pallet',quantity:999};
    ok(await f.call('scan',request));assert.equal(f.row.state.packages.length,2);assert.equal(f.row.state.scans.length,2);
    ok(await f.call('scan',request));assert.equal(f.row.state.scans.length,2);
    ok(await f.call('scan',{barcode:'IT0002',mode:'piece',packageId:f.row.state.packages[1].id}));
    ok(await f.call('verify'));assert.equal(f.row.status,'verified');assert.ok(f.row.state.packages.every(p=>p.closed));
    const closedScan=f.row.state.scans[0],pack=f.row.state.packages[0];
    assert.equal((await f.call('remove_quantity',{scanId:closedScan.id,quantity:1,reason:'Correzione'})).statusCode,400);
    ok(await f.call('reopen_package',{packageId:pack.id,reason:'Controllo contenuto'}));assert.equal(f.row.status,'draft');
    assert.equal((await f.sql.query('select count(*)::int n from warehouse_preparation_lot_holds')).rows[0].n,0);
    ok(await f.call('remove_quantity',{scanId:closedScan.id,quantity:1,reason:'Rimosso prodotto danneggiato'}));
    assert.equal(f.row.state.scans[0].at,closedScan.at);assert.equal(f.row.state.scans[0].actor,actor);
    assert.equal(ok(await f.call('verify')).verification.ok,false);
    ok(await f.call('scan',{packageId:pack.id,barcode:'IT0001',mode:'piece'}));ok(await f.call('verify'));
    const denied=await f.call('export');assert.equal(denied.statusCode,409);assert.equal(f.mexal.sends,0);
    const preview=ok(await f.call('preview_dispatch'));assert.equal(preview.recipients.length,3);
    const emitted=ok(await f.call('export',{dispatchHash:preview.hash}));assert.equal(f.row.status,'completed');assert.equal(f.row.ddt.signature,'BCF');assert.equal(f.mexal.sends,1);
    assert.ok(!emitted.warning,emitted.warning);assert.equal(emitted.shipment.documents.length,4);
    const print=ok(await f.call('document',{kind:'bcf_print'})).document;
    assert.equal((await PDFDocument.load(Buffer.from(print.base64,'base64'))).getPageCount(),3);
    await f.sql.exec("update warehouse_preparation_settings set email_body='changed after emission'");
    ok(await f.call('finalize_documents'));assert.equal(f.mexal.sends,1);
    assert.equal((await f.sql.query('select count(*)::int n from warehouse_shipment_emails')).rows[0].n,3);
    await assert.rejects(f.sql.exec('delete from warehouse_preparation_events'),/immutabile/);
    await assert.rejects(f.sql.exec("update warehouse_preparation_documents set filename='changed'"),/immutabile/);
    const audit=ok(await f.call('audit'));assert.ok(audit.events.some(e=>e.payload.reason==='Rimosso prodotto danneggiato'));
    const claim=await claimShipmentEmail(f.db,'test-worker');assert.equal(claim.attachments.length,2);
    await updateShipmentEmail(f.db,claim.job,'test-worker','sending');
    const uncertain=await updateShipmentEmail(f.db,claim.job,'test-worker','retry','Response lost after SMTP acceptance');assert.equal(uncertain.status,'uncertain');
    await updateShipmentEmail(f.db,claim.job,'test-worker','complete','provider-123');
    await updateShipmentEmail(f.db,claim.job,'test-worker','retry','late timeout');
    assert.equal((await f.sql.query('select status from warehouse_shipment_emails where id=$1',[claim.job.id])).rows[0].status,'sent');
    // Only trusted printer inventory can make a printer selectable.
    ok(await f.db.rpc('warehouse_print_worker',{p_station:'MAGAZZINO',p_action:'inventory',p_input:{printers:['Warehouse Laser']}}).then(r=>({statusCode:r.error?400:200,data:r.error || r.data})));
    await f.sql.exec("update warehouse_preparation_settings set ddt_printer_id='MAGAZZINO:Warehouse Laser',packing_printer_id='MAGAZZINO:Warehouse Laser'");
    const printId=event();ok(await f.call('print_document',{eventId:printId,kind:'bcf_print'}));ok(await f.call('print_document',{eventId:printId,kind:'bcf_print'}));
    assert.equal((await f.sql.query('select count(*)::int n from warehouse_print_jobs')).rows[0].n,1);
    const job=(await f.db.rpc('warehouse_print_worker',{p_station:'MAGAZZINO',p_action:'claim',p_input:{}})).data;
    assert.equal(job.printerName,'Warehouse Laser');assert.equal(job.document.sha256,print.sha256);
    const started=await f.db.rpc('warehouse_print_worker',{p_station:'MAGAZZINO',p_action:'printing',p_input:{id:job.id,token:job.token}});assert.equal(started.error,null);
    await f.sql.exec("update warehouse_print_jobs set lease_expires_at=now()-interval '1 second'");
    await f.db.rpc('warehouse_print_worker',{p_station:'MAGAZZINO',p_action:'claim',p_input:{}});
    assert.equal((await f.sql.query('select status from warehouse_print_jobs')).rows[0].status,'uncertain');
    const nextPrint=event();
    const repeat=await f.call('ddt_reprint',{confirmed:true,printId:job.id,eventId:nextPrint,reason:'Verificata mancata uscita cartacea'});ok(repeat);
    ok(await f.call('ddt_reprint',{confirmed:true,printId:job.id,eventId:nextPrint,reason:'Verificata mancata uscita cartacea'}));
    assert.equal((await f.sql.query('select count(*)::int n from warehouse_print_jobs')).rows[0].n,2);
    f.readonly();assert.equal((await f.call('print_document',{kind:'bcf_print'})).statusCode,403);
    assert.equal((await f.call('ddt_configure',{backofficeEmails:['x@example.test']})).statusCode,403);
  } finally {await f.sql.close();}
});

test('pallet packing lists isolate contents, lots, counts and weights',()=>{
  const base={source:{year:2026,series:1,number:123,customerName:'Test',customerCode:'TEST'},ddt:{signature:'BCF',number:100,series:1},verification:{summary:{totalPallets:2,totalPackages:2,totalPieces:5,
    pallets:[{id:'a',number:1,netWeightKg:2,grossWeightKg:22.3},{id:'b',number:2,netWeightKg:3,grossWeightKg:23.3}],
    packages:[{id:'box1',palletId:'a',number:1,pieces:2,contents:[{code:'IT001',lotCode:'LOT-A',quantity:2}]},{id:'box2',palletId:'b',number:2,pieces:3,contents:[{code:'IT002',lotCode:'LOT-B',quantity:3}]}],weightTotals:{netWeightKg:5,grossWeightKg:45.6}}}};
  const single=preparationForPallet(base,'a');assert.equal(single.verification.summary.totalPieces,2);assert.equal(single.verification.summary.totalPackages,1);assert.equal(single.verification.summary.weightTotals.grossWeightKg,22.3);
  const text=buildPreparationPdf(base,{palletId:'a'}).output();assert.ok(text.includes('LOT-A'));assert.ok(!text.includes('LOT-B'));assert.ok(!text.includes('(COLLO / BOX 2)'));
  assert.throws(()=>preparationForPallet(base,'missing'));
});

test('DDT configuration rejects injected headers, invalid addresses and non-Mexal PDF paths',()=>{
  assert.throws(()=>validateDispatchSettings({emailSubject:'Hello\r\nBcc: a@test.it'}));
  assert.throws(()=>validateDispatchSettings({backofficeEmails:['x@test.it,y@test.it']}));
  assert.throws(()=>validateDispatchSettings({ddtPdfPath:'https://external.test/{reference}'}));
  assert.throws(()=>validateDispatchSettings({ddtPdfPath:'/documenti/../secret/{reference}'}));
  assert.throws(()=>validateSpecification({expectedVersion:0,attachments:[],data:{boxesPerPallet:'3',piecesPerBox:'12',boxesPerLayer:'1.5',layers:'2'}}));
});

test('MKT present on the order can fill a missing specification and be scanned',async()=>{
  const f=await fixture();
  try {
    f.mexal.raw.codice_articolo[0][1]='MKT-ALFA';
    await f.sql.exec("insert into ordini_prodotti_cache(codice_articolo,descrizione,ean,unita_misura) values('MKT-ALFA','Marketing','009999','PZ')");
    const get=f.mexal.getJson.bind(f.mexal);
    f.mexal.getJson=async path=>{
      const result=await get(path);
      if(path.startsWith('/progressivi-articoli')) result.cod_articolo[0][1]='MKT-ALFA';
      if(path==='/lotti/51')result.cod_articolo='MKT-ALFA';
      return result;
    };
    ok(await f.call('begin',{reference:'OC+1+900'}));
    const scan=ok(await f.call('scan',{barcode:'MKT-ALFA',mode:'piece',packageId:f.row.state.packages[0].id,unitWeightGrams:100}));
    assert.equal(scan.scan.code,'MKT-ALFA');assert.equal(scan.scan.wrong,false);
    assert.equal((await f.sql.query("select data->>'totalWeightGrams' weight from workspace_product_specifications where article_code='MKT-ALFA'")).rows[0].weight,'100');
  } finally {await f.sql.close();}
});
