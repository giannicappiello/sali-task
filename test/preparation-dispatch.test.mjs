import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {createOrderPreparationHandler} from '../server/order-preparation-handler.js';
import {preparationDatabase,supabaseAdapter,mexalFixture,actor,event} from './order-preparation-fixture.mjs';
import {productCodeInScan} from '../shared/productScan.js';
import {appendPreparationScan,palletQuantity} from '../shared/preparationScanning.js';
import {initialPacking} from '../shared/orderPreparation.js';
import {claimShipmentEmail,updateShipmentEmail,claimShipmentForHttpWorker} from '../server/shipment-email-worker.js';
import {buildPreparationPdf,preparationForPallet} from '../src/pages/Warehouse/preparationPdf.js';
import {validateDispatchSettings,shipmentPreview,MEXAL_BCF_PDF_SERVICE} from '../server/preparation-dispatch.js';
import {validateSpecification} from '../server/product-specifications.js';
import {createMesDdtPrinting} from '../server/ddt-mes-print.js';
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
const createHashForTest=value=>createHash('sha256').update(value).digest('hex');

test('recipient switches persist with audit and exclude disabled roles without requiring their addresses',async()=>{
  const f=await fixture();
  try {
    const initial=ok(await f.call('ddt_settings'));
    ok(await f.call('ddt_configure',{settingsVersion:initial.settings.updated_at,emailCustomers:false,emailAgents:false}));
    const saved=ok(await f.call('ddt_settings')).settings;
    assert.equal(saved.email_customers,false);assert.equal(saved.email_agents,false);
    const events=await f.sql.query('select before_settings,after_settings from warehouse_dispatch_configuration_events order by created_at desc limit 1');
    assert.equal(events.rows[0].before_settings.email_customers,true);
    assert.equal(events.rows[0].after_settings.email_agents,false);
    const row={id:event(),version:1,source_hash:'test',source:{customerCode:'missing'},source_raw:{}};
    let customerCalls=0;
    const client={getJson:async()=>{customerCalls++;return {email:'client@example.test'};}};
    const disabled=await shipmentPreview(f.db,client,row,saved);
    assert.equal(customerCalls,0);assert.deepEqual(disabled.recipients,[{email:'office@example.test',roles:['backoffice']}]);
    const customerOnly=await shipmentPreview(f.db,client,row,{...saved,email_customers:true});
    assert.equal(customerCalls,1);assert.ok(customerOnly.recipients.some(r=>r.roles.includes('cliente')));
    assert.notEqual(customerOnly.hash,disabled.hash);
    const missingAgent=await shipmentPreview(f.db,client,row,{...saved,email_agents:true});
    assert.equal(missingAgent.recipientWarnings[0].role,'agente');
    assert.equal(missingAgent.recipientWarnings[0].code,'agent_missing');
    assert.throws(()=>validateDispatchSettings({emailCustomers:'false'}),/Scelta destinatari/);
    assert.deepEqual(validateDispatchSettings({emailCustomers:false,emailAgents:true}),{email_customers:false,email_agents:true});
  } finally {await f.sql.close();}
});

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
  assert.throws(()=>appendPreparationScan(result,{code:'MKT001',piecesPerCarton:12,boxesPerPallet:2},{mode:'pallet',packageId:result.packages[0].id,palletId:pallet},event(),actor,event,'server'),/vuoto/);
});

