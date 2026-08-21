begin;

alter table public.ai_reparti_capacita
  add column if not exists riconoscimento_immagini boolean not null default false,
  add column if not exists budget_mensile_reparto_usd numeric(12,4)
    check (budget_mensile_reparto_usd is null or budget_mensile_reparto_usd > 0),
  add column if not exists limite_spesa_utente_mese_usd numeric(12,4)
    check (limite_spesa_utente_mese_usd is null or limite_spesa_utente_mese_usd > 0),
  add column if not exists limite_documenti_giorno integer
    check (limite_documenti_giorno is null or limite_documenti_giorno > 0),
  add column if not exists massimo_pagine_documento integer
    check (massimo_pagine_documento is null or massimo_pagine_documento > 0),
  add column if not exists costo_massimo_operazione_usd numeric(12,4)
    check (costo_massimo_operazione_usd is null or costo_massimo_operazione_usd > 0);

create table if not exists public.ai_reparti_moduli (
  reparto_id uuid not null references public.reparti(id) on delete cascade,
  modulo_codice text not null references public.workspace_moduli(codice) on update cascade on delete cascade,
  livello text not null default 'nessuno'
    check (livello in ('nessuno','analisi','bozza','conferma')),
  riconoscimento_immagini boolean not null default false,
  aggiornato_da uuid references public.utenti(id) on delete set null,
  aggiornato_il timestamptz not null default now(),
  primary key (reparto_id, modulo_codice)
);

create table if not exists public.ai_utenti_moduli (
  utente_id uuid not null references public.utenti(id) on delete cascade,
  modulo_codice text not null references public.workspace_moduli(codice) on update cascade on delete cascade,
  livello text not null default 'eredita'
    check (livello in ('eredita','nessuno','analisi','bozza','conferma')),
  riconoscimento_immagini boolean,
  aggiornato_da uuid references public.utenti(id) on delete set null,
  aggiornato_il timestamptz not null default now(),
  primary key (utente_id, modulo_codice)
);

alter table public.ai_reparti_moduli enable row level security;
alter table public.ai_utenti_moduli enable row level security;

drop policy if exists "users read own AI module policies" on public.ai_reparti_moduli;
create policy "users read own AI module policies"
on public.ai_reparti_moduli for select to authenticated using (
  public.workspace_user_is_admin()
  or reparto_id in (
    select ur.reparto_id from public.utenti u
    join public.utenti_reparti ur on ur.utente_id=u.id
    where u.auth_user_id=auth.uid() and u.attivo is not false
    union
    select u.reparto_id from public.utenti u
    where u.auth_user_id=auth.uid() and u.attivo is not false and u.reparto_id is not null
  )
);

drop policy if exists "admins manage AI module policies" on public.ai_reparti_moduli;
create policy "admins manage AI module policies"
on public.ai_reparti_moduli for all to authenticated
using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());

drop policy if exists "users read own AI module overrides" on public.ai_utenti_moduli;
create policy "users read own AI module overrides"
on public.ai_utenti_moduli for select to authenticated using (
  public.workspace_user_is_admin() or utente_id=public.workspace_current_profile_id()
);

drop policy if exists "admins manage AI module overrides" on public.ai_utenti_moduli;
create policy "admins manage AI module overrides"
on public.ai_utenti_moduli for all to authenticated
using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());

