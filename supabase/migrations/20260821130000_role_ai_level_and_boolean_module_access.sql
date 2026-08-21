begin;

-- Il livello operativo dell'Assistente AI appartiene al ruolo.
alter table public.ruoli add column if not exists livello_ai text;
update public.ruoli set livello_ai='conferma' where livello_ai is null;
alter table public.ruoli alter column livello_ai set default 'analisi';
alter table public.ruoli alter column livello_ai set not null;
alter table public.ruoli drop constraint if exists ruoli_livello_ai_check;
alter table public.ruoli add constraint ruoli_livello_ai_check
  check (livello_ai in ('nessuno','analisi','bozza','conferma'));
comment on column public.ruoli.livello_ai is
  'Livello operativo globale dell Assistente AI: nessuno, analisi, bozza o conferma.';

-- Per reparto e utente resta soltanto la decisione Consentito/Bloccato.
-- Le colonne livello precedenti restano temporaneamente per compatibilita e rollback.
alter table public.ai_reparti_moduli
  add column if not exists consentito boolean not null default false;
update public.ai_reparti_moduli
set consentito=(livello<>'nessuno');
comment on column public.ai_reparti_moduli.consentito is
  'Abilita o blocca il modulo dati per l AI del reparto; non definisce il livello operativo.';

alter table public.ai_utenti_moduli
  add column if not exists consentito boolean;
update public.ai_utenti_moduli
set consentito=case
  when livello='eredita' then null
  when livello='nessuno' then false
  else true
end;
comment on column public.ai_utenti_moduli.consentito is
  'Eccezione personale: null eredita dal reparto, true consente, false blocca.';