test('full pallet, replay, reopen, partial correction, fresh verification, BCF and immutable artifacts',async()=>{
  const f=await fixture();
  try {
    await f.sql.query('update warehouse_preparation_settings set ddt_pdf_path=$1',[MEXAL_BCF_PDF_SERVICE]);
    let pdfRequests=0;
    f.mexal.printMovementPdf=async document=>{pdfRequests++;assert.deepEqual(document,{sigla:'BC',serie:1,numero:123,cod_conto:'501.00001',cod_modulo:'F'});return f.mexal.getBinary();};
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
    assert.equal(pdfRequests,1);
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
    const legacy=await claimShipmentForHttpWorker(f.db,'legacy-aruba',{legacyAruba:true});
    assert.equal(legacy.attachments.length,2);
    assert.equal((await f.sql.query('select status from warehouse_shipment_emails where id=$1',[legacy.job.id])).rows[0].status,'sending');
    // Claim response lost: the unchanged Aruba worker never received the job.
    await f.sql.query("update warehouse_shipment_emails set lease_expires_at=now()-interval '1 second' where id=$1",[legacy.job.id]);
    const nextLegacy=await claimShipmentForHttpWorker(f.db,'legacy-aruba-next',{legacyAruba:true});
    assert.notEqual(nextLegacy.job.id,legacy.job.id);
    assert.equal((await f.sql.query('select status from warehouse_shipment_emails where id=$1',[legacy.job.id])).rows[0].status,'uncertain');
    await updateShipmentEmail(f.db,nextLegacy.job,'legacy-aruba-next','complete','aruba-message-id');
    assert.equal((await f.sql.query('select status from warehouse_shipment_emails where id=$1',[nextLegacy.job.id])).rows[0].status,'sent');
    assert.equal(await claimShipmentForHttpWorker(f.db,'legacy-aruba-late',{legacyAruba:true}),null);
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
    let posts=0,accepted=0;const remoteId=event();
    const printing=createMesDdtPrinting({env:{PROGREMES_URL:'https://mes.example.test',PROGREMES_INTEGRATION_SECRET:'test'},transport:async(url,options)=>{
      if(url.pathname.endsWith('/printers'))return {ok:true,json:async()=>({enabled:true,printers:[{name:'MES Laser',available:true,canPrintSilently:true},{name:'PDF',available:true,canPrintSilently:false}]})};
      if(options.method==='POST'){
        posts++;assert.equal(url.searchParams.get('copies'),'1');assert.equal(url.searchParams.get('printer'),'MES Laser');
        assert.equal(createHashForTest(options.body),print.sha256);
        if(posts===1){accepted++;throw Error('Response lost after acceptance');}
      }
      return {ok:true,json:async()=>({id:remoteId,requestId:'ddt:'+mesRequest,printer:'MES Laser',status:options.method==='POST'?'Queued':'Completed'})};
    }});
    await printing.inventory(f.db);
    assert.equal((await f.sql.query("select count(*)::int n from warehouse_printers where station='MES'")).rows[0].n,1);
    await f.sql.exec("update warehouse_preparation_settings set ddt_printer_id='MES:MES Laser'");
    const mesRequest=event();
    assert.equal((await f.db.rpc('warehouse_enqueue_print',{p_id:f.row.id,p_request:mesRequest,p_kind:'bcf_print',p_actor:actor})).error,null);
    assert.equal((await printing.sync(f.db,mesRequest)).status,'uncertain');
    assert.equal((await printing.sync(f.db,mesRequest)).status,'printing');
    assert.equal((await printing.sync(f.db,mesRequest)).status,'submitted');
    await printing.sync(f.db,mesRequest);assert.equal(posts,2);assert.equal(accepted,1);
    // Selectable copies use the single-copy original and retain the count on retry.
    await f.sql.exec("update warehouse_print_jobs set status='failed' where printer_id not like 'MES:%'");
    const copiesId=event(),args={p_id:f.row.id,p_request:copiesId,p_kind:'bcf_print',p_actor:actor,p_copies:2};
    const selected=await f.db.rpc('warehouse_enqueue_print_copies',args);
    assert.equal(selected.error,null);assert.equal(selected.data.copies,2);assert.equal(selected.data.reprint_of,mesRequest);
    assert.equal((await f.db.rpc('warehouse_enqueue_print_copies',args)).data.id,copiesId);
    assert.ok((await f.db.rpc('warehouse_enqueue_print_copies',{...args,p_copies:3})).error);
    assert.ok((await f.db.rpc('warehouse_enqueue_print_copies',{...args,p_request:event()})).error);
    for(const invalid of [0,51,null]) assert.ok((await f.db.rpc('warehouse_enqueue_print_copies',{...args,p_request:event(),p_copies:invalid})).error);
    const original=ok(await f.call('document',{kind:'bcf'})).document;
    let copyPosts=0;
    const selectable=createMesDdtPrinting({env:{PROGREMES_URL:'https://mes.example.test',PROGREMES_INTEGRATION_SECRET:'test'},transport:async(url,options)=>{
      copyPosts++;assert.equal(options.method,'POST');assert.equal(url.searchParams.get('copies'),'2');
      assert.equal(url.searchParams.get('forceReprint'),'true');assert.equal(url.searchParams.get('reprintOfJobId'),remoteId);
      assert.equal(createHashForTest(options.body),original.sha256);
      assert.equal((await PDFDocument.load(options.body)).getPageCount(),1);
      return {ok:true,json:async()=>({id:event(),requestId:'ddt:'+copiesId,printer:'MES Laser',status:'Completed'})};
    }});
    assert.equal((await selectable.sync(f.db,copiesId)).status,'submitted');
    await selectable.sync(f.db,copiesId);assert.equal(copyPosts,1);
    assert.equal((await f.sql.query("select payload->>'copies' copies from warehouse_preparation_events where event_type='print_copies_selected'")).rows[0].copies,'2');
    await f.sql.exec("update warehouse_preparation_settings set packing_printer_id='MES:MES Laser'");
    const packingKind='packing_pallet_'+pallet,packingId=event();
    const packingDoc=ok(await f.call('document',{kind:packingKind})).document;
    assert.equal((await f.db.rpc('warehouse_enqueue_print_copies',{...args,p_request:packingId,p_kind:packingKind,p_copies:4})).error,null);
    const packingPrinter=createMesDdtPrinting({env:{PROGREMES_URL:'https://mes.example.test',PROGREMES_INTEGRATION_SECRET:'test'},transport:async(url,options)=>{
      assert.equal(url.searchParams.get('copies'),'4');assert.equal(createHashForTest(options.body),packingDoc.sha256);
      return {ok:true,json:async()=>({id:event(),requestId:'ddt:'+packingId,printer:'MES Laser',status:'Completed'})};
    }});
    assert.equal((await packingPrinter.sync(f.db,packingId)).status,'submitted');
    f.readonly();assert.equal((await f.call('print_document',{kind:'bcf_print'})).statusCode,403);
    assert.equal((await f.call('ddt_configure',{backofficeEmails:['x@example.test']})).statusCode,403);
  } finally {await f.sql.close();}
});

