begin;

-- Roles describe operations, departments describe the perimeter. Keep legacy
-- role/area associations for history, but do not turn them into area grants.
create or replace function public.workspace_area_access_codes(target_auth_user_id uuid default auth.uid())
returns text[] language sql stable security definer set search_path=public as $$
 with target as (
   select u.id,u.reparto_id,workspace_user_is_admin(u.auth_user_id) is_admin
   from utenti u where u.auth_user_id=target_auth_user_id and u.attivo is not false
 ), departments as (
   select ur.reparto_id from utenti_reparti ur join target t on t.id=ur.utente_id
   union select reparto_id from target where reparto_id is not null
 )
 select coalesce(array_agg(a.codice order by a.codice),'{}'::text[])
 from workspace_aree a cross join target t
 left join lateral workspace_personal_exception(t.id,'area',a.codice) e on true
 where a.attiva and (t.is_admin or (
   coalesce(e.decisione,'')<>'nega' and (
     e.decisione='consenti'
     or exists(select 1 from workspace_utenti_aree ua where ua.utente_id=t.id and ua.area_codice=a.codice)
     or exists(select 1 from workspace_reparti_aree da join departments d on d.reparto_id=da.reparto_id
       join reparti r on r.id=d.reparto_id and r.attivo is not false where da.area_codice=a.codice)
   )
 ))
$$;

create or replace function public.workspace_operation_codes(target_user_id uuid)
returns text[] language sql stable security definer set search_path=public as $$
 with target as (select id,ruolo_id from utenti where id=target_user_id and attivo is not false),
 inherited as (
   select p.codice from target t join permessi_ruolo pr on pr.ruolo_id=t.ruolo_id join permessi p on p.id=pr.permesso_id
   union select p.codice from target t join permessi_utente pu on pu.utente_id=t.id join permessi p on p.id=pu.permesso_id
   union select e.codice from target t join workspace_eccezioni_utente e on e.utente_id=t.id
     where e.ambito='permesso' and e.decisione='consenti' and (e.valida_fino_a is null or e.valida_fino_a>now())
 )
 select coalesce(array_agg(i.codice order by i.codice),'{}'::text[]) from inherited i
 where not exists(select 1 from workspace_personal_exception(target_user_id,'permesso',i.codice) e where e.decisione='nega')
$$;
revoke all on function public.workspace_operation_codes(uuid) from public,anon,authenticated;
grant execute on function public.workspace_operation_codes(uuid) to service_role;

