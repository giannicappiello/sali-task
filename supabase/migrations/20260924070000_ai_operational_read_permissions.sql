-- Explicit AI grants still intersect ordinary module permissions.
begin;
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
      ('attivita','prodotti','documenti','beauty_days','ordini_pr','ordini_ph','progremes','ordini_private','human_resources','hr','crm_conto_terzi','crm_b2b','crm_online')
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