test('automatic Mexal verification preserves recipient and printer settings, checks a real PDF and audits only the integration change',async()=>{
  const f=await fixture();
  try {
    const get=f.mexal.getJson.bind(f.mexal),post=f.mexal.postJson.bind(f.mexal);
    f.mexal.getJson=async path=>path==='/help'?{risorse:[{regexp:'^/documenti/moduli-stampa/[A-Z]+$',method:'GET'}]}:path==='/documenti/moduli-stampa/BC'?{elenco_moduli_stampa_disponibili:[{codice:'BCF'},{codice:'BCS',descrizione:'Bolla senza Prezzi'}]}:get(path);
    f.mexal.postJson=async(path,body)=>path.startsWith('/documenti/movimenti-magazzino/ricerca')?{dati:[{sigla:'BC',serie:1,numero:10,cod_conto:'501.00001'}]}:post(path,body);
    f.mexal.printMovementPdf=()=>f.mexal.getBinary();
    const initial=ok(await f.call('ddt_settings')).settings;
    ok(await f.call('ddt_verify',{settingsVersion:initial.updated_at}));
    const saved=ok(await f.call('ddt_settings')).settings;
    assert.equal(saved.ddt_pdf_path,MEXAL_BCF_PDF_SERVICE);
    assert.equal(saved.bcf_contract_verified,true);
    assert.deepEqual(saved.backoffice_emails,initial.backoffice_emails);
    assert.equal(saved.ddt_printer_id,initial.ddt_printer_id);
    assert.equal(f.mexal.sends,0);
    assert.match(saved.contract_evidence,/SHA256 [a-f0-9]{64}/);
    assert.ok((await f.sql.query('select count(*)::int n from warehouse_dispatch_configuration_events')).rows[0].n>0);
    f.mexal.printMovementPdf=async()=>{throw Error('PDF unavailable');};
    assert.equal((await f.call('ddt_verify',{settingsVersion:saved.updated_at})).statusCode,409);
    assert.equal(String(ok(await f.call('ddt_settings')).settings.updated_at),String(saved.updated_at));
    f.readonly();assert.equal((await f.call('ddt_verify')).statusCode,403);
  } finally {await f.sql.close();}
});

