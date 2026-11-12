import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../.tmp/hr-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';

test('direct upload atomically preserves previous chunks, rejects stale state, and never replaces a final PDF',async()=>{
 const db=new PGlite(),actor='00000000-0000-4000-8000-000000000001',batch='00000000-0000-4000-8000-000000000002';
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table public.ruoli(id uuid primary key,amministratore_workspace boolean);
   create table public.utenti(id uuid primary key,ruolo_id uuid,attivo boolean);
   insert into public.ruoli values('${actor}',true);insert into public.utenti values('${actor}','${actor}',true);`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261107184049_commercial_report_delivery.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../../supabase/migrations/20261112064905_commercial_report_direct_upload.sql',import.meta.url),'utf8'));
  await db.exec(`insert into public.commercial_report_settings(singleton,owner_id,enabled,policy_hash,trigger_id,token_encrypted) values(true,'${actor}',true,'policy','agtch_fixture','fixture');
   insert into public.commercial_report_batches(id,period,owner_id,policy_hash,manifest,recipients_hash,status) values('${batch}','2026-10-01','${actor}','policy','[{"key":"a","network":"prof","source":"fatture"}]','fixture','requested');
   insert into public.commercial_report_chunks(batch_id,artifact_key,part,total,base64) values('${batch}','a',0,2,'T0xE');`);
  const file={batch_id:batch,artifact_key:'a',period:'2026-10-01',network:'prof',source:'fatture',filename:'verified.pdf',base64:'JVBERi0=',sha256:'a'.repeat(64),bytes:5,verified:true,pages:3};
  const sql='select commercial_report_store_pdf($1,$2,$3,$4::jsonb,$5::jsonb) as saved';
  await assert.rejects(()=>db.query(sql,[actor,batch,'a','[]',JSON.stringify(file)]),/Caricamento variato/);
  const snapshot=(await db.query("select part,total,md5(base64) as md5 from commercial_report_chunks")).rows;
  assert.equal((await db.query(sql,[actor,batch,'a',JSON.stringify(snapshot),JSON.stringify(file)])).rows[0].saved,true);
  const old=(await db.query('select previous_chunks from commercial_report_upload_history')).rows[0].previous_chunks;
  assert.equal(old[0].base64,'T0xE');assert.equal((await db.query('select * from commercial_report_chunks')).rows.length,0);
  assert.equal((await db.query(sql,[actor,batch,'a','[]',JSON.stringify(file)])).rows[0].saved,true);
  await assert.rejects(()=>db.query(sql,[actor,batch,'a','[]',JSON.stringify({...file,sha256:'b'.repeat(64)})]),/immutabile/);
  assert.deepEqual((await db.query("select has_table_privilege('authenticated','commercial_report_upload_history','select') as can_read,has_function_privilege('anon','commercial_report_store_pdf(uuid,uuid,text,jsonb,jsonb)','execute') as can_write")).rows,[{can_read:false,can_write:false}]);
 } finally {await db.close();}
});