grant select on public.ai_reparti_moduli, public.ai_utenti_moduli to authenticated;
grant insert, update, delete on public.ai_reparti_moduli, public.ai_utenti_moduli to authenticated;

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
    select u.id, u.nome, u.cognome, u.email, u.ruolo_id,
      coalesce(r.amministratore_workspace,false) as is_admin
    from public.utenti u
    left join public.ruoli r on r.id=u.ruolo_id
    cross join caller
    where caller.allowed and u.id=target_user_id and u.attivo is not false
  ), departments as (
    select ur.reparto_id from target t join public.utenti_reparti ur on ur.utente_id=t.id
    union
    select u.reparto_id from target t join public.utenti u on u.id=t.id where u.reparto_id is not null
  ), general as (
    select
      coalesce(bool_or(p.riconoscimento_immagini),false) as vision,
      coalesce(bool_or(p.dati_interni),true) as internal_data,
      coalesce(bool_or(p.ricerca_web),false) as web_search,
      min(p.limite_richieste_mese) as request_limit,
      min(p.limite_spesa_utente_mese_usd) as user_cost_limit
    from departments d left join public.ai_reparti_capacita p on p.reparto_id=d.reparto_id
  ), module_base as (
    select m.codice, m.nome, m.ordine,
      max(case coalesce(p.livello,'nessuno') when 'conferma' then 3 when 'bozza' then 2 when 'analisi' then 1 else 0 end) as base_rank,
      coalesce(bool_or(p.riconoscimento_immagini),false) as base_vision
    from public.workspace_moduli m
    left join departments d on true
    left join public.ai_reparti_moduli p on p.reparto_id=d.reparto_id and p.modulo_codice=m.codice
    where m.attivo and m.codice in ('attivita','prodotti','documenti','beauty_days','ordini_pr','ordini_ph','progremes')
    group by m.codice,m.nome,m.ordine
  ), effective as (
    select mb.*,
      coalesce(o.livello,'eredita') as override_level,
      o.riconoscimento_immagini as override_vision,
      coalesce(rm.livello_accesso,'lettura') as business_level,
      case
        when t.is_admin then 'conferma'
        when not public.workspace_module_enabled_for_user(t.id,mb.codice) then 'nessuno'
        when o.livello is not null and o.livello<>'eredita' then o.livello
        when mb.base_rank=3 then 'conferma'
        when mb.base_rank=2 then 'bozza'
        when mb.base_rank=1 then 'analisi'
        else 'nessuno'
      end as effective_level,
      case
        when t.is_admin then true
        when not public.workspace_module_enabled_for_user(t.id,mb.codice) then false
        when not g.vision then false
        else coalesce(o.riconoscimento_immagini,mb.base_vision,false)
      end as effective_vision
    from module_base mb cross join target t cross join general g
    left join public.ai_utenti_moduli o on o.utente_id=t.id and o.modulo_codice=mb.codice
    left join public.utenti u on u.id=t.id
    left join public.ruoli_moduli rm on rm.ruolo_id=u.ruolo_id and rm.modulo=mb.codice
  ), normalized as (
    select *,
      case
        when effective_level in ('bozza','conferma') and business_level='lettura' then 'analisi'
        else effective_level
      end as permitted_level
    from effective
  )
  select coalesce((
    select jsonb_build_object(
      'user',jsonb_build_object('id',t.id,'name',btrim(concat_ws(' ',t.nome,t.cognome)),'email',t.email,'is_admin',t.is_admin),
      'module_access',case when t.is_admin then true else public.workspace_module_enabled_for_user(t.id,'assistente_ai') end,
      'vision',case when t.is_admin then true else g.vision end,
      'internal_data',case when t.is_admin then true else g.internal_data end,
      'web_search',case when t.is_admin then true else g.web_search end,
      'monthly_request_limit',case when t.is_admin then null else g.request_limit end,
      'monthly_cost_limit_usd',case when t.is_admin then null else g.user_cost_limit end,
      'modules',coalesce((select jsonb_agg(jsonb_build_object(
        'code',n.codice,'name',n.nome,'level',n.permitted_level,'vision',n.effective_vision,
        'business_level',n.business_level,'override_level',n.override_level,'override_vision',n.override_vision
      ) order by n.ordine,n.nome) from normalized n),'[]'::jsonb)
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
set search_path = public
as $$
  with me as (
    select u.id, u.reparto_id, coalesce(r.amministratore_workspace, false) as is_admin
    from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false limit 1
  ), departments as (
    select ur.reparto_id from me join public.utenti_reparti ur on ur.utente_id=me.id
    union select reparto_id from me where reparto_id is not null
  ), policies as (
    select p.* from departments d left join public.ai_reparti_capacita p on p.reparto_id=d.reparto_id
  ), usage as (
    select coalesce(sum(u.richieste),0)::integer as requests,
      coalesce(sum(u.costo_usd),0)::numeric as cost
    from me left join public.ai_utilizzo_mensile u
      on u.utente_id=me.id and u.mese=date_trunc('month',now())::date
  )
  select jsonb_build_object(
    'module_access',case when me.is_admin then true else public.workspace_module_enabled_for_user(me.id,'assistente_ai') end,
    'internal_data',case when me.is_admin then true else coalesce(bool_or(coalesce(policies.dati_interni,true)),true) end,
    'web_search',case when me.is_admin then true else coalesce(bool_or(policies.ricerca_web),false) end,
    'orders',case when me.is_admin then true else coalesce(bool_or(policies.ordini),false) end,
    'progremes',case when me.is_admin then true else coalesce(bool_or(policies.progremes),false) end,
    'planning',case when me.is_admin then true else coalesce(bool_or(policies.pianificazione),false) end,
    'apply_plans',case when me.is_admin then true else coalesce(bool_or(policies.applicazione_piani),false) end,
    'vision',case when me.is_admin then true else coalesce(bool_or(policies.riconoscimento_immagini),false) end,
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
  group by me.id,me.is_admin;
$$;

revoke all on function public.workspace_ai_capabilities() from public,anon;
grant execute on function public.workspace_ai_capabilities() to authenticated,service_role;

commit;