test('delete a verified full package atomically, release FIFO and retain removed readings in immutable audit',async()=>{
  const f=await fixture();
  try {
    ok(await f.call('begin',{reference:'OC+1+900'}));
    const pallet=event();ok(await f.call('add_pallet',{palletId:pallet,assignUnassigned:true}));
    const packageId=f.row.state.packages[0].id;
    for(const line of f.row.source.lines) for(let i=0;i<line.quantity;i++) ok(await f.call('scan',{barcode:line.code,mode:'piece',packageId}));
    ok(await f.call('verify'));assert.equal(f.row.status,'verified');
    const quantity=f.row.state.scans.reduce((n,s)=>n+s.quantity,0),requestId=event();
    assert.equal((await f.call('remove_package',{packageId})).statusCode,400);
    ok(await f.call('remove_package',{packageId,confirmed:true,reason:'Collo danneggiato',eventId:requestId}));
    assert.equal(f.row.status,'draft');assert.equal(f.row.state.scans.length,0);assert.equal(f.row.state.packages.length,0);
    assert.equal((await f.sql.query('select count(*)::int n from warehouse_preparation_lot_holds')).rows[0].n,0);
    const audit=ok(await f.call('audit')).events.find(e=>e.event_id===requestId);
    assert.equal(audit.payload.removedPackage.id,packageId);
    assert.equal(audit.payload.removedScans.reduce((n,s)=>n+s.quantity,0),quantity);
    ok(await f.call('remove_package',{packageId,confirmed:true,reason:'Collo danneggiato',eventId:requestId}));
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

test('Mexal lists of addresses are split, deduplicated and validated separately without accepting header injection',async()=>{
 const f=await fixture();
 try {
  const settings=ok(await f.call('ddt_settings')).settings;
  const row={id:event(),version:1,source_hash:'test',source:{customerCode:'501.00001'},source_raw:{codice_agente:'602.00001'}};
  await f.sql.exec("update mexal_agenti set email='one@example.test; two@example.test; ONE@example.test'");
  const client={getJson:async()=>({email:[[1,''],[2,'customer@example.test']],mail:' customer@example.test '})};
  const preview=await shipmentPreview(f.db,client,row,settings);
  assert.deepEqual(preview.recipientWarnings,[]);
  assert.deepEqual(preview.recipients.filter(r=>r.roles.includes('agente')).map(r=>r.email),['one@example.test','two@example.test']);
  assert.equal(preview.recipients.length,4);
  await f.sql.exec("update mexal_agenti set email='one@example.test; broken-address'");
  const partial=await shipmentPreview(f.db,client,row,settings);
  assert.equal(partial.recipientWarnings[0].code,'partially_invalid');
  assert(partial.recipients.some(r=>r.email==='one@example.test'));
  assert.notEqual(partial.hash,preview.hash);
  const injection=await shipmentPreview(f.db,{getJson:async()=>({email:'valid@example.test\r\nBcc: outsider@example.test'})},row,settings);
  assert(!injection.recipients.some(r=>r.roles.includes('cliente')));
  assert(injection.recipientWarnings.some(r=>r.role==='cliente'));
  const failedLookup=await shipmentPreview(f.db,{getJson:async()=>{throw Error('offline');}},row,settings);
  assert(failedLookup.recipientWarnings.some(r=>r.code==='lookup_failed'));
 } finally {await f.sql.close();}
});

test('missing client and agent emails do not block BCF, immutable PDFs, print jobs or valid backoffice dispatch',async()=>{
 const f=await fixture();
 try {
  f.mexal.printMovementPdf=async()=>f.mexal.getBinary();
  const get=f.mexal.getJson;
  f.mexal.getJson=async path=>path.startsWith('/clienti/')?{...(await get(path)),email:''}:get(path);
  await f.sql.exec("update mexal_agenti set email=null;update warehouse_preparation_settings set ddt_pdf_path='mexal:stampa_movimento_magazzino'");
  ok(await f.call('begin',{reference:'OC+1+900'}));
  ok(await f.call('add_pallet',{palletId:event(),assignUnassigned:true}));
  const packageId=f.row.state.packages[0].id;
  ok(await f.call('scan',{packageId,barcode:'IT0001',mode:'carton'}));
  ok(await f.call('scan',{packageId,barcode:'IT0002',mode:'piece'}));
  ok(await f.call('verify'));
  const preview=ok(await f.call('preview_dispatch'));
  assert.equal(preview.recipientWarnings.length,2);
  assert.deepEqual(preview.recipients,[{email:'office@example.test',roles:['backoffice']}]);
  const result=ok(await f.call('export',{dispatchHash:preview.hash}));
  assert.equal(result.preparation.status,'completed');assert.equal(f.mexal.sends,1);
  assert.equal(result.preparation.recipientWarnings.length,2);
  const saved=(await f.sql.query('select dispatch_snapshot from warehouse_order_preparations')).rows[0].dispatch_snapshot;
  assert.deepEqual(saved.recipientWarnings,preview.recipientWarnings);
  const jobs=(await f.sql.query('select recipient from warehouse_shipment_emails')).rows;
  assert.deepEqual(jobs,[{recipient:'office@example.test'}]);
  assert.equal((await f.sql.query('select count(*)::int n from warehouse_preparation_documents')).rows[0].n,4);
  await f.sql.exec("insert into warehouse_printers(id,station,name) values('TEST:Laser','TEST','Laser');update warehouse_preparation_settings set ddt_printer_id='TEST:Laser',packing_printer_id='TEST:Laser'");
  for(const kind of ['bcf_print','packing_pallet_'+f.row.state.pallets[0].id]) {
    const queued=await f.db.rpc('warehouse_enqueue_print',{p_id:f.row.id,p_request:event(),p_kind:kind,p_actor:actor});
    assert.ifError(queued.error);
  }
  assert.equal((await f.sql.query('select count(*)::int n from warehouse_print_jobs')).rows[0].n,2);
  const audit=(await f.sql.query("select payload from warehouse_preparation_events where event_type='claim_export'")).rows[0].payload;
  assert.deepEqual(audit.dispatch.recipientWarnings,preview.recipientWarnings);
  const history=ok(await f.call('audit_export')).records.find(r=>r.operation==='claim_export');
  assert.match(history.reason,/cliente/);assert.match(history.reason,/agente/);
  assert.equal(ok(await f.call('get')).preparation.recipientWarnings.length,2);
  const snapshot=await f.sql.query("select sha256 from warehouse_preparation_documents where kind='packing_list'");
  ok(await f.call('finalize_documents'));
  assert.equal((await f.sql.query('select count(*)::int n from warehouse_shipment_emails')).rows[0].n,1);
  assert.equal((await f.sql.query("select sha256 from warehouse_preparation_documents where kind='packing_list'")).rows[0].sha256,snapshot.rows[0].sha256);
 } finally {await f.sql.close();}
});
