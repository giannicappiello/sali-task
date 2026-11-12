import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../.tmp/hr-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';

test('explicit resend preserves the attempt, is idempotent, rejects stale/in-flight/sent jobs and keeps other deliveries intact',async()=>{
 const db=new PGlite(),actor='00000000-0000-4000-8000-000000000001',batch='00000000-0000-4000-8000-000000000002',email='00000000-0000-4000-8000-000000000003',request='00000000-0000-4000-8000-000000000004';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table public.ruoli(id uuid primary key,amministratore_workspace boolean);create table public.utenti(id uuid primary key,ruolo_id uuid,attivo boolean);
   insert into public.ruoli values('${actor}',true);insert into public.utenti values('${actor}','${actor}',true);`);
  for(const path of ['20261107184049_commercial_report_delivery.sql','20261112071500_commercial_report_authorized_resend.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+path,import.meta.url),'utf8'));
  await db.exec(`insert into commercial_report_settings(singleton,owner_id,enabled,policy_hash,trigger_id,token_encrypted) values(true,'${actor}',true,'policy','agtch_fixture','fixture');
   insert into commercial_report_batches(id,period,owner_id,policy_hash,manifest,recipients_hash,status) values('${batch}','2026-10-01','${actor}','policy','[]','fixture','queued');
   insert into commercial_report_emails(id,batch_id,delivery_key,recipient,subject,body,artifact_keys,status,claimed_at,lock_token,last_error)
    values('${email}','${batch}','aggregate','central@example.test','report','report','["pdf"]','uncertain',now()-interval '11 minutes','${request}','prior error');
   insert into commercial_report_emails(batch_id,delivery_key,recipient,subject,body,artifact_keys,status,sent_at) values('${batch}','individual:a','agent@example.test','report','report','["pdf"]','sent',now());`);
  const claimed=(await db.query('select claimed_at from commercial_report_emails where id=$1',[email])).rows[0].claimed_at;
  const sql='select commercial_report_authorize_resend($1,$2,$3,$4,$5,$6,$7) as requeued',args=[actor,batch,email,claimed,request,'Explicit owner request after receipt check',true];
  await assert.rejects(()=>db.query(sql,[...args.slice(0,6),false]),/Conferma esplicita/);
  await assert.rejects(()=>db.query(sql,[actor,batch,email,new Date(),...args.slice(4)]),/Esito variato/);
  assert.equal((await db.query(sql,args)).rows[0].requeued,true);
  assert.equal((await db.query(sql,args)).rows[0].requeued,false);
  const previous=(await db.query('select previous_attempt from commercial_report_resend_history')).rows[0].previous_attempt;
  assert.equal(previous.last_error,'prior error');assert.equal(previous.lock_token,request);
  assert.equal((await db.query('select status from commercial_report_emails where id=$1',[email])).rows[0].status,'pending');
  assert.equal((await db.query("select count(*)::int n from commercial_report_emails where status='sent'")).rows[0].n,1);
  await db.exec(`update commercial_report_emails set status='uncertain',claimed_at=now() where id='${email}'`);
  const current=(await db.query('select claimed_at from commercial_report_emails where id=$1',[email])).rows[0].claimed_at;
  await assert.rejects(()=>db.query(sql,[actor,batch,email,current,'00000000-0000-4000-8000-000000000005',...args.slice(5)]),/ancora in corso/);
  assert.equal((await db.query("select has_table_privilege('authenticated','commercial_report_resend_history','select') as can_read,has_function_privilege('anon','commercial_report_authorize_resend(uuid,uuid,uuid,timestamptz,uuid,text,boolean)','execute') as can_write")).rows[0].can_read,false);
 }finally{await db.close();}
});
