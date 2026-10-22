/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Amazon dates preserve purchase timestamp, reconcile cache, reject unverified COX and keep waiting separate', {skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.role() returns text language sql as $$select coalesce(current_setting('test.auth_role',true),'service_role')$$;
 create table crm_external_connections(id uuid primary key default gen_random_uuid(),provider_code text,abilitata boolean default true);
 create table crm_external_orders(id uuid primary key default gen_random_uuid(),connection_id uuid references crm_external_connections(id),external_id text,stato text,ordered_at timestamptz,raw_summary jsonb default '{}');
 insert into crm_external_connections(provider_code) values('amazon_sp_api');`);
 for(const migration of ['20261021150000_amazon_cox_exports.sql','20261022113000_amazon_cox_verified_reconciliation.sql','20261022123000_amazon_fulfillment_dates.sql']) await db.exec(await readFile(new URL('../../supabase/migrations/'+migration,import.meta.url),'utf8'));
 const conn=(await db.query('select id from crm_external_connections')).rows[0].id;
 const add=async(id,status)=>(await db.query("insert into crm_external_orders(connection_id,external_id,stato,ordered_at) values($1,$2,$3,'2026-10-19T10:00:00Z') returning id",[conn,id,status])).rows[0].id;
 const id=await add('123-1234567-1234567','SHIPPED'),pending=await add('222-1234567-1234567','PENDING');
 await assert.rejects(db.query('select crm_claim_amazon_cox_service($1)',[id]),/spedito/);
 const store=rows=>db.query('select crm_store_amazon_shipment_dates_service($1,$2,$3,$4)',[conn,JSON.stringify(rows),'{}','2026-10-22T10:00:00Z']);
 await store([{external_id:'123-1234567-1234567',shipped_at:'2026-10-21T23:00:00Z'}]);
 const row=(await db.query('select * from crm_external_orders where id=$1',[id])).rows[0];
 assert.equal(new Date(row.ordered_at).toISOString(),'2026-10-21T23:00:00.000Z');
 assert.equal(new Date(row.raw_summary.purchase_date).toISOString(),'2026-10-19T10:00:00.000Z');
 assert.equal(row.raw_summary.date_basis,'fulfillment');
 assert.ok((await db.query('select crm_claim_amazon_cox_service($1) token',[id])).rows[0].token);
 assert.equal((await db.query('select fulfilled_at from crm_external_orders where id=$1',[pending])).rows[0].fulfilled_at,null);
 await store([{external_id:'123-1234567-1234567',shipped_at:'2026-10-21T12:00:00Z'}]);
 assert.equal(new Date((await db.query('select fulfilled_at from crm_external_orders where id=$1',[id])).rows[0].fulfilled_at).toISOString(),'2026-10-21T23:00:00.000Z');
 await db.exec("set test.auth_role='authenticated'");
 await assert.rejects(store([]),/riservato/);
 }finally{await db.close();}
});
