-- Independent DIRECT channels. No customer, project, task or assignment is rewritten.
begin;

update public.workspace_moduli
set assegnabile_reparto=true, configurabile_ruolo=true, sempre_disponibile=false,
    dipendenze='{}', dipendenze_alternative='{}', aggiornato_il=now()
where codice in ('crm_brand_direct','crm_b2b','crm_online');

-- Navigation container only: it follows available children, never enables them.
update public.workspace_moduli
set assegnabile_reparto=false, configurabile_ruolo=false, sempre_disponibile=false,
    dipendenze='{}', dipendenze_alternative=array['crm_brand_direct','crm_b2b','crm_online'],
    aggiornato_il=now()
where codice='crm_direct';

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
  -- Online submodules cannot reopen an excluded Online channel.
  when target_module in ('crm_online_ecommerce','crm_online_mailing','crm_online_amazon','crm_online_adv')
    and not public.workspace_module_enabled_for_user(target_user_id,'crm_online') then false
  when target_module in ('assistente_ai','crm_ai') and t.role_ai_level='nessuno' then false
  when (select decisione from exception)='consenti' then true
  when (select decisione from exception)='nega' then false
  when not m.attivo then false
  when m.area is not null and not (m.area=any(public.workspace_area_access_codes(t.auth_user_id))) then false
  -- A role sets the operational level; it never grants a DIRECT channel.
  when target_module in ('crm_brand_direct','crm_b2b','crm_online') then exists(
    select 1 from departments d join public.reparti_moduli rm on rm.reparto_id=d.reparto_id
    where rm.modulo=target_module)
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

-- The access inspector uses the same decision as RLS and the login context.
create or replace function public.workspace_inspect_module_access(target_user_id uuid)
returns table(codice text, allowed boolean, level text, reason text)
language plpgsql stable security definer set search_path=public as $$
begin
  if not coalesce(public.workspace_user_is_admin(),false) then
    raise exception 'Operazione riservata all''amministratore Workspace.' using errcode='42501';
  end if;
  return query
  select m.codice, a.enabled,
    case when not a.enabled then 'nessuno'
      when coalesce(r.amministratore_workspace,false) then 'amministrazione'
      else coalesce(e.livello_accesso,rm.livello_accesso,r.livello_accesso,'lettura') end,
    case when u.attivo is false then 'Utente disattivato'
      when coalesce(r.amministratore_workspace,false) then 'Accesso completo amministratore'
      when m.codice in ('crm_online_ecommerce','crm_online_mailing','crm_online_amazon','crm_online_adv')
        and not public.workspace_module_enabled_for_user(u.id,'crm_online')
        then 'Canale CRM Online non autorizzato'
      when e.decisione is not null then 'Eccezione personale: ' || e.decisione
      when not m.attivo then 'Modulo disattivato'
      when m.area is not null and not (m.area=any(public.workspace_area_access_codes(u.auth_user_id)))
        then 'Area ' || m.area || ' non autorizzata'
      when a.enabled and cardinality(coalesce(m.dipendenze_alternative,'{}'))>0
        then 'Contenitore visibile tramite i moduli autorizzati'
      when a.enabled and m.sempre_disponibile then 'Modulo sempre disponibile'
      when a.enabled then 'Modulo autorizzato; operatività dal ruolo'
      else 'Modulo non autorizzato dalle regole effettive' end
  from public.utenti u
  left join public.ruoli r on r.id=u.ruolo_id
  cross join public.workspace_moduli m
  left join public.ruoli_moduli rm on rm.ruolo_id=u.ruolo_id and rm.modulo=m.codice
  left join public.workspace_eccezioni_utente e on e.utente_id=u.id and e.ambito='modulo'
    and e.codice=m.codice and (e.valida_fino_a is null or e.valida_fino_a>now())
  cross join lateral (select public.workspace_module_enabled_for_user(u.id,m.codice) as enabled) a
  where u.id=target_user_id
  order by m.ordine,m.codice;
end;
$$;
revoke all on function public.workspace_inspect_module_access(uuid) from public,anon;
grant execute on function public.workspace_inspect_module_access(uuid) to authenticated,service_role;

notify pgrst,'reload schema';
commit;

