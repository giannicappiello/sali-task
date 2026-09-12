-- Isolated fixtures. The runner installs the candidate functions in pg_temp;
-- no production role, user, customer or permission is changed.
create temporary table ruoli(id uuid, amministratore_workspace boolean, ambito_dati text, ambito_team text);
create temporary table reparti(id uuid, attivo boolean);
create temporary table utenti(id uuid, auth_user_id uuid, ruolo_id uuid, attivo boolean, mexal_agente_id uuid, responsabile_utente_id uuid);
create temporary table utenti_reparti(utente_id uuid, reparto_id uuid);
create temporary table workspace_customer_user_links(user_id uuid, customer_code text);
create temporary table mexal_agenti(id uuid, attivo_mexal boolean, workspace_utente_id uuid, responsabile_utente_id uuid, codice text);
create temporary table integrazioni_utenti(utente_id uuid, enabled boolean, mexal_agente_id uuid);
create temporary table ordini_clienti_cache(codice_cliente text, codice_agente_mexal text, sync_excluded boolean);
create function pg_temp.workspace_commercial_read_all() returns boolean language sql as $$
  select coalesce(current_setting('test.commercial_all',true),'false')='true'
    and not exists(select 1 from pg_temp.workspace_customer_user_links l join pg_temp.utenti u on u.id=l.user_id where u.auth_user_id=auth.uid());
$$;
create function pg_temp.workspace_current_profile_id() returns uuid language sql as $$
 select id from pg_temp.utenti where auth_user_id=auth.uid() and attivo is not false limit 1;
$$;
create function pg_temp.crm_has_module_level(text,text) returns boolean language sql as $$
 select coalesce(current_setting('test.module_access',true),'true')='true';
$$;
create function pg_temp.visible_mexal_agent_codes() returns setof text language sql as $$
 select a.codice from pg_temp.mexal_agenti a where a.id in
 (select value::uuid from jsonb_array_elements_text(pg_temp.workspace_data_scope()->'agent_ids'));
$$;

-- TESTS
insert into pg_temp.ruoli values
 (md5('beauty-role')::uuid,false,'team','associazioni'),
 (md5('manager-role')::uuid,false,'team','gerarchia'),
 (md5('director-role')::uuid,false,'team','reparti'),
 (md5('agent-role')::uuid,false,'propri','associazioni');
insert into pg_temp.reparti values(md5('ph')::uuid,true),(md5('pr')::uuid,true);
insert into pg_temp.utenti
 select md5(n)::uuid,md5(n||'-auth')::uuid,md5(case n when 'beauty' then 'beauty-role'
   when 'manager' then 'manager-role' when 'director' then 'director-role' else 'agent-role' end)::uuid,
   n<>'inactive',md5(n)::uuid,case when n in ('agent','beauty','inactive') then md5('manager')::uuid
     when n='junior' then md5('agent')::uuid else null end
 from unnest(array['beauty','manager','director','agent','junior','peer','outside','inactive']) n;
insert into pg_temp.utenti_reparti select id,md5(case when id=md5('outside')::uuid then 'pr' else 'ph' end)::uuid from pg_temp.utenti;
insert into pg_temp.mexal_agenti select id,attivo,id,responsabile_utente_id,id::text from pg_temp.utenti;
insert into pg_temp.integrazioni_utenti values
 (md5('beauty')::uuid,true,md5('agent')::uuid),
 (md5('beauty')::uuid,false,md5('outside')::uuid),
 (md5('beauty')::uuid,true,md5('inactive')::uuid),
 (md5('agent')::uuid,true,md5('outside')::uuid);

