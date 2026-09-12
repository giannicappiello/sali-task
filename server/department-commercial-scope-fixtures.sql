-- Run after the migration in a transaction that is rolled back.
-- Test the real function body against isolated temporary data, not production users.
create temporary table ruoli(id uuid, amministratore_workspace boolean, ambito_dati text);
create temporary table reparti(id uuid, attivo boolean);
create temporary table utenti(id uuid, auth_user_id uuid, ruolo_id uuid, attivo boolean,
  mexal_agente_id uuid, reparto_id uuid);
create temporary table utenti_reparti(utente_id uuid, reparto_id uuid);
create temporary table workspace_customer_user_links(user_id uuid, customer_code text);
create temporary table mexal_agenti(id uuid, attivo_mexal boolean, workspace_utente_id uuid, responsabile_utente_id uuid);
create temporary table integrazioni_utenti(utente_id uuid, enabled boolean, mexal_agente_id uuid);

do $test$
declare definition text; t text; s jsonb;
begin
  definition := pg_get_functiondef('public.workspace_data_scope()'::regprocedure);
  foreach t in array array['workspace_data_scope', 'workspace_customer_user_links',
    'integrazioni_utenti','utenti_reparti','mexal_agenti','utenti','ruoli','reparti'] loop
    definition := replace(definition, 'public.' || t, 'pg_temp.' || t);
  end loop;
  execute definition;
  insert into pg_temp.ruoli values (md5('team')::uuid,false,'team');
  insert into pg_temp.reparti values (md5('a')::uuid,true),(md5('b')::uuid,true),(md5('outside')::uuid,true);
  insert into pg_temp.utenti
    select md5(name)::uuid, case when name='director' then auth.uid() else md5(name || '-auth')::uuid end,
      md5('team')::uuid, name <> 'inactive', null, md5('a')::uuid
    from unnest(array['director','agent-a','agent-b','agent-i','outside','inactive','legacy']) name;
  insert into pg_temp.utenti_reparti values
    (md5('director')::uuid,md5('a')::uuid),(md5('director')::uuid,md5('b')::uuid),
    (md5('agent-a')::uuid,md5('a')::uuid),(md5('agent-b')::uuid,md5('b')::uuid),
    (md5('agent-i')::uuid,md5('b')::uuid),(md5('inactive')::uuid,md5('a')::uuid),
    (md5('outside')::uuid,md5('outside')::uuid);
  insert into pg_temp.mexal_agenti
    select md5(name)::uuid, name <> 'disabled', md5(name)::uuid, null
    from unnest(array['agent-a','outside','inactive','legacy','disabled']) name;
  insert into pg_temp.mexal_agenti values
    (md5('agent-b')::uuid,true,null,null),(md5('agent-i')::uuid,true,null,null);
  update pg_temp.utenti set mexal_agente_id=md5('agent-b')::uuid where id=md5('agent-b')::uuid;
  insert into pg_temp.integrazioni_utenti values
    (md5('agent-i')::uuid,true,md5('agent-i')::uuid),
    (md5('agent-i')::uuid,true,md5('agent-a')::uuid),
    (md5('agent-i')::uuid,false,md5('outside')::uuid),
    (md5('agent-i')::uuid,true,md5('disabled')::uuid);
  s := pg_temp.workspace_data_scope();
  if jsonb_array_length(s->'agent_ids') <> 3 then raise exception 'Team scope mappings/active filters failed: %',s; end if;
  if s->'agent_ids' ? md5('outside')::uuid::text
    or s->'agent_ids' ? md5('inactive')::uuid::text
    or s->'agent_ids' ? md5('legacy')::uuid::text then
    raise exception 'Out-of-department or legacy membership leaked: %',s;
  end if;
  delete from pg_temp.utenti_reparti where utente_id=md5('director')::uuid and reparto_id=md5('b')::uuid;
  s := pg_temp.workspace_data_scope();
  if jsonb_array_length(s->'agent_ids') <> 1 then raise exception 'Removed department still visible: %',s; end if;
  update pg_temp.reparti set attivo=false where id=md5('a')::uuid;
  s := pg_temp.workspace_data_scope();
  if jsonb_array_length(s->'agent_ids') <> 0 then raise exception 'Inactive department still visible: %',s; end if;
  update pg_temp.reparti set attivo=true;
  update pg_temp.ruoli set ambito_dati='propri';
  s := pg_temp.workspace_data_scope();
  if jsonb_array_length(s->'agent_ids') <> 0 then raise exception 'Own scope expanded to department: %',s; end if;
  update pg_temp.ruoli set amministratore_workspace=true;
  s := pg_temp.workspace_data_scope();
  if s->>'mode' <> 'tutti' or jsonb_array_length(s->'agent_ids') <> 6 then raise exception 'Admin regression: %',s; end if;
  insert into pg_temp.workspace_customer_user_links values(md5('director')::uuid,'customer-only');
  s := pg_temp.workspace_data_scope();
  if s->>'mode' <> 'cliente' or jsonb_array_length(s->'agent_ids') <> 0
    or s->>'customer_code' <> 'customer-only' then raise exception 'Customer restriction bypassed: %',s; end if;
  update pg_temp.utenti set attivo=false where id=md5('director')::uuid;
  s := pg_temp.workspace_data_scope();
  if jsonb_array_length(s->'user_ids') <> 0 or jsonb_array_length(s->'agent_ids') <> 0 then
    raise exception 'Inactive user still visible: %',s;
  end if;
end $test$;
