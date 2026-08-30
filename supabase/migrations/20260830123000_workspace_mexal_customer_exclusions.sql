begin;

-- I clienti esclusi restano nella cache tecnica per preservare ordini, fatture e
-- relazioni storiche, ma non sono piu visibili ne risincronizzabili.
alter table public.ordini_clienti_cache
  add column if not exists sync_excluded boolean not null default false;

create index if not exists ordini_clienti_cache_sync_excluded_idx
  on public.ordini_clienti_cache (sync_excluded, codice_cliente);

create table if not exists public.workspace_mexal_customer_exclusions (
  codice_cliente text primary key
    references public.ordini_clienti_cache(codice_cliente) on delete restrict,
  reason text,
  source_file text,
  snapshot jsonb not null default '{}'::jsonb,
  excluded_at timestamptz not null default now(),
  excluded_by uuid references public.utenti(id) on delete set null,
  constraint workspace_mexal_customer_exclusions_code_check
    check (codice_cliente ~ '^501\.[0-9]{5}$')
);

alter table public.workspace_mexal_customer_exclusions enable row level security;

drop policy if exists "workspace mexal customer exclusions admin read"
  on public.workspace_mexal_customer_exclusions;
create policy "workspace mexal customer exclusions admin read"
on public.workspace_mexal_customer_exclusions for select to authenticated
using (public.workspace_user_is_admin());

revoke all on public.workspace_mexal_customer_exclusions from public, anon, authenticated;
grant select, insert, update on public.workspace_mexal_customer_exclusions to service_role;

