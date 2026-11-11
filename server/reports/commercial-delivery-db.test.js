import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../.tmp/hr-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';

test('Postgres allows late pending mail, preserves uncertain outcomes, and moves to day 2 only after all sent',async()=>{
 const db=new PGlite(),owner='00000000-0000-4000-8000-000000000001',batch='00000000-0000-4000-8000-000000000002';
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table public.ruoli(id uuid primary key,amministratore_workspace boolean);
   create table public.utenti(id uuid primary key,ruolo_id uuid,attivo boolean);
   create table public.commercial_report_settings(singleton boolean primary key,owner_id uuid,policy_hash text,enabled boolean);
   create table public.commercial_report_batches(id uuid primary key,owner_id uuid,period date,policy_hash text,status text,created_at timestamptz default now());
   create table public.commercial_report_emails(id uuid primary key default gen_random_uuid(),batch_id uuid,delivery_key text,status text,worker_id text,lock_token uuid,claimed_at timestamptz);
   insert into ruoli values('${owner}',true);insert into utenti values('${owner}','${owner}',true);
   insert into commercial_report_settings values(true,'${owner}','policy',true);
   insert into commercial_report_batches values('${batch}','${owner}','2020-01-01','policy','queued',now());
   insert into commercial_report_emails(batch_id,delivery_key,status) values('${batch}','a','pending'),('${batch}','b','uncertain');`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261111202716_commercial_report_late_delivery.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('select delivery_day,next_delivery_day from commercial_report_settings')).rows,[{delivery_day:10,next_delivery_day:2}]);
  assert.equal((await db.query("select * from commercial_report_claim_email('worker')")).rows.length,1);
  assert.equal((await db.query("select * from commercial_report_claim_email('worker')")).rows.length,0);
  assert.equal((await db.query(`select commercial_report_finish_batch('${batch}') as finished`)).rows[0].finished,false);
  await db.exec(`update commercial_report_emails set status='sent' where batch_id='${batch}';`);
  assert.equal((await db.query(`select commercial_report_finish_batch('${batch}') as finished`)).rows[0].finished,true);
  assert.deepEqual((await db.query('select delivery_day,next_delivery_day from commercial_report_settings')).rows,[{delivery_day:2,next_delivery_day:null}]);
  assert.equal((await db.query(`select commercial_report_finish_batch('${batch}') as finished`)).rows[0].finished,true);
  await db.exec(`insert into commercial_report_batches(id,owner_id,period,policy_hash,status) values('00000000-0000-4000-8000-000000000003','${owner}','2099-01-01','policy','queued');
   insert into commercial_report_emails(batch_id,delivery_key,status) values('00000000-0000-4000-8000-000000000003','future','pending');`);
  assert.equal((await db.query("select * from commercial_report_claim_email('worker')")).rows.length,0);
  const privileges=await db.query("select has_function_privilege('anon','commercial_report_claim_email(text)','execute') as anon, has_function_privilege('authenticated','commercial_report_finish_batch(uuid)','execute') as authenticated");
  assert.deepEqual(privileges.rows,[{anon:false,authenticated:false}]);
 } finally {await db.close();}
});