-- Update the installed implementations without discarding later catalog or
-- customer-scope changes. Abort rather than patching an unexpected definition.
do $$
declare original text; revised text;
begin
 select pg_get_functiondef('public.workspace_access_context()'::regprocedure) into original;
 revised := regexp_replace(original,
   '''permissions'',coalesce\(\([\s\S]*?''department_ids'',',
   '''permissions'',to_jsonb(public.workspace_operation_codes((select id from current_profile))),''department_ids'',');
 if revised=original then raise exception 'Unexpected workspace_access_context definition'; end if;
 execute revised;
 select pg_get_functiondef('public.workspace_screen_permission_for_user(uuid,text,text)'::regprocedure) into original;
 revised := replace(original,
   'when exists(select 1 from permessi_utente pu join permessi p on p.id=pu.permesso_id' || chr(10) ||
   '     where pu.utente_id=t.id and p.codice=permission_code) then true',
   'when permission_code=any(public.workspace_operation_codes(t.id)) then true');
 if revised=original then raise exception 'Unexpected screen permission definition'; end if;
 execute revised;
end $$;

-- A non-administrator's "all" means all data inside the assigned departments.
-- Normalizing the stored scope also fixes legacy SQL consumers of ambito_dati.
create table if not exists public.workspace_access_migration_history (
 migration text not null, entity text not null, entity_id uuid not null,
 previous_value jsonb not null, recorded_at timestamptz not null default now(),
 primary key(migration,entity,entity_id)
);
alter table public.workspace_access_migration_history enable row level security;
revoke all on public.workspace_access_migration_history from public,anon,authenticated;
grant all on public.workspace_access_migration_history to service_role;
insert into workspace_access_migration_history(migration,entity,entity_id,previous_value)
 select '20260912150000','ruoli',id,to_jsonb(r) from ruoli r
 where not coalesce(amministratore_workspace,false) and lower(trim(nome))<>'admin' and ambito_dati='tutti'
 on conflict do nothing;
update ruoli set ambito_dati='team'
 where not coalesce(amministratore_workspace,false) and lower(trim(nome))<>'admin' and ambito_dati='tutti';
create or replace function public.workspace_bound_role_scope()
returns trigger language plpgsql set search_path=public as $$
begin
 if not coalesce(new.amministratore_workspace,false) and lower(trim(new.nome))<>'admin' and new.ambito_dati='tutti' then
   new.ambito_dati:='team';
 end if;
 return new;
end $$;
create trigger workspace_bound_role_scope before insert or update on public.ruoli
 for each row execute function public.workspace_bound_role_scope();

-- One transaction replaces the user's role, ALL departments and exceptions.
-- Preserve surviving exception IDs and creation history instead of deleting them.
create or replace function public.workspace_save_user_access(
 target_user_id uuid, target_role_id uuid, department_ids uuid[], personal_exceptions jsonb, target_active boolean
)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not workspace_user_is_admin() then raise exception 'Operazione riservata agli amministratori' using errcode='42501'; end if;
 if department_ids is null or personal_exceptions is null or jsonb_typeof(personal_exceptions)<>'array' then
   raise exception 'Inviare tutti i reparti e tutte le eccezioni';
 end if;
 perform 1 from utenti where id=target_user_id for update;
 if not found then raise exception 'Utente non trovato'; end if;
 if exists(select 1 from unnest(department_ids) d(id) left join reparti r on r.id=d.id where r.id is null or r.attivo is false) then
   raise exception 'Reparto non valido o disattivato';
 end if;
 update utenti set ruolo_id=target_role_id,reparto_id=null,attivo=target_active where id=target_user_id
   and (ruolo_id is distinct from target_role_id or reparto_id is not null or attivo is distinct from target_active);
 delete from utenti_reparti where utente_id=target_user_id and not(reparto_id=any(department_ids));
 insert into utenti_reparti(utente_id,reparto_id)
   select target_user_id,d.id from (select distinct unnest(department_ids) id) d
   where not exists(select 1 from utenti_reparti ur where ur.utente_id=target_user_id and ur.reparto_id=d.id);
 delete from workspace_eccezioni_utente e where e.utente_id=target_user_id and not exists(
   select 1 from jsonb_array_elements(personal_exceptions) x where x->>'ambito'=e.ambito and x->>'codice'=e.codice);
 insert into workspace_eccezioni_utente(utente_id,ambito,codice,decisione,livello_accesso,motivazione,valida_fino_a,creata_da)
 select target_user_id,x->>'ambito',x->>'codice',x->>'decisione',nullif(x->>'livello_accesso',''),
   nullif(x->>'motivazione',''),nullif(x->>'valida_fino_a','')::timestamptz,workspace_current_profile_id()
 from jsonb_array_elements(personal_exceptions) x
 on conflict(utente_id,ambito,codice) do update set decisione=excluded.decisione,
   livello_accesso=excluded.livello_accesso,motivazione=excluded.motivazione,valida_fino_a=excluded.valida_fino_a,aggiornata_il=now();
end $$;
revoke all on function public.workspace_save_user_access(uuid,uuid,uuid[],jsonb,boolean) from public,anon;
grant execute on function public.workspace_save_user_access(uuid,uuid,uuid[],jsonb,boolean) to authenticated;

-- One canonical department list, with no privileged/hidden primary department.
-- Preserve existing effective memberships while removing the legacy pointer.
insert into workspace_access_migration_history(migration,entity,entity_id,previous_value)
 select '20260912150000','legacy_department',u.id,jsonb_build_object('reparto_id',u.reparto_id)
 from utenti u where u.reparto_id is not null on conflict do nothing;
insert into utenti_reparti(utente_id,reparto_id)
 select u.id,u.reparto_id from utenti u where u.reparto_id is not null
 and not exists(select 1 from utenti_reparti ur where ur.utente_id=u.id and ur.reparto_id=u.reparto_id);
update utenti set reparto_id=null where reparto_id is not null;
alter table utenti add constraint workspace_no_primary_department check(reparto_id is null) not valid;
alter table utenti validate constraint workspace_no_primary_department;

-- Used only by the authenticated administrator Edge Function. NULL means the
-- caller changed personal details/status, not departments; [] means remove all.
create or replace function public.workspace_set_user_organization(
 target_user_id uuid,target_role_id uuid,department_ids uuid[],target_active boolean
)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from utenti where id=target_user_id for update;
 if not found then raise exception 'Utente non trovato'; end if;
 if exists(select 1 from unnest(department_ids) d(id) left join reparti r on r.id=d.id where r.id is null or r.attivo is false) then
   raise exception 'Reparto non valido o disattivato';
 end if;
 update utenti set ruolo_id=target_role_id,reparto_id=null,attivo=target_active where id=target_user_id
   and (ruolo_id is distinct from target_role_id or reparto_id is not null or attivo is distinct from target_active);
 if department_ids is not null then
   delete from utenti_reparti where utente_id=target_user_id and not(reparto_id=any(department_ids));
   insert into utenti_reparti(utente_id,reparto_id) select target_user_id,d.id from (select distinct unnest(department_ids) id) d
     where not exists(select 1 from utenti_reparti ur where ur.utente_id=target_user_id and ur.reparto_id=d.id);
 end if;
end $$;
revoke all on function public.workspace_set_user_organization(uuid,uuid,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.workspace_set_user_organization(uuid,uuid,uuid[],boolean) to service_role;

-- Exact, user-authorized correction: no other user's effective memberships change.
do $$
declare target uuid := '31739ca0-a3cc-47ee-8e63-ddcaaacabb34';
 intended uuid[] := array['44927484-4ac6-4acf-b3dd-a6b4296914af','05e7a5d0-d6a6-462c-80e2-d4d1e833298c','38230df7-927d-4d3f-aa29-d461e8bbca21']::uuid[];
begin
 if exists(select 1 from utenti where id=target and auth_user_id='de481afc-d36d-41e9-b3be-9a4c97409d85' and lower(cognome)='merino') then
   if (select count(*) from reparti where id=any(intended) and attivo is not false)<>3 then raise exception 'Reparti MERINO non verificati'; end if;
   insert into workspace_access_migration_history(migration,entity,entity_id,previous_value)
     select '20260912150000','utenti',u.id,jsonb_build_object('profile',to_jsonb(u),'departments',
       (select jsonb_agg(to_jsonb(ur)) from utenti_reparti ur where ur.utente_id=u.id)) from utenti u where u.id=target on conflict do nothing;
   update utenti set ruolo_id='5e692abe-c116-410e-a080-000228d4f1eb',reparto_id=null where id=target;
   delete from utenti_reparti where utente_id=target and not(reparto_id=any(intended));
   insert into utenti_reparti(utente_id,reparto_id) select target,d.id from unnest(intended) d(id)
     where not exists(select 1 from utenti_reparti ur where ur.utente_id=target and ur.reparto_id=d.id);
 end if;
end $$;

-- Only a version counter is broadcast: never profiles, departments or exceptions.
create table public.workspace_access_revision (
 id boolean primary key default true check(id), revision bigint not null default 1
);
insert into workspace_access_revision(id) values(true);
alter table workspace_access_revision enable row level security;
create policy "authenticated read access revision" on workspace_access_revision for select to authenticated using(true);
revoke all on workspace_access_revision from public,anon,authenticated;
grant select on workspace_access_revision to authenticated;
grant all on workspace_access_revision to service_role;
create or replace function public.workspace_touch_access_revision()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 update workspace_access_revision set revision=revision+1 where id;
 return null;
end $$;
do $$
declare table_name text;
begin
 foreach table_name in array array['ruoli','reparti','utenti_reparti','permessi','permessi_ruolo','permessi_utente',
 'workspace_aree','workspace_ruoli_aree','workspace_reparti_aree','workspace_utenti_aree',
 'workspace_eccezioni_utente','workspace_moduli','workspace_schermate','workspace_moduli_schermate',
 'reparti_moduli','ruoli_moduli','progremes_reparti_moduli','workspace_customer_user_links','integrazioni_utenti'] loop
   execute format('create trigger workspace_access_changed after insert or update or delete on public.%I for each statement execute function public.workspace_touch_access_revision()',table_name);
 end loop;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   alter publication supabase_realtime add table public.workspace_access_revision;
 end if;
end $$;
-- Presence updates must NOT invalidate every session.
create trigger workspace_profile_access_changed after update of ruolo_id,reparto_id,attivo,auth_user_id,responsabile_utente_id,mexal_agente_id on utenti
 for each row when (old.ruolo_id is distinct from new.ruolo_id or old.reparto_id is distinct from new.reparto_id
 or old.attivo is distinct from new.attivo or old.auth_user_id is distinct from new.auth_user_id
 or old.responsabile_utente_id is distinct from new.responsabile_utente_id or old.mexal_agente_id is distinct from new.mexal_agente_id)
 execute function workspace_touch_access_revision();
create trigger workspace_profile_access_removed after insert or delete on utenti
 for each statement execute function workspace_touch_access_revision();

-- Atomic read snapshot: a session cannot combine old departments with new grants.
create or replace function public.workspace_session_access()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
   'revision',(select revision from workspace_access_revision where id),
   'profile',(select jsonb_build_object('id',u.id,'auth_user_id',u.auth_user_id,'nome',u.nome,'cognome',u.cognome,
     'email',u.email,'telefono',u.telefono,'avatar_url',u.avatar_url,'attivo',u.attivo,'ultimo_accesso',u.ultimo_accesso,
     'last_seen',u.last_seen,'ruolo_id',u.ruolo_id,'reparto_id',u.reparto_id,'reparti',
     (select jsonb_build_object('id',r.id,'nome',r.nome) from reparti r where r.id=u.reparto_id))
     from utenti u where u.auth_user_id=auth.uid() and u.attivo is not false limit 1),
   'access',workspace_access_context(),'scope',workspace_data_scope(),'areas',workspace_area_access_codes(),
   'module_areas',coalesce((select jsonb_object_agg(codice,area) from workspace_moduli),'{}'::jsonb),
   'screens',coalesce((select jsonb_agg(jsonb_build_object('codice',s.codice,'percorso',s.percorso,'attiva',s.attiva,
     'area',s.area,'metadati',s.metadati)) from workspace_schermate s where s.attiva),'[]'::jsonb),
   'screen_levels',coalesce((select jsonb_object_agg(s.codice,workspace_screen_level_for_user(workspace_current_profile_id(),s.codice))
     from workspace_schermate s where s.attiva),'{}'::jsonb),
   'links',coalesce((select jsonb_agg(to_jsonb(l) order by l.ordine) from workspace_moduli_schermate l),'[]'::jsonb),
   'departments',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'nome',r.nome)) from reparti r
     where r.id in(select reparto_id from utenti_reparti where utente_id=workspace_current_profile_id()
       union select reparto_id from utenti where id=workspace_current_profile_id())),'[]'::jsonb)
 )
