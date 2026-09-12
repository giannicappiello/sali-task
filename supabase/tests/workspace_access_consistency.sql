-- Run after 20260912150000, in a disposable transaction. No data is retained.
begin;
do $$
declare target uuid := '31739ca0-a3cc-47ee-8e63-ddcaaacabb34';
 auth_id uuid := 'de481afc-d36d-41e9-b3be-9a4c97409d85';
 administrator uuid; saved_exceptions jsonb; snapshot jsonb; before_revision bigint;
 role_id uuid; old_exception_id uuid; new_exception_id uuid;
begin
 if not exists(select 1 from utenti where id=target and auth_user_id=auth_id) then
   raise exception 'Test requires the audited MERINO fixture';
 end if;
 perform set_config('request.jwt.claim.sub',auth_id::text,true);
 snapshot:=workspace_session_access();
 if jsonb_array_length(snapshot->'access'->'department_ids')<>3 then raise exception 'Expected only three Field Force departments'; end if;
 if exists(select 1 from utenti where reparto_id is not null) then raise exception 'Legacy primary department remains'; end if;
 if snapshot->'scope'->>'mode'<>'team' then raise exception 'Role must not bypass department data scope'; end if;
 if 'vendite_private'=any(workspace_area_access_codes()) then raise exception 'Old department/role still grants PRIVATE area'; end if;
 if workspace_module_enabled_for_user(target,'integrazioni') then raise exception 'Screen access must not enable the entire module'; end if;
 if workspace_screen_level_for_user(target,'integrazioni.mexal')='nessuno' then raise exception 'Area does not enable Mexal screen'; end if;
 if not workspace_screen_permission_for_user(target,'integrations.sync.products','integrazioni.mexal') then raise exception 'Role operation was lost'; end if;
 if workspace_screen_permission_for_user(target,'integrations.configure','integrazioni.mexal') then raise exception 'Unassigned configure permission leaked'; end if;
 if has_function_privilege('authenticated','workspace_set_user_organization(uuid,uuid,uuid[],boolean)','EXECUTE') then raise exception 'Service RPC exposed to normal users'; end if;
 begin
   perform workspace_save_user_access(target,null,'{}','[]',true);
   raise exception 'Non-admin unexpectedly changed access';
 exception when insufficient_privilege then null; end;
 select u.auth_user_id into administrator from utenti u join ruoli r on r.id=u.ruolo_id
   where u.attivo is not false and r.amministratore_workspace and u.auth_user_id is not null limit 1;
 if administrator is null then raise exception 'No admin fixture'; end if;
 perform set_config('request.jwt.claim.sub',administrator::text,true);
 select ruolo_id into role_id from utenti where id=target;
 select coalesce(jsonb_agg(to_jsonb(e)),'[]') into saved_exceptions from workspace_eccezioni_utente e where e.utente_id=target;
 select id into old_exception_id from workspace_eccezioni_utente where utente_id=target and ambito='schermata' and codice='prodotti';
 select revision into before_revision from workspace_access_revision where id;
 perform workspace_save_user_access(target,role_id,'{}',saved_exceptions,true);
 if exists(select 1 from utenti_reparti where utente_id=target) then raise exception 'Removed departments survived replacement'; end if;
 if 'backoffice_direct'=any(workspace_area_access_codes(auth_id)) then raise exception 'Removed department still grants area'; end if;
 if (select revision from workspace_access_revision where id)<=before_revision then raise exception 'No access change notification'; end if;
 select id into new_exception_id from workspace_eccezioni_utente where utente_id=target and ambito='schermata' and codice='prodotti';
 if old_exception_id is distinct from new_exception_id then raise exception 'Exception creation history was lost'; end if;
 -- A single screen exception must not grant its sibling or whole module.
 insert into workspace_eccezioni_utente(utente_id,ambito,codice,decisione,livello_accesso)
 values(target,'schermata','integrazioni.mexal','consenti','lettura')
 on conflict(utente_id,ambito,codice) do update set decisione='consenti',livello_accesso='lettura',valida_fino_a=null;
 if workspace_screen_level_for_user(target,'integrazioni.mexal')<>'lettura' then raise exception 'Independent screen exception failed'; end if;
 if workspace_module_enabled_for_user(target,'integrazioni') then raise exception 'Screen exception enabled module'; end if;
 if workspace_screen_permission_for_user(target,'integrations.sync.products','integrazioni.mexal') then raise exception 'Read-only exception allowed write'; end if;
 update workspace_eccezioni_utente set decisione='nega' where utente_id=target and ambito='schermata' and codice='integrazioni.mexal';
 if workspace_screen_level_for_user(target,'integrazioni.mexal')<>'nessuno' then raise exception 'Explicit deny ignored'; end if;
 -- Operation revocation applies on the server, including role-inherited codes.
 insert into workspace_eccezioni_utente(utente_id,ambito,codice,decisione) values(target,'permesso','integrations.sync.products','nega')
 on conflict(utente_id,ambito,codice) do update set decisione='nega',valida_fino_a=null;
 if 'integrations.sync.products'=any(workspace_operation_codes(target)) then raise exception 'Role permission overrides personal deny'; end if;
 update utenti set attivo=false where id=target;
 perform set_config('request.jwt.claim.sub',auth_id::text,true);
 if workspace_session_access()->'profile'<>'null'::jsonb then raise exception 'Disabled user has active snapshot'; end if;
 if workspace_screen_level_for_user(target,'prodotti')<>'nessuno' then raise exception 'Disabled user keeps personal exception'; end if;
end $$;
select 'PASS: departments, scope, role operations, independent screens, denials, revocation, history, RPC boundaries' as result;
rollback;
