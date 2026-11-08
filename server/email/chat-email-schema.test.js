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
test('actual Postgres: chat personal delegation, human-only activation, RLS, revoke and mixed queue', {skip:!PGlite},async()=>{
 const db=new PGlite();
 try {
  await db.exec(bootstrap);
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const file of ['20261108123140_activity_email.sql','20261108123201_chat_email_delegation.sql']) await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  await db.exec(`insert into public.permessi_utente select '${A}',id from public.permessi; insert into public.permessi_utente select '${B}',id from public.permessi;`);
  async function as(role,user,sql,params=[]){
   await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${user}',false);`);
   try{return await db.query(sql,params);}finally{await db.exec('reset role');}
  }
  const prepare=async(key,user=A)=>(await as('authenticated',user,'select * from public.workspace_prepare_chat_email(\'one@example.test\',\'Subject\',\'Body\',$1)',[key])).rows[0];
  const propose=async(user=A)=>(await as('authenticated',user,'select * from public.workspace_propose_email_delegation()')).rows[0];
  const send=async(row,user=A)=>(await as('authenticated',user,'select * from public.workspace_send_chat_email($1,$2)',[row.id,row.payload_hash])).rows[0];
  const decideDelegation=async(row,confirm,user=A)=>(await as('service_role',user,'select * from public.workspace_decide_email_delegation($1,$2,$3,$4)',[user,row.id,confirm,row.policy_hash])).rows[0];
  const claim=async()=>(await as('service_role',A,"select * from public.workspace_claim_email('fixture')")).rows[0]?.workspace_claim_email;
  let capability=(await as('authenticated',A,'select public.workspace_chat_email_capability()')).rows[0].workspace_chat_email_capability;
  assert.equal(capability.enabled,true);assert.equal(capability.canPrepare,true);assert.equal(capability.canSend,false);
  const first=await prepare('chat_first');assert.equal(first.task_id,null);assert.equal(first.source_kind,'chat');
  assert.equal((await prepare('chat_first')).id,first.id);
  await assert.rejects(send(first),/AI_EMAIL_PERMISSION_REQUIRED/);
  await db.exec("select set_config('test.ai_confirm','true',false)");
  await assert.rejects(send(first),/EMAIL_DELEGATION_REQUIRED/);
  for(const status of ['queued','sending','accepted']) assert.equal((await as('authenticated',A,'update public.workspace_emails set status=$1 where id=$2 returning id',[status,first.id])).rows.length,0);
  await assert.rejects(as('authenticated',A,"insert into public.workspace_emails(source_kind,recipient,subject,body,idempotency_key) values('chat','a@example.test','Hi','Text','direct_attack')"),/permission denied/);
  assert.equal((await as('authenticated',B,'select * from public.workspace_emails where id=$1',[first.id])).rows.length,0);
  await assert.rejects(send(first,B),/NOT_ACCESSIBLE/);
  await assert.rejects(as('authenticated',A,'select public.workspace_decide_chat_email_human($1,$2,true,$3)',[A,first.id,first.payload_hash]),/permission denied/);
  const delegation=await propose();assert.equal(delegation.status,'proposed');assert.equal(delegation.policy_version,'chat-email-v1');assert.equal(delegation.policy.bulk,false);
  assert.equal((await propose()).id,delegation.id);
  assert.equal((await as('authenticated',B,'select * from public.workspace_email_delegations')).rows.length,0);
  await assert.rejects(as('authenticated',A,"update public.workspace_email_delegations set status='active' where id=$1",[delegation.id]),/permission denied/);
  await assert.rejects(as('authenticated',A,'select public.workspace_decide_email_delegation($1,$2,true,$3)',[A,delegation.id,delegation.policy_hash]),/permission denied/);
  await assert.rejects(as('authenticated',A,'select workspace_email_private.decide_delegation($1,$2,true,$3)',[A,delegation.id,delegation.policy_hash]),/permission denied/);
  await assert.rejects(decideDelegation(delegation,true,B),/NOT_ACCESSIBLE/);
  await assert.rejects(as('service_role',A,'select public.workspace_decide_email_delegation($1,$2,true,$3)',[A,delegation.id,'a'.repeat(64)]),/DELEGATION_CHANGED/);
  const active=await decideDelegation(delegation,true);assert.equal(active.status,'active');assert.equal(active.approved_by,A);assert.equal(active.approval_method,'workspace-human-receipt-v1');
  assert.deepEqual((await decideDelegation(delegation,true)).approved_at,active.approved_at);
  // No Attivita module is required for chat-only operations.
  await db.exec(`create or replace function public.workspace_access_context() returns jsonb language sql stable as $$select '{"module_levels":{}}'::jsonb$$;`);
  const queued=await send(first);assert.equal(queued.status,'queued');assert.equal(queued.delegation_id,delegation.id);assert.equal(queued.delegation_policy_hash,delegation.policy_hash);
  assert.equal((await send(first)).id,first.id);
  await decideDelegation(active,false);assert.equal((await decideDelegation(active,false)).status,'revoked');
  await assert.rejects(decideDelegation(delegation,true),/DELEGATION_CHANGED/);
  assert.equal(await claim(),undefined);
  assert.equal((await as('authenticated',A,'select status from public.workspace_emails where id=$1',[first.id])).rows[0].status,'cancelled');
  // Single-email human review remains possible without any delegation.
  const single=await prepare('chat_single');
  const human=(await as('service_role',A,'select * from public.workspace_decide_chat_email_human($1,$2,true,$3)',[A,single.id,single.payload_hash])).rows[0];
  assert.equal(human.status,'queued');assert.equal(human.delegation_id,null);
  const c=await claim();assert.equal(c.id,single.id);assert.equal(c.status,'sending');
  assert.equal((await as('service_role',A,'select public.workspace_finish_email($1,$2,\'accepted\',\'provider\',null)',[c.id,c.lock_token])).rows[0].workspace_finish_email,true);
  const next=await propose();assert.notEqual(next.id,delegation.id);await decideDelegation(next,true);
  const revokedAI=await prepare('chat_revoke_ai');await send(revokedAI);
  await db.exec("select set_config('test.ai_confirm','false',false)");
  assert.equal(await claim(),undefined);
  assert.equal((await as('authenticated',A,'select status from public.workspace_emails where id=$1',[revokedAI.id])).rows[0].status,'cancelled');
  await db.exec("select set_config('test.ai_confirm','true',false)");
  const revokedPermission=await prepare('chat_revoke_permission');await send(revokedPermission);
  await db.exec(`delete from public.permessi_utente where utente_id='${A}' and permesso_id in(select id from public.permessi where codice='workspace.email.send')`);
  assert.equal((await as('authenticated',A,"select * from public.workspace_emails where source_kind='chat'")).rows.length,0);
  assert.equal(await claim(),undefined);
  // Independent activity queue still works in the expanded schema.
  await db.exec(`create or replace function public.workspace_access_context() returns jsonb language sql stable as $$select '{"module_levels":{"attivita":"scrittura"}}'::jsonb$$;`);
  const activity=(await as('authenticated',A,'select * from public.workspace_propose_activity_email($1,\'task@example.test\',\'Task\',\'Body\',\'mixed_activity\',false)',[T])).rows[0];
  await as('authenticated',A,'select public.workspace_decide_activity_email($1,true,$2)',[activity.id,activity.payload_hash]);
  assert.equal((await claim()).source_kind,'activity');
 } finally {await db.close();}
});