create or replace function public.workspace_exclude_mexal_customers(
  p_codes text[],
  p_source_file text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_count integer;
  existing_count integer;
  classified_count integer;
  actor_id uuid := public.workspace_current_profile_id();
begin
  if auth.role() <> 'service_role' then
    raise exception 'Operazione riservata al servizio di amministrazione.' using errcode = '42501';
  end if;

  select count(*) into requested_count
  from (select distinct btrim(code) code from unnest(coalesce(p_codes, '{}'::text[])) code) requested
  where requested.code <> '';

  if requested_count < 1 or requested_count > 5000 then
    raise exception 'Elenco clienti non valido: attesi da 1 a 5000 codici.' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_codes) code
    where btrim(code) !~ '^501\.[0-9]{5}$'
  ) then
    raise exception 'Uno o piu codici cliente non sono validi.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('workspace_mexal_customer_exclusions'));

  select count(*) into existing_count
  from public.ordini_clienti_cache customer
  where customer.codice_cliente in (select distinct btrim(code) from unnest(p_codes) code);
  if existing_count <> requested_count then
    raise exception 'Alcuni clienti richiesti non esistono nella cache Workspace.' using errcode = '22023';
  end if;

  select count(*) into classified_count
  from public.crm_customer_classifications classification
  where classification.codice_cliente in (select distinct btrim(code) from unnest(p_codes) code);
  if classified_count <> requested_count then
    raise exception 'Alcuni clienti richiesti non hanno una classificazione CRM.' using errcode = '22023';
  end if;

  insert into public.workspace_mexal_customer_exclusions (
    codice_cliente, reason, source_file, snapshot, excluded_at, excluded_by
  )
  select
    customer.codice_cliente,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_source_file, '')), ''),
    jsonb_build_object(
      'ragione_sociale', customer.ragione_sociale,
      'attivo_mexal', customer.attivo_mexal,
      'area_crm', classification.area_crm,
      'crm_active', coalesce(status.crm_active, true)
    ),
    now(),
    actor_id
  from public.ordini_clienti_cache customer
  join public.crm_customer_classifications classification
    on classification.codice_cliente = customer.codice_cliente
  left join public.crm_customer_status status
    on status.customer_key = 'mexal:' || customer.codice_cliente
  where customer.codice_cliente in (select distinct btrim(code) from unnest(p_codes) code)
  on conflict (codice_cliente) do update set
    reason = excluded.reason,
    source_file = excluded.source_file,
    excluded_at = excluded.excluded_at,
    excluded_by = excluded.excluded_by;

  insert into public.crm_customer_status (
    customer_key, crm_type, crm_active, changed_at, changed_by, reason, updated_at
  )
  select
    'mexal:' || classification.codice_cliente,
    classification.area_crm,
    false,
    now(),
    actor_id,
    nullif(btrim(coalesce(p_reason, '')), ''),
    now()
  from public.crm_customer_classifications classification
  where classification.codice_cliente in (select distinct btrim(code) from unnest(p_codes) code)
  on conflict (customer_key) do update set
    crm_type = excluded.crm_type,
    crm_active = false,
    changed_at = excluded.changed_at,
    changed_by = excluded.changed_by,
    reason = excluded.reason,
    updated_at = excluded.updated_at;

  update public.ordini_clienti_cache customer
  set attivo_mexal = false,
      sync_excluded = true,
      sincronizzato_il = now(),
      ultimo_sync_mexal = now()
  where customer.codice_cliente in (select distinct btrim(code) from unnest(p_codes) code);

  insert into public.crm_audit_log (
    utente_id, entita_tipo, entita_id, operazione, dettagli
  )
  select
    actor_id,
    'crm_customer_status',
    null,
    'customer_excluded_reference_list',
    jsonb_build_object(
      'customer_key', 'mexal:' || classification.codice_cliente,
      'crm_type', classification.area_crm,
      'crm_active', false,
      'sync_excluded', true,
      'source_file', nullif(btrim(coalesce(p_source_file, '')), ''),
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  from public.crm_customer_classifications classification
  where classification.codice_cliente in (select distinct btrim(code) from unnest(p_codes) code);

  return jsonb_build_object(
    'requested', requested_count,
    'excluded', requested_count,
    'crm_inactive', requested_count
  );
end;
$$;

revoke all on function public.workspace_exclude_mexal_customers(text[], text, text)
  from public, anon, authenticated;
grant execute on function public.workspace_exclude_mexal_customers(text[], text, text)
  to service_role;

-- Esclude i clienti bloccati da tutte le viste CRM canoniche, anche per service_role.
create or replace function public.crm_visible_canonical_customer_codes()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select
      u.codice_agente_mexal,
      coalesce(r.amministratore_workspace, false) as is_admin,
      coalesce(r.ambito_dati, 'propri') as data_scope
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
    limit 1
  ), visible_agents as materialized (
    select public.normalize_mexal_agent_code(code) as code
    from public.visible_mexal_agent_codes() code
  )
  select customer.codice_cliente::text
  from public.ordini_clienti_cache customer
  where auth.role() = 'service_role'
    and customer.sync_excluded is false
  union
  select customer.codice_cliente::text
  from public.ordini_clienti_cache customer
  cross join me
  where customer.sync_excluded is false
    and (
      me.is_admin
      or me.data_scope = 'tutti'
      or (
        nullif(public.normalize_mexal_agent_code(customer.codice_agente_mexal), '') is not null
        and (
          (me.data_scope = 'team' and public.normalize_mexal_agent_code(customer.codice_agente_mexal)
            in (select visible_agents.code from visible_agents))
          or (me.data_scope <> 'team' and public.normalize_mexal_agent_code(customer.codice_agente_mexal) =
            public.normalize_mexal_agent_code(me.codice_agente_mexal))
        )
      )
    );
$$;

create or replace function public.crm_customer_classification_visible(
  target_customer_code text,
  target_area text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crm_visible_canonical_customer_codes() visible(customer_code)
    where visible.customer_code = target_customer_code
  )
  and target_area = any(public.crm_visible_customer_areas());
$$;

revoke all on function public.crm_visible_canonical_customer_codes() from public, anon;
grant execute on function public.crm_visible_canonical_customer_codes() to authenticated, service_role;
revoke all on function public.crm_customer_classification_visible(text, text) from public, anon;
grant execute on function public.crm_customer_classification_visible(text, text) to authenticated, service_role;

comment on table public.workspace_mexal_customer_exclusions is
  'Lista permanente dei clienti Mexal esclusi da Workspace e dalle sincronizzazioni future, con snapshot auditabile.';
comment on column public.ordini_clienti_cache.sync_excluded is
  'Esclusione Workspace permanente e indipendente dallo stato originale dell anagrafica Mexal.';

commit;