do $test$
declare s jsonb; checks integer:=0;
begin
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',md5('beauty-auth')::uuid::text,true);
 s:=pg_temp.workspace_data_scope();
 if jsonb_array_length(s->'agent_ids')<>2 or not(s->'agent_ids' ? md5('agent')::uuid::text)
   or jsonb_array_length(s->'department_ids')<>0 or jsonb_array_length(s->'user_ids')<>2 then
   raise exception 'Association scope leaks peers/manager/inactive/transitive links: %',s; end if;
 checks:=checks+1;
 if not pg_temp.crm_row_visible(md5('agent')::uuid,md5('ph')::uuid,'crm_b2b')
   or pg_temp.crm_row_visible(md5('peer')::uuid,md5('ph')::uuid,'crm_b2b') then
   raise exception 'CRM ignores explicit owner or grants entire department'; end if;
 checks:=checks+1;
 perform set_config('test.module_access','false',true);
 if pg_temp.crm_row_visible(md5('agent')::uuid,md5('ph')::uuid,'crm_b2b') then raise exception 'Scope bypasses module access'; end if;
 perform set_config('test.module_access','true',true); checks:=checks+1;
 update pg_temp.integrazioni_utenti set enabled=false where utente_id=md5('beauty')::uuid;
 if jsonb_array_length(pg_temp.workspace_data_scope()->'agent_ids')<>1 then raise exception 'Removed association retained'; end if;
 update pg_temp.integrazioni_utenti set enabled=true where utente_id=md5('beauty')::uuid and mexal_agente_id=md5('agent')::uuid;
 checks:=checks+1;
 perform set_config('request.jwt.claim.sub',md5('manager-auth')::uuid::text,true);
 s:=pg_temp.workspace_data_scope();
 if not(s->'user_ids' ? md5('junior')::uuid::text) or s->'user_ids' ? md5('peer')::uuid::text
   or s->'user_ids' ? md5('director')::uuid::text then raise exception 'Hierarchy not limited to descendants: %',s; end if;
 checks:=checks+1;
 update pg_temp.utenti set responsabile_utente_id=null where id in(md5('agent')::uuid,md5('beauty')::uuid);
 update pg_temp.mexal_agenti set responsabile_utente_id=null where workspace_utente_id in(md5('agent')::uuid,md5('beauty')::uuid);
 if jsonb_array_length(pg_temp.workspace_data_scope()->'agent_ids')<>1 then raise exception 'Removed manager retained descendants'; end if;
 checks:=checks+1;
 update pg_temp.utenti set responsabile_utente_id=md5('manager')::uuid where id=md5('agent')::uuid;
 update pg_temp.utenti set responsabile_utente_id=md5('junior')::uuid where id=md5('manager')::uuid;
 s:=pg_temp.workspace_data_scope(); -- cycle manager -> agent -> junior -> manager
 if jsonb_array_length(s->'user_ids')<>4 then raise exception 'Cycle handling failed: %',s; end if;
 checks:=checks+1;
 perform set_config('request.jwt.claim.sub',md5('director-auth')::uuid::text,true);
 s:=pg_temp.workspace_data_scope();
 if not(s->'user_ids' ? md5('peer')::uuid::text) or s->'user_ids' ? md5('inactive')::uuid::text
   or jsonb_array_length(s->'department_ids')<>1 then raise exception 'Department director regression: %',s; end if;
 checks:=checks+1;
 delete from pg_temp.utenti_reparti where utente_id=md5('director')::uuid;
 if jsonb_array_length(pg_temp.workspace_data_scope()->'agent_ids')<>1 then raise exception 'Removed department retained'; end if;
 checks:=checks+1;
 perform set_config('test.commercial_all','true',true);
 s:=pg_temp.workspace_data_scope();
 if s->>'commercial_mode'<>'tutti' or jsonb_array_length(s->'agent_ids')<>1 then raise exception 'Marketing read rule changed operational scope'; end if;
 checks:=checks+1;
 update pg_temp.ruoli set amministratore_workspace=true where id=md5('director-role')::uuid;
 s:=pg_temp.workspace_data_scope();
 if s->>'mode'<>'tutti' or jsonb_array_length(s->'agent_ids')<>7 then raise exception 'Admin regression: %',s; end if;
 checks:=checks+1;
 insert into pg_temp.workspace_customer_user_links values(md5('director')::uuid,'only-customer');
 s:=pg_temp.workspace_data_scope();
 if s->>'mode'<>'cliente' or jsonb_array_length(s->'agent_ids')<>0 then raise exception 'Customer mode bypassed'; end if;
 checks:=checks+1;
 insert into pg_temp.ordini_clienti_cache values('only-customer','agent',false),('excluded','agent',true),('other','agent',false);
 if (select array_agg(x) from pg_temp.crm_visible_canonical_customer_codes() x)<>array['only-customer'] then raise exception 'Customer canonical scope failed'; end if;
 checks:=checks+1;
 delete from pg_temp.workspace_customer_user_links;
 if (select count(*) from pg_temp.crm_visible_canonical_customer_codes())<>2 then raise exception 'Exclusion bypassed by admin'; end if;
 checks:=checks+1;
 perform set_config('test.commercial_all','false',true);
 update pg_temp.utenti set attivo=false where id=md5('director')::uuid;
 if jsonb_array_length(pg_temp.workspace_data_scope()->'agent_ids')<>0 then raise exception 'Inactive user scope retained'; end if;
 checks:=checks+1;
 raise notice '% relationship-scope assertions passed',checks;
end $test$;