create or replace function public.workspace_module_enabled_for_user(
  target_user_id uuid,
  target_module text
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  with target as (
    select u.id,u.ruolo_id,u.reparto_id,u.auth_user_id,
      coalesce(r.amministratore_workspace,false) as is_admin,
      coalesce(r.livello_ai,'analisi') as role_ai_level
    from public.utenti u
    left join public.ruoli r on r.id=u.ruolo_id
    where u.id=target_user_id and u.attivo is not false
    limit 1
  ), personal_exception as (
    select e.decisione
    from target t
    join public.workspace_eccezioni_utente e on e.utente_id=t.id
    where e.ambito='modulo' and e.codice=target_module
      and (e.valida_fino_a is null or e.valida_fino_a>now())
    order by e.aggiornata_il desc nulls last
    limit 1
  ), departments as (
    select ur.reparto_id from public.utenti_reparti ur
    join target t on t.id=ur.utente_id where ur.reparto_id is not null
    union
    select t.reparto_id from target t where t.reparto_id is not null
  )
  select coalesce((
    select case
      when t.is_admin then true
      when target_module='assistente_ai' and t.role_ai_level='nessuno' then false
      when (select decisione from personal_exception)='consenti' then true
      when (select decisione from personal_exception)='nega' then false
      when m.attivo is false then false
      when m.area is not null
        and not (m.area=any(public.workspace_area_access_codes(t.auth_user_id))) then false
      when m.sempre_disponibile then true
      when m.assegnabile_reparto then exists (
        select 1 from departments d
        join public.reparti_moduli rm on rm.reparto_id=d.reparto_id
        where rm.modulo=target_module
      )
      when m.provider='progremes' and target_module<>'progremes' then exists (
        select 1 from departments d
        join public.reparti_moduli master_access
          on master_access.reparto_id=d.reparto_id and master_access.modulo='progremes'
        join public.progremes_reparti_moduli prm on prm.reparto_id=d.reparto_id
        join public.progremes_moduli pm on pm.codice=prm.modulo_codice and pm.attivo is true
        where public.workspace_progremes_module_code(prm.modulo_codice)=target_module
      )
      when cardinality(coalesce(m.dipendenze,'{}'::text[]))>0 then not exists (
        select 1 from unnest(m.dipendenze) dependency(module_code)
        where not public.workspace_module_enabled_for_user(target_user_id,dependency.module_code)
      )
      else false
    end
    from target t join public.workspace_moduli m on m.codice=target_module
  ),false)
$$;

revoke all on function public.workspace_module_enabled_for_user(uuid,text) from public,anon;
grant execute on function public.workspace_module_enabled_for_user(uuid,text) to authenticated,service_role;

create or replace function public.admin_ai_effective_access(target_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with caller as (
    select public.workspace_user_is_admin() as allowed
  ), target as (
    select u.id,u.nome,u.cognome,u.email,u.ruolo_id,
      coalesce(r.amministratore_workspace,false) as is_admin,
      coalesce(r.livello_ai,'analisi') as role_ai_level
    from public.utenti u
    left join public.ruoli r on r.id=u.ruolo_id
    cross join caller
    where caller.allowed and u.id=target_user_id and u.attivo is not false
  ), departments as (
    select ur.reparto_id from target t join public.utenti_reparti ur on ur.utente_id=t.id
    union
    select u.reparto_id from target t join public.utenti u on u.id=t.id where u.reparto_id is not null
  ), general as (
    select coalesce(bool_or(p.riconoscimento_immagini),false) as vision,
      coalesce(bool_or(p.dati_interni),true) as internal_data,
      coalesce(bool_or(p.ricerca_web),false) as web_search,
      min(p.limite_richieste_mese) as request_limit,
      min(p.limite_spesa_utente_mese_usd) as user_cost_limit
    from departments d left join public.ai_reparti_capacita p on p.reparto_id=d.reparto_id
  ), module_base as (
    select m.codice,m.nome,m.ordine,
      coalesce(bool_or(p.consentito),false) as department_allowed,
      coalesce(bool_or(p.riconoscimento_immagini),false) as department_vision
    from public.workspace_moduli m
    left join departments d on true
    left join public.ai_reparti_moduli p
      on p.reparto_id=d.reparto_id and p.modulo_codice=m.codice
    where m.attivo and m.codice in
      ('attivita','prodotti','documenti','beauty_days','ordini_pr','ordini_ph','progremes')
    group by m.codice,m.nome,m.ordine
  ), effective as (
    select mb.*,
      o.consentito as override_allowed,
      o.riconoscimento_immagini as override_vision,
      coalesce(rm.livello_accesso,'lettura') as business_level,
      case
        when t.is_admin then true
        when t.role_ai_level='nessuno' then false
        when not public.workspace_module_enabled_for_user(t.id,mb.codice) then false
        else coalesce(o.consentito,mb.department_allowed,false)
      end as effective_allowed,
      case
        when t.is_admin then true
        when t.role_ai_level='nessuno' then false
        when not public.workspace_module_enabled_for_user(t.id,mb.codice) then false
        when not g.vision then false
        when not coalesce(o.consentito,mb.department_allowed,false) then false
        else coalesce(o.riconoscimento_immagini,mb.department_vision,false)
      end as effective_vision
    from module_base mb cross join target t cross join general g
    left join public.ai_utenti_moduli o on o.utente_id=t.id and o.modulo_codice=mb.codice
    left join public.ruoli_moduli rm on rm.ruolo_id=t.ruolo_id and rm.modulo=mb.codice
  )
  select coalesce((
    select jsonb_build_object(
      'user',jsonb_build_object('id',t.id,'name',btrim(concat_ws(' ',t.nome,t.cognome)),
        'email',t.email,'is_admin',t.is_admin,'role_ai_level',case when t.is_admin then 'conferma' else t.role_ai_level end),
      'role_ai_level',case when t.is_admin then 'conferma' else t.role_ai_level end,
      'module_access',case when t.is_admin then true else public.workspace_module_enabled_for_user(t.id,'assistente_ai') end,
      'vision',case when t.is_admin then true else t.role_ai_level<>'nessuno' and g.vision end,
      'internal_data',case when t.is_admin then true else t.role_ai_level<>'nessuno' and g.internal_data end,
      'web_search',case when t.is_admin then true else t.role_ai_level<>'nessuno' and g.web_search end,
      'monthly_request_limit',case when t.is_admin then null else g.request_limit end,
      'monthly_cost_limit_usd',case when t.is_admin then null else g.user_cost_limit end,
      'modules',coalesce((select jsonb_agg(jsonb_build_object(
        'code',e.codice,'name',e.nome,'allowed',e.effective_allowed,'vision',e.effective_vision,
        'business_level',e.business_level,'override_allowed',e.override_allowed,'override_vision',e.override_vision
      ) order by e.ordine,e.nome) from effective e),'[]'::jsonb)
    ) from target t cross join general g
  ),jsonb_build_object('error','Utente non disponibile o operazione non autorizzata.'));
$$;

revoke all on function public.admin_ai_effective_access(uuid) from public,anon;
grant execute on function public.admin_ai_effective_access(uuid) to authenticated,service_role;

create or replace function public.workspace_ai_capabilities()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with me as (
    select u.id,u.reparto_id,u.ruolo_id,
      coalesce(r.amministratore_workspace,false) as is_admin,
      coalesce(r.livello_ai,'analisi') as role_ai_level
    from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false limit 1
  ), departments as (
    select ur.reparto_id from me join public.utenti_reparti ur on ur.utente_id=me.id
    union select reparto_id from me where reparto_id is not null
  ), policies as (
    select p.* from departments d left join public.ai_reparti_capacita p on p.reparto_id=d.reparto_id
  ), module_base as (
    select m.codice,coalesce(bool_or(p.consentito),false) as department_allowed
    from public.workspace_moduli m
    left join departments d on true
    left join public.ai_reparti_moduli p
      on p.reparto_id=d.reparto_id and p.modulo_codice=m.codice
    where m.attivo and m.codice in
      ('attivita','prodotti','documenti','beauty_days','ordini_pr','ordini_ph','progremes')
    group by m.codice
  ), effective_modules as (
    select mb.codice
    from module_base mb cross join me
    left join public.ai_utenti_moduli o on o.utente_id=me.id and o.modulo_codice=mb.codice
    where me.is_admin or (
      me.role_ai_level<>'nessuno'
      and public.workspace_module_enabled_for_user(me.id,mb.codice)
      and coalesce(o.consentito,mb.department_allowed,false)
    )
  ), usage as (
    select coalesce(sum(u.richieste),0)::integer as requests,
      coalesce(sum(u.costo_usd),0)::numeric as cost
    from me left join public.ai_utilizzo_mensile u
      on u.utente_id=me.id and u.mese=date_trunc('month',now())::date
  )
  select jsonb_build_object(
    'role_ai_level',case when me.is_admin then 'conferma' else me.role_ai_level end,
    'module_access',case when me.is_admin then true
      else me.role_ai_level<>'nessuno' and public.workspace_module_enabled_for_user(me.id,'assistente_ai') end,
    'allowed_modules',coalesce((select jsonb_agg(em.codice order by em.codice) from effective_modules em),'[]'::jsonb),
    'internal_data',case when me.is_admin then true else me.role_ai_level<>'nessuno' and coalesce(bool_or(coalesce(policies.dati_interni,true)),true) end,
    'web_search',case when me.is_admin then true else me.role_ai_level<>'nessuno' and coalesce(bool_or(policies.ricerca_web),false) end,
    'orders',case when me.is_admin then true else me.role_ai_level<>'nessuno'
      and coalesce(bool_or(policies.ordini),false)
      and exists(select 1 from effective_modules where codice in ('ordini_pr','ordini_ph')) end,
    'progremes',case when me.is_admin then true else me.role_ai_level<>'nessuno'
      and coalesce(bool_or(policies.progremes),false)
      and exists(select 1 from effective_modules where codice='progremes') end,
    'planning',case when me.is_admin then true else me.role_ai_level in ('bozza','conferma')
      and coalesce(bool_or(policies.pianificazione),false) end,
    'apply_plans',case when me.is_admin then true else me.role_ai_level='conferma'
      and coalesce(bool_or(policies.applicazione_piani),false) end,
    'vision',case when me.is_admin then true else me.role_ai_level<>'nessuno'
      and coalesce(bool_or(policies.riconoscimento_immagini),false) end,
    'monthly_limit',case when me.is_admin then null else min(policies.limite_richieste_mese) end,
    'monthly_requests',max(usage.requests),
    'monthly_cost_limit_usd',case when me.is_admin then null else min(policies.limite_spesa_utente_mese_usd) end,
    'monthly_cost_usd',max(usage.cost),
    'cost_limit_exceeded',case when me.is_admin then false else coalesce(max(usage.cost)>=min(policies.limite_spesa_utente_mese_usd),false) end,
    'daily_document_limit',case when me.is_admin then null else min(policies.limite_documenti_giorno) end,
    'max_document_pages',case when me.is_admin then null else min(policies.massimo_pagine_documento) end,
    'max_operation_cost_usd',case when me.is_admin then null else min(policies.costo_massimo_operazione_usd) end
  )
  from me cross join usage left join policies on true
  group by me.id,me.is_admin,me.role_ai_level;
$$;

revoke all on function public.workspace_ai_capabilities() from public,anon;
grant execute on function public.workspace_ai_capabilities() to authenticated,service_role;

commit;