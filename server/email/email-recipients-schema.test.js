import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let PGlite;
try { ({PGlite}=await import('../../.tmp/activity-email-fixture/node_modules/@electric-sql/pglite/dist/index.js')); } catch { /* Optional local fixture engine. */ }
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',T='33333333-3333-4333-8333-333333333333',X='44444444-4444-4444-8444-444444444444';
const bootstrap=`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
grant usage on schema public,auth to authenticated,service_role;
create table public.ruoli(id uuid primary key,amministratore_workspace boolean);
create table public.utenti(id uuid primary key,auth_user_id uuid,ruolo_id uuid references public.ruoli,attivo boolean);
create table public.permessi(id uuid primary key default gen_random_uuid(),codice text unique,descrizione text,modulo text);
create table public.permessi_utente(utente_id uuid,permesso_id uuid);
create table public.permessi_ruolo(ruolo_id uuid,permesso_id uuid);
create table public.workspace_eccezioni_utente(utente_id uuid,ambito text,codice text,decisione text,valida_fino_a timestamptz);
create table public.v4_fasi_progetto(id uuid primary key,titolo text,owner_id uuid,updated_at timestamptz default now());
alter table public.v4_fasi_progetto enable row level security;
create policy task_read on public.v4_fasi_progetto for select to authenticated using(owner_id=auth.uid());
create policy task_write on public.v4_fasi_progetto for update to authenticated using(owner_id=auth.uid());
grant select,update on public.v4_fasi_progetto to authenticated;
grant select on public.v4_fasi_progetto to service_role;
create function public.workspace_current_profile_id() returns uuid language sql stable as $$select auth.uid()$$;
create function public.workspace_user_is_admin() returns boolean language sql stable as $$select false$$;
create function public.workspace_customer_record_scope() returns boolean language sql stable as $$select false$$;
create function public.workspace_access_context() returns jsonb language sql stable as $$select '{"module_levels":{"attivita":"scrittura"}}'::jsonb$$;
create function public.workspace_direct_phase_ids() returns uuid[] language sql stable as $$select coalesce(array_agg(id),'{}'::uuid[]) from public.v4_fasi_progetto where owner_id=auth.uid()$$;
create function public.workspace_ai_capabilities() returns jsonb language sql stable as $$select '{"allowed_modules":["attivita"]}'::jsonb$$;
create function public.second_brain_enabled() returns boolean language sql stable as $$select true$$;
create function public.workspace_ai_can_propose() returns boolean language sql stable as $$select true$$;
create function public.workspace_ai_can_confirm() returns boolean language sql stable as $$select coalesce(current_setting('test.ai_confirm',true),'false')='true'$$;
insert into public.ruoli values('${A}',false);
insert into public.utenti values('${A}','${A}','${A}',true),('${B}','${B}','${A}',true);
insert into public.v4_fasi_progetto(id,titolo,owner_id) values('${T}','Task A','${A}'),('${X}','Task B','${B}');
`;
test('actual Postgres: additive To/CC, legacy hashes, scoped v2 consent and rolling worker safety', {skip:!PGlite},async()=>{
 const db=new PGlite();
 try {
  await db.exec(bootstrap);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const file of ['20261108123140_activity_email.sql','20261108123201_chat_email_delegation.sql']) await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  await db.exec(`insert into public.permessi_utente select '${A}',id from public.permessi; insert into public.permessi_utente select '${B}',id from public.permessi; select set_config('test.ai_confirm','true',false);`);
  async function as(role,user,sql,params=[]){
   await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${user}',false);`);
   try{return await db.query(sql,params);}finally{await db.exec('reset role');}
  }
  const first=async(sql,params=[],role='authenticated',user=A)=>(await as(role,user,sql,params)).rows[0];
  const legacy=async(key)=>first("select * from public.workspace_prepare_chat_email('One@Example.test','Subject','Body',$1)",[key]);
  const prepare=async(key,to=['one@example.test','two@example.test'],cc=['copy@example.test'])=>first('select * from public.workspace_prepare_chat_email_v2($1,$2,\'Subject\',\'Body\',$3)',[to,cc,key]);
  const send=async(row)=>first('select * from public.workspace_send_chat_email($1,$2)',[row.id,row.payload_hash]);
  const propose=async(v=1)=>first(`select * from public.workspace_propose_email_delegation${v===2?'_v2':''}()`);
  const consent=async(row,yes=true)=>first('select * from public.workspace_decide_email_delegation($1,$2,$3,$4)',[A,row.id,yes,row.policy_hash],'service_role');
  const human=async(row)=>first('select * from public.workspace_decide_chat_email_human($1,$2,true,$3)',[A,row.id,row.payload_hash],'service_role');
  const claim=async(v=1)=>{
   const rows=await as('service_role',A,v===1?"select * from public.workspace_claim_email('legacy')":"select * from public.workspace_claim_email_v2('v2',2)");
   return rows.rows[0]?.[v===1?'workspace_claim_email':'workspace_claim_email_v2'];
  };
  const finish=async(row)=>first("select public.workspace_finish_email($1,$2,'accepted','fixture',null)",[row.id,row.lock_token],'service_role');
  const v1=await propose();await consent(v1);
  const historic=await legacy('historic_queued');await send(historic);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261109182211_email_to_cc.sql',import.meta.url),'utf8'));
  const preserved=await first('select * from public.workspace_emails where id=$1',[historic.id]);
  assert.equal(preserved.payload_hash,historic.payload_hash);assert.equal(preserved.recipient,'One@Example.test');assert.equal(preserved.to_recipients,null);assert.equal(preserved.cc_recipients,null);assert.equal(preserved.transport_protocol_version,1);
  assert.equal((await legacy('historic_queued')).id,historic.id);
  await assert.rejects(prepare('historic_queued',['one@example.test'],[]),/IDEMPOTENCY_CONFLICT/);
  const oldClaim=await claim();assert.equal(oldClaim.id,historic.id);await finish(oldClaim);
  assert.equal((await propose()).policy_hash,v1.policy_hash);
  const multi=await prepare('multi_draft');assert.equal(multi.transport_protocol_version,2);assert.deepEqual(multi.to_recipients,['one@example.test','two@example.test']);assert.deepEqual(multi.cc_recipients,['copy@example.test']);
  assert.equal((await prepare('multi_draft',[' ONE@EXAMPLE.TEST ','two@example.test'],['COPY@example.test'])).id,multi.id);
  await assert.rejects(prepare('multi_draft',['one@example.test'],['two@example.test','copy@example.test']),/IDEMPOTENCY_CONFLICT/);
  const changedRole=await prepare('changed_role',['one@example.test'],['two@example.test','copy@example.test']);assert.notEqual(changedRole.payload_hash,multi.payload_hash);
  for(const [to,cc] of [[[],[]],[['group:a@example.test'],[]],[['a(comment)@example.test'],[]],[['a..b@example.test'],[]],[['a@-example.test'],[]],[['é@example.test'],[]],[['a@example.test'],['A@example.test']],[['a@example.test','A@example.test'],[]],[['a@example.test\r\n'],[]],[Array.from({length:11},(_,i)=>`u${i}@example.test`),[]],[['a@example.test'],[null]]]) await assert.rejects(prepare('invalid_request',to,cc),/RECIPIENTS/);
  await assert.rejects(first("select * from public.workspace_prepare_chat_email('one@example.test','Subject','Body','multi_draft')"),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(send(multi),/EMAIL_DELEGATION_REQUIRED/);
  await assert.rejects(first('select * from public.workspace_send_chat_email($1,$2)',[multi.id,multi.payload_hash],'authenticated',B),/NOT_ACCESSIBLE/);
  assert.equal((await as('authenticated',B,'select * from public.workspace_emails where id=$1',[multi.id])).rows.length,0);
  await assert.rejects(first("update public.workspace_emails set cc_recipients='{}' where id=$1 returning *",[multi.id],'service_role'),/IMMUTABLE_EMAIL_PROPOSAL/);
  await assert.rejects(first('select * from public.workspace_claim_email_v2(\'attack\',2)'),/permission denied/);
  // One-off review can authorize the exact v2 payload without altering v1.
  await human(multi);assert.equal(await claim(),undefined);
  const laterLegacy=await legacy('later_legacy');await send(laterLegacy);
  const legacyClaim=await claim();assert.equal(legacyClaim.id,laterLegacy.id);await finish(legacyClaim);
  const multiClaim=await claim(2);assert.equal(multiClaim.id,multi.id);assert.deepEqual(multiClaim.cc_recipients,['copy@example.test']);await finish(multiClaim);
  const v2=await propose(2);assert.equal(v2.policy_version,'chat-email-v2');assert.equal(v2.status,'proposed');assert.equal(v2.policy.max_recipients,10);assert.equal(v2.policy.single_recipient,false);assert.notEqual(v2.policy_hash,v1.policy_hash);
  assert.equal((await propose(2)).id,v2.id);assert.equal((await propose()).id,v1.id);
  await assert.rejects(first('select * from public.workspace_decide_email_delegation($1,$2,true,$3)',[A,v2.id,v2.policy_hash]),/permission denied/);
  await assert.rejects(first('select * from public.workspace_decide_email_delegation($1,$2,true,$3)',[B,v2.id,v2.policy_hash],'service_role'),/NOT_ACCESSIBLE/);
  await assert.rejects(send(changedRole),/DELEGATION_REQUIRED/);
  await assert.rejects(first('select * from public.workspace_decide_email_delegation($1,$2,true,$3)',[A,v2.id,'f'.repeat(64)],'service_role'),/DELEGATION_CHANGED/);
  await consent(v2);const queued=await send(changedRole);assert.equal(queued.delegation_id,v2.id);assert.equal(queued.delegation_policy_version,'chat-email-v2');
  const cap=(await first('select public.workspace_chat_email_capability()')).workspace_chat_email_capability;assert.equal(cap.canSendMultiple,true);assert.equal(cap.delegations.length,2);
  await consent(v2,false);assert.equal(await claim(2),undefined);
  assert.equal((await first('select status from public.workspace_emails where id=$1',[changedRole.id])).status,'cancelled');
  // V1 still authorizes exactly one To, including a v2-encoded single message.
  await assert.rejects(consent(v2),/DELEGATION_CHANGED/);
  const single=await prepare('v2_single',['one@example.test'],[]);assert.equal((await send(single)).delegation_id,v1.id);assert.equal(await claim(),undefined);const singleClaim=await claim(2);await finish(singleClaim);
  // Multi-recipient activity emails retain task/RLS gates and recheck on claim.
  const activity=await first("select * from public.workspace_propose_activity_email_v2($1,$2,$3,'Activity','Body','activity_multi',true)",[T,['one@example.test'],['copy@example.test']]);
  await first('select * from public.workspace_decide_activity_email($1,true,$2)',[activity.id,activity.payload_hash]);
  assert.equal(await claim(),undefined);const activityClaim=await claim(2);assert.equal(activityClaim.id,activity.id);await finish(activityClaim);
  const stale=await first("select * from public.workspace_propose_activity_email_v2($1,$2,$3,'Activity','Body','activity_stale',false)",[T,['one@example.test'],[]]);
  await first('select * from public.workspace_decide_activity_email($1,true,$2)',[stale.id,stale.payload_hash]);
  await db.exec(`update public.v4_fasi_progetto set owner_id='${B}' where id='${T}'`);assert.equal(await claim(2),undefined);
  assert.equal((await first('select status from public.workspace_emails where id=$1',[stale.id],'service_role')).status,'cancelled');
  const revoked=await prepare('permission_revoke',['one@example.test'],[]);await send(revoked);
  await db.exec(`delete from public.permessi_utente where utente_id='${A}' and permesso_id in(select id from public.permessi where codice='workspace.email.send')`);
  await assert.rejects(prepare('no_permission'),/EMAIL_PERMISSION_REQUIRED/);assert.equal(await claim(2),undefined);
  assert.equal((await first('select status from public.workspace_emails where id=$1',[revoked.id],'service_role')).status,'cancelled');
 } finally {await db.close();}
});
