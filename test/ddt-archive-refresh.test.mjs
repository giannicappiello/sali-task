import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {preparationDatabase,actor} from './order-preparation-fixture.mjs';
import {renderArchivedDdtFiles,applyArchivedDdtRefresh} from '../server/ai/ddt-archive-refresh.js';
const {PGlite}=await import(process.env.PGLITE_MODULE);
const hash=n=>String(n).repeat(64),pdf=Buffer.from('%PDF-synthetic').toString('base64');
const migration=new URL('../supabase/migrations/20261104130000_archived_ddt_bc1_review.sql',import.meta.url);
async function fixture(){
 const db=await preparationDatabase(PGlite),id=randomUUID(),proposal=randomUUID();
 await db.exec(`create schema auth;create function auth.role() returns text language sql as $$select 'service_role'::text$$;
 create table ruoli(id uuid primary key,amministratore_workspace boolean);alter table utenti add column ruolo_id uuid;
 insert into ruoli values('${actor}',true);update utenti set ruolo_id='${actor}';
 create function workspace_screen_permission_for_user(uuid,text,text) returns boolean language sql as $$select true$$;
 create table ai_action_registry(code text primary key,system text,risk_level text,input_schema jsonb,required_permission text,active boolean,updated_at timestamptz default now());
 create table ai_action_audit(id uuid primary key,user_id uuid,tool text,status text,confirmed_at timestamptz,payload_summary jsonb,result jsonb);
 insert into warehouse_order_preparations(id,source_key,source,source_raw,source_hash,state,status,ddt,created_by,updated_by)
 values('${id}','synthetic','{"year":2026,"series":1,"number":900}','{}','hash','{}','completed','{"signature":"BCF","reference":"BC+1+42"}','${actor}','${actor}');`);
 for(const [kind,sha] of [['bcf',hash('a')],['bcf_print',hash('b')]])await db.query('insert into warehouse_preparation_documents(preparation_id,kind,filename,sha256,base64,snapshot) values($1,$2,$2,$3,$4,$5)',[id,kind,sha,pdf,{dispatch:{pdfPrintModule:'S',pdfPath:'mexal:stampa_movimento_magazzino'}}]);
 const target={id,year:2026,document:'1/42',reference:'BC+1+42',expectedSha:hash('a'),expectedPrintSha:hash('b')};
 await db.query('insert into ai_action_audit values($1,$2,$3,$4,now(),$5,null)',[proposal,actor,'DDT_ARCHIVED_PDF_REFRESH','confirmed',{printModule:'1',reason:'Aggiornamento richiesto in BC1 con prezzi',targets:[target]}]);
 await db.exec(await readFile(migration,'utf8'));
 const files=[{kind:'bcf',filename:'DDT_BC1.pdf',sha256:hash('c'),base64:pdf},{kind:'bcf_print',filename:'DDT_BC1_3_copie.pdf',sha256:hash('d'),base64:pdf}];
 return {db,id,proposal,files,target,call:()=>db.query('select warehouse_refresh_ddt_pdf($1,$2,$3,$4) result',[proposal,actor,id,files])};
}
test('archived originals and previous revisions remain immutable; both BC1 versions and audit progress commit once',async()=>{
 const f=await fixture();try{
  // A previous F revision must not prevent a new, explicitly confirmed BC1 correction.
  for(const [kind,sha] of [['bcf',hash('e')],['bcf_print',hash('f')]])await f.db.query('insert into warehouse_preparation_document_revisions(preparation_id,kind,filename,sha256,base64,snapshot,actor) values($1,$2,$2,$3,$4,$5,$6)',[f.id,kind,sha,pdf,{pdfPrintModule:'F'},actor]);
  f.target.expectedSha=hash('e');f.target.expectedPrintSha=hash('f');
  await f.db.query('update ai_action_audit set payload_summary=$2 where id=$1',[f.proposal,{printModule:'1',reason:'Passaggio a BC1 con prezzi',targets:[f.target]}]);
  await f.call();await f.call();
  const current=(await f.db.query('select kind,sha256,snapshot from warehouse_current_preparation_documents order by kind')).rows;
  assert.deepEqual(current.map(r=>r.sha256),[hash('c'),hash('d')]);
  assert.ok(current.every(r=>r.snapshot.pdfPrintModule==='1'&&r.snapshot.dispatch.pdfPrintModule==='1'));
  assert.equal((await f.db.query('select count(*)::int n from warehouse_preparation_document_revisions')).rows[0].n,4);
  assert.equal((await f.db.query("select sha256 from warehouse_preparation_documents where kind='bcf'")).rows[0].sha256,hash('a'));
  assert.equal((await f.db.query('select count(*)::int n from warehouse_preparation_events')).rows[0].n,1);
  assert.equal((await f.db.query('select count(*)::int n from warehouse_shipment_emails')).rows[0].n,0);
  assert.equal((await f.db.query('select count(*)::int n from warehouse_print_jobs')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('unconfirmed requests cannot change archived documents',async()=>{
 const f=await fixture();try{
  await f.db.query("update ai_action_audit set status='proposed',confirmed_at=null where id=$1",[f.proposal]);
  await assert.rejects(f.call(),/HUMAN_CONFIRMATION_REQUIRED/);
  assert.equal((await f.db.query('select count(*)::int n from warehouse_preparation_document_revisions')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('concurrent archive changes reject the proposal without appending partial document pairs',async()=>{
 const f=await fixture();try{
  f.target.expectedPrintSha=hash('f');
  await f.db.query('update ai_action_audit set payload_summary=$2 where id=$1',[f.proposal,{printModule:'1',reason:'BC1 con prezzi',targets:[f.target]}]);
  await assert.rejects(f.call(),/PDF cambiati dopo la proposta/);
  assert.equal((await f.db.query('select count(*)::int n from warehouse_preparation_document_revisions')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('archive refresh rechecks current permissions',async()=>{
 const f=await fixture();try{
  await f.db.exec('update ruoli set amministratore_workspace=false');
  await assert.rejects(f.call(),/FORBIDDEN/);
 }finally{await f.db.close();}
});
test('a previously queued email blocks correction so its attachments cannot change during sending',async()=>{
 const f=await fixture();try{
  await f.db.query("insert into warehouse_shipment_emails(preparation_id,recipient,roles,subject,body) values($1,'office@example.test','[\"backoffice\"]','subject','body')",[f.id]);
  await assert.rejects(f.call(),/Invio email precedente/);
  assert.equal((await f.db.query('select count(*)::int n from warehouse_preparation_document_revisions')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('rendering retrieves the existing bolla only and preserves every page in three complete copies',async()=>{
 const id=randomUUID(),source=await PDFDocument.create();source.addPage();source.addPage();const bytes=await source.save();
 const row={id,source:{year:2026,series:1,number:900,customerCode:'501.00001',lines:[]},ddt:{reference:'BC+1+42',series:1,number:42},export_payload:{cod_modulo:'F',serie:1,cod_conto:'501.00001',nota:`ALL:${id}`}};
 const actual={sigla:'BC',...row.export_payload,numero:42,sigla_ordine:[[1,'OC']],serie_ordine:[[1,1]],numero_ordine:[[1,900]]};
 const calls=[],client={anno:2026,getJson:async path=>{calls.push(['get',path]);return actual;},printMovementPdf:async data=>{calls.push(['pdf',data]);return {body:bytes};}};
 const files=await renderArchivedDdtFiles(client,row);
 assert.equal((await PDFDocument.load(Buffer.from(files[0].base64,'base64'))).getPageCount(),2);
 assert.equal((await PDFDocument.load(Buffer.from(files[1].base64,'base64'))).getPageCount(),6);
 assert.deepEqual(calls.map(c=>c[0]),['get','pdf']);assert.equal(calls[1][1].numero,42);
});
test('server execution refuses a proposed action before rendering or writing any PDF',async()=>{
 const query={select(){return this;},eq(){return this;},single:async()=>({data:{status:'proposed'}})};
 const auth={profile:{id:actor,ruoli:{amministratore_workspace:true}},admin:{rpc:async()=>({data:true}),from:()=>query}};
 await assert.rejects(applyArchivedDdtRefresh(auth,{id:randomUUID()},{render:()=>{throw new Error('must not render');}}),/Conferma umana/);
});
