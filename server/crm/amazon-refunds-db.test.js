/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('refund journal atomically imports pages, enforces cutoff and permissions, and freezes uncertain deliveries',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create function auth.role() returns text language sql as $$select coalesce(current_setting('test.auth_role',true),'service_role')$$;
   create function crm_row_visible(uuid,uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.visible',true),'true')='true'$$;
   create function crm_digital_module_for_connection(text) returns text language sql as $$select 'crm_online_amazon'$$;
   create table crm_external_connections(id uuid primary key default gen_random_uuid(),provider_code text,abilitata boolean,tipo text,responsabile_id uuid,reparto_id uuid);
   insert into crm_external_connections(provider_code,abilitata,tipo) values('amazon_sp_api',true,'amazon_seller');
   grant select on crm_external_connections to authenticated;`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261028160000_amazon_refund_cox.sql',import.meta.url),'utf8'));
  const connection=(await db.query('select * from crm_external_connections')).rows[0];
  const event={event_key:'a'.repeat(64),amazon_order_id:'405-5097949-2429931',posted_at:'2026-10-21T22:01:00Z',marketplace:'APJ6JRA9NG5V4',currency:'EUR',gross:14.7,net:12.05,tax:2.65,items:[{line_id:'1',sku:'SKU',quantity:1,gross:14.7,net:12.05,tax:2.65}],financial_hash:'hash-1',financial_snapshot:{transactionId:'txn'},source_status:'DEFERRED',parse_error:null};
  const store=(expected,rows,next,kind='finance')=>db.query('select crm_store_amazon_refund_page_service($1,$2,$3,$4,$5)',[connection.id,expected,kind,rows,next]);
  const state1={active:true,phase:'finance',token:'next'};
  await store({},[event],state1);
  assert.equal((await db.query('select count(*)::int n from crm_amazon_refunds')).rows[0].n,1);
  await assert.rejects(store({},[{...event,event_key:'b'.repeat(64)}],{}),/Cursore/);
  const old={...event,event_key:'c'.repeat(64),posted_at:'2026-10-21T21:59:59Z'};
  await assert.rejects(store(state1,[{...event,event_key:'b'.repeat(64)},old],{}),/precedente/);
  assert.equal((await db.query('select count(*)::int n from crm_amazon_refunds')).rows[0].n,1);
  await store(state1,[{...event,source_status:'DEFERRED_RELEASED'}],{});
  assert.equal((await db.query('select source_status from crm_amazon_refunds')).rows[0].source_status,'DEFERRED_RELEASED');
  const row=(await db.query('select * from crm_amazon_refunds')).rows[0];
  const payload={sigla:'CO',cod_modulo:'X',cod_conto:'501.02156',id_magazzino:4,data_documento:'20261022',quantita:[[1,-1]]};
  const claim=async(plan=payload,fingerprint='plan-1')=>(await db.query('select crm_claim_amazon_refund_service($1,$2,$3,$4) token',[row.id,plan,fingerprint,{}])).rows[0].token;
  await assert.rejects(claim({...payload,quantita:[[1,1]]}),/negative/);
  const token=await claim();assert.ok(token);assert.equal(await claim(),null);
  const finish=(status,reference,claimToken=token)=>db.query('select crm_finish_amazon_refund_service($1,$2,$3,$4,$5)',[row.id,claimToken,status,reference,null]);
  await assert.rejects(finish('emitted',{number:900,series:1}),/Riferimento/);
  await finish('reconciliation_required',null);assert.equal(await claim(),null);
  await assert.rejects(finish('blocked',null),/Claim/);
  const reference={number:900,series:1,year:'2026',date:'20261022'};
  await finish('emitted',reference);assert.equal(await claim(),null);
  const update=await claim(payload,'plan-2');assert.ok(update);assert.notEqual(update,token);
  await assert.rejects(finish('emitted',reference,token),/Claim/);
  await finish('emitted',reference,update);
  assert.equal((await db.query('select cox_reference from crm_amazon_refunds')).rows[0].cox_reference.number,900);
  await store({},[{...event,financial_hash:'changed'}],{});
  assert.equal((await db.query('select source_conflict from crm_amazon_refunds')).rows[0].source_conflict,true);
  await assert.rejects(claim(payload,'plan-3'),/non emettibile/);
  await db.exec("set test.auth_role='authenticated'");
  await assert.rejects(store({},[],{}),/Servizio riservato/);
  await assert.rejects(claim(),/Servizio riservato/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select token,pending_payload from crm_amazon_refunds'),/permission denied/);
  assert.equal((await db.query('select id,cox_reference from crm_amazon_refunds')).rows.length,1);
  await assert.rejects(db.query("update crm_amazon_refunds set export_status='pending'"),/permission denied/);
  await db.exec("set test.visible='false'");
  assert.equal((await db.query('select id from crm_amazon_refunds')).rows.length,0);
 }finally{await db.close();}
});

