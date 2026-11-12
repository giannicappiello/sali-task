import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../.tmp/hr-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {commercialEmailParts} from './commercial-worker.js';

test('multipart plan is deterministic, bounded and includes each original PDF exactly once',()=>{
 const keys=Array.from({length:16},(_,i)=>String(i)),files=keys.map(key=>({artifact_key:key,bytes:750000,sha256:key.padStart(64,'0')}));
 const plan=commercialEmailParts(files,keys);
 assert.equal(plan.parts.length,4);assert.deepEqual(plan.parts.flatMap(p=>p.artifact_keys),keys);
 assert.deepEqual(commercialEmailParts([...files].reverse(),keys),plan);
 assert.ok(plan.parts.every(p=>p.artifact_keys.reduce((n,k)=>n+files.find(f=>f.artifact_key===k).bytes,0)<=3000000));
});

test('part receipts survive owner recovery, prevent duplicate handoffs, and finish schedule only after every part',async()=>{
 const db=new PGlite(),actor='00000000-0000-4000-8000-000000000001',batch='00000000-0000-4000-8000-000000000002',email='00000000-0000-4000-8000-000000000003',lock='00000000-0000-4000-8000-000000000004',lock2='00000000-0000-4000-8000-000000000005',request='00000000-0000-4000-8000-000000000006',hash='a'.repeat(64);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create table public.ruoli(id uuid primary key,amministratore_workspace boolean);create table public.utenti(id uuid primary key,ruolo_id uuid,attivo boolean);insert into ruoli values('${actor}',true);insert into utenti values('${actor}','${actor}',true);`);
  for(const path of ['20261107184049_commercial_report_delivery.sql','20261111202716_commercial_report_late_delivery.sql','20261112071500_commercial_report_authorized_resend.sql','20261112075000_commercial_report_multipart.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+path,import.meta.url),'utf8'));
  await db.exec(`insert into commercial_report_settings(singleton,owner_id,enabled,policy_hash,trigger_id,token_encrypted,delivery_day,next_delivery_day) values(true,'${actor}',true,'policy','agtch_fixture','fixture',10,2);
   insert into commercial_report_batches(id,period,owner_id,policy_hash,manifest,recipients_hash,status) values('${batch}','2026-10-01','${actor}','policy','[]','fixture','queued');
   update commercial_report_settings set schedule_transition_batch_id='${batch}';
   insert into commercial_report_emails(id,batch_id,delivery_key,recipient,subject,body,artifact_keys,status,claimed_at,worker_id,lock_token) values('${email}','${batch}','aggregate','central@example.test','report','report','["a","b"]','uncertain',now()-interval '11 minutes','worker','${lock}');`);
  const claim=(part,key,token=lock)=>db.query('select commercial_report_claim_part($1,$2,$3,$4,2,$5,$6::jsonb) as status',[email,'worker',token,part,hash,JSON.stringify([key])]);
  const finish=(part,status,token=lock)=>db.query('select commercial_report_finish_part($1,$2,$3,$4,$5,$6,$7,$8) as completed',[email,'worker',token,part,hash,status,status==='sent'?'receipt-'+part:null,status==='failed'?'rejected':null]);
  assert.equal((await claim(0,'a')).rows[0].status,'claimed');
  assert.equal((await claim(0,'a')).rows[0].status,'requires_review');
  assert.equal((await finish(0,'sent')).rows[0].completed,false);
  assert.equal((await claim(0,'a')).rows[0].status,'already_sent');
  await assert.rejects(()=>claim(1,'a'),/duplicato/);
  assert.equal((await claim(1,'b')).rows[0].status,'claimed');await finish(1,'failed');
  assert.equal((await db.query('select delivery_day from commercial_report_settings')).rows[0].delivery_day,10);
  const claimed=(await db.query('select claimed_at from commercial_report_emails')).rows[0].claimed_at;
  await db.query('select commercial_report_authorize_resend($1,$2,$3,$4,$5,$6,true)',[actor,batch,email,claimed,request,'Owner explicitly authorizes recovery']);
  assert.equal((await db.query('select previous_attempt from commercial_report_resend_history')).rows[0].previous_attempt.parts.length,2);
  await db.exec(`update commercial_report_emails set status='uncertain',worker_id='worker',lock_token='${lock2}',claimed_at=now() where id='${email}'`);
  assert.equal((await claim(0,'a',lock2)).rows[0].status,'already_sent');
  assert.equal((await claim(1,'b',lock2)).rows[0].status,'claimed');
  await assert.rejects(()=>finish(1,'sent',lock),/non accessibile/);
  assert.equal((await finish(1,'sent',lock2)).rows[0].completed,true);
  assert.equal((await db.query('select status from commercial_report_batches')).rows[0].status,'sent');
  assert.equal((await db.query('select delivery_day from commercial_report_settings')).rows[0].delivery_day,2);
  assert.equal((await db.query("select count(*)::int n from commercial_report_email_parts where status='sent'")).rows[0].n,2);
  assert.equal((await db.query("select has_table_privilege('authenticated','commercial_report_email_parts','select') can_read")).rows[0].can_read,false);
 }finally{await db.close();}
});
