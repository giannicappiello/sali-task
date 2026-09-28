// Local PostgreSQL/WASM fixtures only. No connection to the public database.
// npm install --prefix artifacts/permission-harness --no-save --package-lock=false @electric-sql/pglite
import { PGlite } from '../artifacts/permission-harness/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const q = async sql => (await db.query(sql)).rows;
await db.exec(`
create role authenticated; create role anon; create schema auth; create schema storage;
create table auth.users(id uuid primary key);
insert into auth.users values('${id(99)}');
create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
create table ordini_testate(id uuid,modulo_ordini text);create table ordini_righe(id uuid,ordine_id uuid);
create function auth.uid() returns uuid language sql stable as $$select '${id(99)}'::uuid$$;
create function workspace_current_profile_id() returns uuid language sql stable as $$select '${id(1)}'::uuid$$;
create function workspace_data_scope() returns jsonb language sql stable as $$select jsonb_build_object('mode',current_setting('test.mode'),'department_ids','[]'::jsonb)$$;
create function workspace_current_customer_codes() returns text[] language sql stable as $$select case when current_setting('test.mode')='cliente' then array['A','B'] else '{}'::text[] end$$;
create function crm_has_module_level(text,text) returns boolean language sql stable as $$select current_setting('test.read')='yes'$$;
create table crm_activities(id uuid);
create table crm_accounts(id uuid primary key,codice_cliente_mexal text);
create table utenti_reparti(utente_id uuid,reparto_id uuid); create table reparti(id uuid,attivo boolean);
create table v4_progetti(id uuid primary key default gen_random_uuid(),crm_customer_key text,crm_tipo text,creato_da uuid,titolo text);
create table v4_fasi_progetto(id uuid primary key default gen_random_uuid(),progetto_id uuid,crm_customer_key text,crm_tipo text,creato_da uuid,assegnato_a uuid,reparto_id uuid,stato text,titolo text,bloccante_id uuid,completato_at timestamptz,completato_da uuid,modificato_da uuid,updated_at timestamptz);
create table v4_progetto_reparti(progetto_id uuid,reparto_id uuid);
create table v4_progetto_prodotti(progetto_id uuid);
create table v4_fase_reparti(fase_id uuid,reparto_id uuid);
create table v4_fase_prodotti(fase_id uuid);
create table crm_workspace_costs(id uuid default gen_random_uuid(),phase_id uuid,amount numeric);
create table v4_commenti(entity_type text,entity_id uuid,creato_da uuid,testo text);
create table v4_allegati(entity_type text,entity_id uuid,caricato_da uuid,file_path text);
create table v4_audit_log(entity_type text,entity_id uuid,azione text,dettagli jsonb,user_id uuid references auth.users(id));
create table storage.objects(bucket_id text,name text);
grant usage on schema public,auth,storage to authenticated,anon;
grant all on all tables in schema public,storage to authenticated;
set test.mode='cliente'; set test.read='yes';
`);
const baseline = await readFile(new URL('../supabase/migrations/20260915190000_project_crm_competencies.sql', import.meta.url), 'utf8');
await db.exec(baseline.slice(baseline.indexOf('create or replace function public.workspace_direct_phase_ids()'), baseline.indexOf('create or replace function public.workspace_activity_catalog')));
// Deliberately broad permissive baseline: new restrictive policies must still prevent bypass.
for (const table of ['v4_progetti','v4_fasi_progetto','v4_progetto_reparti','v4_progetto_prodotti','v4_fase_reparti','v4_fase_prodotti','crm_workspace_costs','v4_commenti','v4_allegati','storage.objects']) {
  await db.exec(`alter table ${table} enable row level security; create policy fixture_base on ${table} for all to authenticated using(true) with check(true);`);
}
await db.exec(await readFile(new URL('../supabase/migrations/20260928150000_linked_customer_record_permissions.sql', import.meta.url), 'utf8'));
await db.exec(`
insert into crm_accounts values('${id(30)}','B');
insert into v4_progetti values('${id(10)}','mexal:A','conto_terzi',null,'A'),('${id(11)}','crm:${id(30)}','conto_terzi',null,'B'),('${id(12)}','mexal:C','conto_terzi','${id(1)}','C');
insert into v4_fasi_progetto(id,progetto_id,crm_customer_key,crm_tipo,stato,titolo,creato_da) values
('${id(20)}','${id(10)}',null,'conto_terzi','da_evadere','A',null),
('${id(21)}','${id(11)}',null,'conto_terzi','da_evadere','B',null),
('${id(22)}',null,'mexal:C','conto_terzi','da_evadere','C','${id(1)}'),
('${id(23)}',null,'mexal:A','conto_terzi','da_evadere','Standalone',null),
('${id(24)}','${id(12)}','mexal:A','conto_terzi','da_evadere','Parent C wins',null);
insert into crm_workspace_costs values('${id(50)}','${id(20)}',100);
set test.mode='tutti';
insert into ordini_testate values('${id(60)}','private');
insert into ordini_righe values('${id(61)}','${id(60)}');
create function fixture_order_confirm() returns void language sql security definer as $$update ordini_testate set modulo_ordini='private' where id='${id(60)}'$$;
set test.mode='cliente';
set role authenticated;
`);
await assert.rejects(q(`insert into ordini_testate values('${id(62)}','private')`));
await assert.rejects(q(`update ordini_testate set modulo_ordini='prof' where id='${id(60)}'`));
await assert.rejects(q(`delete from ordini_testate where id='${id(60)}'`));
await assert.rejects(q(`insert into ordini_righe values('${id(63)}','${id(60)}')`));
await assert.rejects(q(`update ordini_righe set ordine_id='${id(60)}' where id='${id(61)}'`));
await assert.rejects(q(`delete from ordini_righe where id='${id(61)}'`));
await assert.rejects(q('select fixture_order_confirm()'));
assert.deepEqual((await q('select titolo from v4_progetti order by titolo')).map(r=>r.titolo),['A','B']);
assert.deepEqual((await q('select titolo from v4_fasi_progetto order by titolo')).map(r=>r.titolo),['A','B','Standalone']);
for (const table of ['v4_progetti','v4_fasi_progetto','crm_workspace_costs']) {
  assert.equal((await q(`delete from ${table} returning *`)).length,0);
}
assert.equal((await q(`update v4_fasi_progetto set titolo='HACK' returning *`)).length,0);
assert.equal((await q(`update crm_workspace_costs set amount=999 returning *`)).length,0);
await assert.rejects(q(`insert into crm_workspace_costs(phase_id,amount) values('${id(20)}',10)`));
await assert.rejects(q(`insert into v4_progetti(titolo) values('HACK')`));
await q(`select workspace_customer_task_status('${id(20)}','in_lavorazione')`);
assert.equal((await q(`select stato from v4_fasi_progetto where id='${id(20)}'`))[0].stato,'in_lavorazione');
await assert.rejects(q(`select workspace_customer_task_status('${id(22)}','evaso')`));
await assert.rejects(q(`select workspace_customer_task_status('${id(20)}','invalid')`));
await db.exec(`reset role; update v4_fasi_progetto set bloccante_id='${id(21)}' where id='${id(20)}'; set role authenticated;`);
await assert.rejects(q(`select workspace_customer_task_status('${id(20)}','evaso')`));
await q(`select workspace_customer_task_status('${id(21)}','evaso')`);
await q(`select workspace_customer_task_status('${id(20)}','evaso')`);
assert.ok((await q(`select completato_at from v4_fasi_progetto where id='${id(20)}'`))[0].completato_at);
await q(`insert into v4_commenti values('fase_progetto','${id(20)}','${id(99)}','Nota cliente')`);
await assert.rejects(q(`insert into v4_commenti values('fase_progetto','${id(22)}','${id(99)}','HACK')`));
await assert.rejects(q(`insert into v4_commenti values('fase_progetto','${id(20)}','${id(1)}','Forged author')`));
assert.equal((await q(`delete from v4_commenti returning *`)).length,0);
const path=`${id(1)}/fasi/${id(20)}/test.pdf`;
await q(`insert into storage.objects values('allegati','${path}')`);
await q(`insert into v4_allegati values('fase_progetto','${id(20)}','${id(1)}','${path}')`);
await assert.rejects(q(`insert into storage.objects values('allegati','${id(1)}/fasi/${id(22)}/foreign.pdf')`));
await assert.rejects(q(`insert into v4_allegati values('fase_progetto','${id(21)}','${id(1)}','${path}')`));
assert.equal((await q(`update storage.objects set name='changed' returning *`)).length,0);
assert.equal((await q(`delete from storage.objects returning *`)).length,0);
await db.exec(`set test.read='no'`);
assert.equal((await q('select * from v4_progetti')).length,0);
await assert.rejects(q(`select workspace_customer_task_status('${id(20)}','evaso')`));
await db.exec(`set test.read='yes'; set test.mode='tutti'`);
assert.equal((await q('select * from v4_progetti')).length,3);
assert.equal((await q(`update crm_workspace_costs set amount=120 returning *`)).length,1);
assert.equal((await q(`update ordini_testate set modulo_ordini='private' returning *`)).length,1);
assert.equal((await q(`update v4_fasi_progetto set titolo='Internal edit' where id='${id(20)}' returning *`)).length,1);
await db.exec(`reset role; set role anon;`);
await assert.rejects(q(`select workspace_customer_task_status('${id(20)}','evaso')`));
await db.close();
console.log('PASS: PostgreSQL fixture checks — multi-customer read, foreign denial, status, notes, attachments, costs, internal users, anonymous denial.');
