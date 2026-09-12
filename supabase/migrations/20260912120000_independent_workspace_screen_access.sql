-- Screen authorization is independent of module authorization. No assignments,
-- areas, roles, business records or module grants are rewritten.
begin;

create or replace function public.workspace_screen_level_for_user(target_user_id uuid, target_screen text)
returns text language sql stable security definer set search_path=public as $$
 with target as (
   select u.id,u.auth_user_id,u.ruolo_id,r.livello_accesso,
     coalesce(r.amministratore_workspace,false) is_admin
   from utenti u left join ruoli r on r.id=u.ruolo_id
   where u.id=target_user_id and u.attivo is not false
 ), exception as (
   select e.decisione,e.livello_accesso from workspace_eccezioni_utente e
   where e.utente_id=target_user_id and e.ambito='schermata' and e.codice=target_screen
     and (e.valida_fino_a is null or e.valida_fino_a>now())
 ), linked as (
   select m.codice,coalesce(rm.livello_accesso,t.livello_accesso,'lettura') level
   from target t join workspace_moduli_schermate l on l.schermata_codice=target_screen
   join workspace_moduli m on m.codice=l.modulo_codice
   left join ruoli_moduli rm on rm.ruolo_id=t.ruolo_id and rm.modulo=m.codice
 )
 select coalesce((select case
   when not s.attiva then 'nessuno'
   when t.is_admin then 'amministrazione'
   when s.metadati->>'admin_only'='true' then 'nessuno'
   when (select decisione from exception)='nega' then 'nessuno'
   when (select decisione from exception)='consenti'
     or s.area=any(workspace_area_access_codes(t.auth_user_id))
     or exists(select 1 from linked l where workspace_module_enabled_for_user(t.id,l.codice))
   then coalesce((select livello_accesso from exception where decisione='consenti'),
     (select l.level from linked l order by case l.level when 'amministrazione' then 3 when 'scrittura' then 2 when 'lettura' then 1 else 0 end desc limit 1),
     t.livello_accesso,'lettura')
   else 'nessuno' end from target t join workspace_schermate s on s.codice=target_screen),'nessuno')
$$;

-- Operations are bounded to registered screen permissions. A screen grant does
-- not grant generic settings/users administration or unrelated integrations.
create or replace function public.workspace_screen_permission_for_user(target_user_id uuid, permission_code text, target_screen text default null)
returns boolean language sql stable security definer set search_path=public as $$
 with target as (
   select u.id,u.ruolo_id,coalesce(r.amministratore_workspace,false) is_admin,
     coalesce(r.livello_accesso,'lettura') role_level
   from utenti u left join ruoli r on r.id=u.ruolo_id
   where u.id=target_user_id and u.attivo is not false
 ), exception as (
   select e.decisione from workspace_eccezioni_utente e
   where e.utente_id=target_user_id and e.ambito='permesso' and e.codice=permission_code
     and (e.valida_fino_a is null or e.valida_fino_a>now())
 ), candidates as (
   select s.codice,workspace_screen_level_for_user(target_user_id,s.codice) level
   from workspace_schermate s
   where s.attiva and (target_screen is null or s.codice=target_screen)
     and (coalesce(s.metadati->'required_permissions','[]'::jsonb) ? permission_code
       or (permission_code='integrations.read' and exists(
         select 1 from workspace_moduli_schermate l where l.schermata_codice=s.codice and l.modulo_codice='integrazioni')))
 ), enough_level as (
   select 1 from candidates c where
     case c.level when 'amministrazione' then 3 when 'scrittura' then 2 when 'lettura' then 1 else 0 end >=
     case when permission_code like '%.configure' or permission_code like '%.manage' or permission_code like '%.delete%' then 3
       when permission_code like '%.write' or permission_code like 'integrations.sync.%' then 2 else 1 end
 )
 select coalesce((select case
   when t.is_admin then true
   when (select decisione from exception)='nega' then false
   when not exists(select 1 from enough_level) then false
   when (select decisione from exception)='consenti' then true
   when permission_code like '%.read' then true
   when exists(select 1 from permessi_utente pu join permessi p on p.id=pu.permesso_id
     where pu.utente_id=t.id and p.codice=permission_code) then true
   when t.role_level='amministrazione' and permission_code not in ('settings.manage','users.manage') then true
   when t.role_level='scrittura' and permission_code like '%.write' then true
   else false end from target t),false)
$$;

revoke all on function public.workspace_screen_level_for_user(uuid,text) from public,anon;
revoke all on function public.workspace_screen_permission_for_user(uuid,text,text) from public,anon,authenticated;
grant execute on function public.workspace_screen_level_for_user(uuid,text) to authenticated,service_role;
grant execute on function public.workspace_screen_permission_for_user(uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
