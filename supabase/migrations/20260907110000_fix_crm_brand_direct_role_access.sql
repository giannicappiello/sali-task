-- Consente l'accesso a CRM BRAND DIRECT quando il modulo e' stato
-- esplicitamente abilitato per il ruolo. L'area CRM e le eventuali
-- eccezioni personali continuano ad avere precedenza.

begin;

create or replace function public.workspace_module_enabled_for_user(target_user_id uuid,target_module text)
returns boolean language sql stable security definer set search_path=public as $$
 with target as (
  select u.id,u.ruolo_id,u.reparto_id,u.auth_user_id,coalesce(r.amministratore_workspace,false) is_admin,
    coalesce(r.livello_ai,'analisi') role_ai_level
  from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
  where u.id=target_user_id and u.attivo is not false limit 1
 ), exception as (
  select e.decisione from target t join public.workspace_eccezioni_utente e on e.utente_id=t.id
  where e.ambito='modulo' and e.codice=target_module and (e.valida_fino_a is null or e.valida_fino_a>now()) limit 1
 ), departments as (
  select ur.reparto_id from public.utenti_reparti ur join target t on t.id=ur.utente_id where ur.reparto_id is not null
  union select t.reparto_id from target t where t.reparto_id is not null
 )
 select coalesce((select case
  when t.is_admin then true
  when target_module in ('assistente_ai','crm_ai') and t.role_ai_level='nessuno' then false
  when (select decisione from exception)='consenti' then true
  when (select decisione from exception)='nega' then false
  when not m.attivo then false
  when m.area is not null and not (m.area=any(public.workspace_area_access_codes(t.auth_user_id))) then false
  when target_module='crm_brand_direct' and exists(
    select 1 from public.ruoli_moduli role_module
    where role_module.ruolo_id=t.ruolo_id and role_module.modulo=target_module
  ) then true
  when m.sempre_disponibile then true
  when cardinality(coalesce(m.dipendenze_alternative,'{}'))>0 then exists(
    select 1 from unnest(m.dipendenze_alternative) d(code)
    where public.workspace_module_enabled_for_user(target_user_id,d.code))
  when m.assegnabile_reparto then exists(select 1 from departments d join public.reparti_moduli rm on rm.reparto_id=d.reparto_id where rm.modulo=target_module)
  when m.provider='progremes' and target_module<>'progremes' then exists(
    select 1 from departments d join public.reparti_moduli ma on ma.reparto_id=d.reparto_id and ma.modulo='progremes'
    join public.progremes_reparti_moduli prm on prm.reparto_id=d.reparto_id
    join public.progremes_moduli pm on pm.codice=prm.modulo_codice and pm.attivo
    where public.workspace_progremes_module_code(prm.modulo_codice)=target_module)
  when cardinality(coalesce(m.dipendenze,'{}'))>0 then not exists(
    select 1 from unnest(m.dipendenze) d(code) where not public.workspace_module_enabled_for_user(target_user_id,d.code))
  else false end from target t join public.workspace_moduli m on m.codice=target_module),false)
$$;

revoke all on function public.workspace_module_enabled_for_user(uuid,text) from public,anon;
grant execute on function public.workspace_module_enabled_for_user(uuid,text) to authenticated,service_role;

commit;
