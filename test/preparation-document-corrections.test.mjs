import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {jsPDF} from 'jspdf';
import {createOrderPreparationHandler} from '../server/order-preparation-handler.js';
import {preparationDatabase,supabaseAdapter,mexalFixture,actor,event} from './order-preparation-fixture.mjs';
import {ensureDdtPdf,ensurePackingPdf} from '../server/preparation-ddt-pdf.js';
import {preparationAuditRecord,preparationAuditPage} from '../shared/preparationAudit.js';
import {buildPreparationAuditPdf} from '../src/pages/Warehouse/preparationAuditPdf.js';
import {buildPreparationPdf} from '../src/pages/Warehouse/preparationPdf.js';
const {PGlite}=await import(process.env.PGLITE_MODULE);

test('legacy address PDFs and verbose packing lists are corrected by immutable revisions without reissuing or reemailing',async()=>{
 const sql=await preparationDatabase(PGlite),db=supabaseAdapter(sql),mexal=mexalFixture();let row,writable=true;
 const handler=createOrderPreparationHandler({authorize:async()=>({db,profile:{id:actor},canWrite:writable,canConfigure:writable}),clientFactory:()=>mexal});
 async function call(operation,input={}){const res={setHeader(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',body:{operation,id:row?.id,version:row?.version,eventId:event(),...input}},res);assert.equal(res.statusCode,200,JSON.stringify(res.data));if(res.data.preparation)row=res.data.preparation;return res.data;}
 try{
  await call('begin',{reference:'OC+1+900'});await call('add_pallet',{palletId:event(),assignUnassigned:true});
  const pack=row.state.packages[0].id;await call('scan',{packageId:pack,barcode:'IT0001',mode:'carton'});await call('scan',{packageId:pack,barcode:'IT0002',mode:'piece'});await call('verify');
  const preview=await call('preview_dispatch');await call('export',{dispatchHash:preview.hash});
  // Historical fixture predates layout metadata. Production originals are never changed.
  await sql.exec("alter table warehouse_preparation_documents disable trigger warehouse_documents_immutable;update warehouse_preparation_documents set snapshot=jsonb_set(snapshot,'{dispatch}',(snapshot->'dispatch')-'pdfPrintModule'-'packingLayout'||jsonb_build_object('pdfPath','mexal:stampa_movimento_magazzino'));alter table warehouse_preparation_documents enable trigger warehouse_documents_immutable;");
  const old=(await sql.query("select sha256 from warehouse_preparation_documents where kind='bcf'")).rows[0].sha256;
  const persisted=(await sql.query('select * from warehouse_order_preparations')).rows[0];
  let renders=0;const pdf=new jsPDF();pdf.text('D.D.T. 1/123 - IT0001 - 2 pezzi',10,20);
  mexal.printMovementPdf=async()=>{renders++;return {body:Buffer.from(pdf.output('arraybuffer'))};};
  await assert.rejects(ensureDdtPdf(db,mexal,persisted,actor,false),/operatore abilitato/);
  await ensureDdtPdf(db,mexal,persisted);await ensureDdtPdf(db,mexal,persisted);
  await ensurePackingPdf(db,persisted);await ensurePackingPdf(db,persisted);
  assert.equal(renders,1);assert.equal(mexal.sends,1);
  const revisions=(await sql.query('select kind,sha256,base64 from warehouse_preparation_document_revisions')).rows;
  assert.equal(revisions.length,4);assert.notEqual(revisions.find(r=>r.kind==='bcf').sha256,old);
  assert.equal((await sql.query("select sha256 from warehouse_preparation_documents where kind='bcf'")).rows[0].sha256,old);
  assert.equal((await sql.query('select count(*)::int n from warehouse_shipment_emails')).rows[0].n,3);
  const downloaded=await call('document',{kind:'bcf'});assert.equal(downloaded.document.sha256,revisions.find(r=>r.kind==='bcf').sha256);
  assert.equal((await PDFDocument.load(Buffer.from(revisions.find(r=>r.kind==='bcf_print').base64,'base64'))).getPageCount(),3);
  await assert.rejects(sql.exec('delete from warehouse_preparation_document_revisions'),/immutabile/);
  await assert.rejects(sql.exec('update warehouse_preparation_documents set filename=filename'),/immutabile/);
  // Export freezes the last event ID, even if operators add events between pages.
  await sql.query("insert into warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) select $1,gen_random_uuid(),'verify',$2,'{}'::jsonb from generate_series(1,205)",[row.id,actor]);
  writable=false;let page=await call('audit_export'),maxId=page.maxId,records=[...page.records];
  await sql.query("insert into warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values($1,gen_random_uuid(),'verify',$2,'{}')",[row.id,actor]);
  while(page.nextAfter!==null){page=await call('audit_export',{after:page.nextAfter,maxId});records.push(...page.records);}
  assert.equal(records.at(-1).id,maxId);assert.equal(new Set(records.map(r=>r.id)).size,records.length);
  assert.ok(records.some(r=>r.operation==='ddt_pdf_corrected'));assert.ok(records.some(r=>r.readings.some(s=>s.id&&s.at&&s.actor===actor)));
 }finally{await sql.close();}
});

test('audit keeps removed and corrected reading IDs, original server time and box identities',()=>{
 const scan={id:event(),code:'IT0520',quantity:3,packageId:event(),at:'2026-11-02T10:00:00Z',actor,mode:'carton'};
 const state={scans:[scan],packages:[{id:scan.packageId,number:8,palletId:'p1'}],pallets:[{id:'p1',number:2}]};
 const base={id:4,event_id:event(),created_at:'2026-11-02T10:05:00Z',actor,event_type:'remove_quantity'};
 const corrected=preparationAuditRecord({...base,payload:{operatorName:'Operatore prova',beforeState:state,state:{...state,scans:[{...scan,quantity:2}]}}});
 assert.equal(corrected.readings[0].id,scan.id);assert.equal(corrected.readings[0].previousQuantity,3);assert.equal(corrected.readings[0].at,scan.at);assert.equal(corrected.readings[0].packageNumber,8);
 const removed=preparationAuditRecord({...base,payload:{beforeState:state,state:{...state,scans:[],packages:[]}}});
 assert.equal(removed.readings[0].action,'remove');assert.equal(removed.readings[0].palletNumber,2);
});

test('compact packing fits 55 single-article boxes in two pages and audit uses the shared letterhead',async()=>{
 const packs=Array.from({length:55},(_,i)=>({id:event(),number:i+1,palletId:'p1',pieces:3,netWeightKg:0.3,grossWeightKg:0.6,contents:[{code:'IT0520',description:'Prodotto di prova',lotCode:'L2026',quantity:3}]}));
 const prep={id:event(),source:{series:1,number:16601,year:2026,customerName:'Cliente prova',customerCode:'501.00001'},ddt:{signature:'BCF',series:1,number:2122,date:'20261102'},verification:{summary:{packages:packs,pallets:[{id:'p1',number:1,netWeightKg:16.5,grossWeightKg:53}],totalPallets:1,totalPackages:55,totalPieces:165,weightTotals:{netWeightKg:16.5,grossWeightKg:53}}}};
 const packing=buildPreparationPdf(prep);assert.equal(packing.getNumberOfPages(),2);
 const record=preparationAuditRecord({id:7,event_id:event(),created_at:'2026-11-02T10:05:00Z',actor,event_type:'scan',payload:{operatorName:'Mario Rossi',state:{scans:[{id:event(),code:'IT0520',quantity:3,packageId:packs[0].id,actor,at:'2026-11-02T10:05:00Z'}],packages:packs,pallets:prep.verification.summary.pallets}}});
 const registry=buildPreparationAuditPdf(prep,[record]);assert.equal(registry.getNumberOfPages(),1);
 await writeFile(new URL('../../packing-layout-check.pdf',import.meta.url),Buffer.from(packing.output('arraybuffer')));
 await writeFile(new URL('../../register-layout-check.pdf',import.meta.url),Buffer.from(registry.output('arraybuffer')));
});

test('legacy full snapshots emit each insertion once across export pages and resolve operator names',()=>{
 const pack={id:event(),number:1,palletId:'p1'},a={id:event(),code:'IT0520',quantity:3,packageId:pack.id,at:'2026-11-02T10:00:00Z',actor},b={...a,id:event(),code:'IT0509'};
 const state=scans=>({scans,packages:[pack],pallets:[{id:'p1',number:1}]});
 const e=(id,scans)=>({id,event_id:event(),actor,event_type:'save',created_at:'2026-11-02T10:05:00Z',payload:{state:state(scans)}});
 const operators=[{id:actor,nome:'Mario',cognome:'Rossi'}];
 const first=preparationAuditPage([e(1,[a]),e(2,[a,b])],{operators});
 assert.equal(first[0].readings.length,1);assert.equal(first[1].readings.length,1);assert.equal(first[1].readings[0].id,b.id);assert.equal(first[0].operatorName,'Mario Rossi');
 const next=preparationAuditPage([e(3,[a,b]),e(4,[{...a,quantity:2},b]),e(5,[b])],{operators,previousState:state([a,b])});
 assert.equal(next[0].readings.length,0);assert.equal(next[1].readings[0].action,'correction');assert.equal(next[2].readings[0].action,'remove');
 assert.equal(next[2].readings[0].id,a.id);assert.equal(next[2].readings[0].previousQuantity,2);
});