$$;
revoke all on function public.workspace_session_access() from public,anon;
grant execute on function public.workspace_session_access() to authenticated;

create or replace function public.workspace_inspect_screen_access(target_user_id uuid)
returns table(codice text,allowed boolean,level text,reason text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not workspace_user_is_admin() then raise exception 'Operazione riservata agli amministratori' using errcode='42501'; end if;
 return query select s.codice,a.level<>'nessuno',a.level,
   case when u.attivo is false then 'Utente disattivato'
   when not s.attiva then 'Schermata disattivata'
   when workspace_user_is_admin(u.auth_user_id) then 'Amministratore Workspace'
   when s.metadati->>'admin_only'='true' then 'Riservata agli amministratori'
   when e.decisione is not null then 'Eccezione personale: '||e.decisione
   when s.area=any(workspace_area_access_codes(u.auth_user_id)) then 'Area autorizzata: '||s.area||' (indipendente dal modulo)'
   when a.level<>'nessuno' then 'Modulo collegato autorizzato'
   else 'Nessuna area, eccezione o modulo autorizzato' end
 from utenti u cross join workspace_schermate s
 cross join lateral (select workspace_screen_level_for_user(u.id,s.codice) level) a
 left join lateral workspace_personal_exception(u.id,'schermata',s.codice) e on true
 where u.id=target_user_id order by s.ordine,s.codice;
end $$;
revoke all on function public.workspace_inspect_screen_access(uuid) from public,anon;
grant execute on function public.workspace_inspect_screen_access(uuid) to authenticated;

create or replace function public.workspace_inspect_area_access(target_user_id uuid)
returns table(codice text,allowed boolean,reason text)
language plpgsql stable security definer set search_path=public as $$
begin
 if not workspace_user_is_admin() then raise exception 'Operazione riservata agli amministratori' using errcode='42501'; end if;
 return query select a.codice,a.codice=any(workspace_area_access_codes(u.auth_user_id)),
   case when u.attivo is false then 'Utente disattivato' when not a.attiva then 'Area disattivata'
   when workspace_user_is_admin(u.auth_user_id) then 'Amministratore Workspace'
   when e.decisione is not null then 'Eccezione personale: '||e.decisione
   when a.codice=any(workspace_area_access_codes(u.auth_user_id)) then 'Reparti di appartenenza o assegnazione individuale'
   else 'Area non assegnata ai reparti dell''utente' end
 from utenti u cross join workspace_aree a
 left join lateral workspace_personal_exception(u.id,'area',a.codice) e on true
 where u.id=target_user_id order by a.ordine,a.codice;
end $$;
revoke all on function public.workspace_inspect_area_access(uuid) from public,anon;
grant execute on function public.workspace_inspect_area_access(uuid) to authenticated;

create or replace function public.workspace_replace_access_rules(target_kind text,target_id uuid,area_codes text[],module_rules jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not workspace_user_is_admin() then raise exception 'Operazione riservata agli amministratori' using errcode='42501'; end if;
 if area_codes is null or jsonb_typeof(module_rules) is distinct from 'object' then raise exception 'Regole incomplete'; end if;
 if target_kind='reparti' then
   perform 1 from reparti where id=target_id for update;
   if not found then raise exception 'Reparto inesistente'; end if;
   delete from workspace_reparti_aree where reparto_id=target_id;
   insert into workspace_reparti_aree(reparto_id,area_codice) select target_id,unnest(area_codes);
   delete from reparti_moduli where reparto_id=target_id;
   insert into reparti_moduli(reparto_id,modulo) select target_id,key from jsonb_each_text(module_rules) where value='abilitato';
 elsif target_kind='profili' then
   perform 1 from ruoli where id=target_id for update;
   if not found then raise exception 'Ruolo inesistente'; end if;
   delete from ruoli_moduli where ruolo_id=target_id;
   insert into ruoli_moduli(ruolo_id,modulo,livello_accesso) select target_id,key,value from jsonb_each_text(module_rules) where value<>'';
 else raise exception 'Tipo regola non valido'; end if;
end $$;
revoke all on function public.workspace_replace_access_rules(text,uuid,text[],jsonb) from public,anon;
grant execute on function public.workspace_replace_access_rules(text,uuid,text[],jsonb) to authenticated;

create or replace function public.workspace_replace_area_access(target_area text,department_ids uuid[],user_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
begin
 if not workspace_user_is_admin() then raise exception 'Operazione riservata agli amministratori' using errcode='42501'; end if;
 if department_ids is null or user_ids is null then raise exception 'Regole incomplete'; end if;
 perform 1 from workspace_aree where codice=target_area for update;
 if not found then raise exception 'Area inesistente'; end if;
 delete from workspace_reparti_aree where area_codice=target_area;
 insert into workspace_reparti_aree(reparto_id,area_codice) select unnest(department_ids),target_area;
 delete from workspace_utenti_aree where area_codice=target_area;
 insert into workspace_utenti_aree(utente_id,area_codice) select unnest(user_ids),target_area;
end $$;
revoke all on function public.workspace_replace_area_access(text,uuid[],uuid[]) from public,anon;
grant execute on function public.workspace_replace_area_access(text,uuid[],uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
