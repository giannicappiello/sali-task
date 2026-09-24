-- Disposable database only. Permission helpers below deliberately use session settings.
create role anon; create role authenticated; create role service_role;
create table ruoli(id uuid primary key, amministratore_workspace boolean);
create table utenti(id uuid primary key, ruolo_id uuid references ruoli, attivo boolean);
create function workspace_current_profile_id() returns uuid language sql as $$ select '10000000-0000-4000-8000-000000000001'::uuid $$;
create function workspace_user_is_admin() returns boolean language sql as $$ select current_setting('test.admin',true)='true' $$;
create function workspace_ai_can_confirm() returns boolean language sql as $$ select current_setting('test.confirm',true)='true' $$;
create function company_mes_ai_can_write() returns boolean language sql as $$ select false $$;
create function workspace_access_context() returns jsonb language sql as $$ select '{"module_levels":{"prodotti":"scrittura","documenti":"scrittura"}}'::jsonb $$;
create function workspace_ai_capabilities() returns jsonb language sql as $$ select '{"allowed_modules":["prodotti","documenti"]}'::jsonb $$;
create table ai_action_registry(code text primary key,system text,risk_level text,input_schema jsonb,required_permission text,active boolean);
create table ai_action_audit(id uuid primary key,user_id uuid,system text,tool text,status text,payload_summary jsonb,before_snapshot jsonb,result jsonb,confirmed_at timestamptz,executed_at timestamptz);
create table prodotti(id uuid primary key,nome text,descrizione text,mostra_in_app boolean);
create table documenti_workspace(id uuid primary key,titolo text,categoria text,marca text,gamma text,prodotto text,parole_chiave text[],attivo boolean,aggiornato_il timestamptz);
insert into ruoli values('20000000-0000-4000-8000-000000000001',true);
insert into utenti values(workspace_current_profile_id(),'20000000-0000-4000-8000-000000000001',true);
set test.admin='false'; set test.confirm='true';
