begin;

-- L'anagrafica resta esclusivamente in ordini_clienti_cache. Questa tabella
-- conserva soltanto l'allocazione CRM e l'eventuale decisione manuale Admin.
create table if not exists public.crm_customer_classifications (
  codice_cliente text primary key
    references public.ordini_clienti_cache(codice_cliente)
    on update cascade on delete cascade,
  area_automatica text not null
    check (area_automatica in ('conto_terzi','b2b','online')),
  agente_classificazione text,
  origine_classificazione text not null default 'agent_rule'
    check (origine_classificazione = 'agent_rule'),
  classificata_il timestamptz not null default now(),
  area_override text
    check (area_override is null or area_override in ('conto_terzi','b2b','online')),
  override_da uuid references public.utenti(id) on delete set null,
  override_il timestamptz,
  override_note text,
  area_crm text generated always as (coalesce(area_override, area_automatica)) stored,
  aggiornata_il timestamptz not null default now(),
  constraint crm_customer_override_consistency check (
    (area_override is null and override_da is null and override_il is null)
    or (area_override is not null and override_il is not null)
  )
);

create index if not exists crm_customer_classifications_area_idx
  on public.crm_customer_classifications(area_crm, codice_cliente);
create index if not exists crm_customer_classifications_agent_idx
  on public.crm_customer_classifications(agente_classificazione);
create index if not exists crm_customer_classifications_override_idx
  on public.crm_customer_classifications(area_override)
  where area_override is not null;

create or replace function public.crm_normalize_agent_name(value text)
returns text
language sql
immutable
parallel safe
as $$
  select upper(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.crm_customer_area_from_agent(value text)
returns text
language sql
immutable
parallel safe
as $$
  select case public.crm_normalize_agent_name(value)
    when '' then 'conto_terzi'
    when 'MARIA RIPA' then 'conto_terzi'
    when 'AMAZON' then 'online'
    when 'ONLINE' then 'online'
    else 'b2b'
  end;
$$;

create or replace function public.crm_customer_agent_label(target_agent_code text)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ', a.nome, a.cognome)), ''),
    nullif(btrim(target_agent_code), '')
  )
  from (select 1) seed
  left join lateral (
    select agente.nome, agente.cognome
    from public.mexal_agenti agente
    where public.normalize_mexal_agent_code(agente.codice)
      = public.normalize_mexal_agent_code(target_agent_code)
    order by (agente.attivo_mexal is true) desc, agente.codice
    limit 1
  ) a on true;
$$;

create or replace function public.crm_refresh_customer_classification(target_customer_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_agent text;
  next_area text;
begin
  select public.crm_customer_agent_label(cliente.codice_agente_mexal)
  into current_agent
  from public.ordini_clienti_cache cliente
  where cliente.codice_cliente = target_customer_code;

  if not found then return; end if;
  next_area := public.crm_customer_area_from_agent(current_agent);

  insert into public.crm_customer_classifications (
    codice_cliente, area_automatica, agente_classificazione,
    origine_classificazione, classificata_il, aggiornata_il
  ) values (
    target_customer_code, next_area, nullif(btrim(current_agent), ''),
    'agent_rule', now(), now()
  )
  on conflict (codice_cliente) do update set
    area_automatica = excluded.area_automatica,
    agente_classificazione = excluded.agente_classificazione,
    origine_classificazione = 'agent_rule',
    classificata_il = case
      when crm_customer_classifications.area_automatica is distinct from excluded.area_automatica
        or crm_customer_classifications.agente_classificazione is distinct from excluded.agente_classificazione
      then now() else crm_customer_classifications.classificata_il end,
    aggiornata_il = case
      when crm_customer_classifications.area_automatica is distinct from excluded.area_automatica
        or crm_customer_classifications.agente_classificazione is distinct from excluded.agente_classificazione
      then now() else crm_customer_classifications.aggiornata_il end;
end;
$$;

create or replace function public.crm_refresh_customer_classifications()
returns table(processed bigint, conto_terzi bigint, b2b bigint, online bigint, unclassified bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.workspace_user_is_admin() then
    raise exception 'Solo un Amministratore Workspace può popolare le classificazioni CRM.' using errcode = '42501';
  end if;

  insert into public.crm_customer_classifications (
    codice_cliente, area_automatica, agente_classificazione,
    origine_classificazione, classificata_il, aggiornata_il
  )
  select
    cliente.codice_cliente,
    public.crm_customer_area_from_agent(public.crm_customer_agent_label(cliente.codice_agente_mexal)),
    nullif(btrim(public.crm_customer_agent_label(cliente.codice_agente_mexal)), ''),
    'agent_rule', now(), now()
  from public.ordini_clienti_cache cliente
  on conflict (codice_cliente) do update set
    area_automatica = excluded.area_automatica,
    agente_classificazione = excluded.agente_classificazione,
    origine_classificazione = 'agent_rule',
    classificata_il = case
      when crm_customer_classifications.area_automatica is distinct from excluded.area_automatica
        or crm_customer_classifications.agente_classificazione is distinct from excluded.agente_classificazione
      then now() else crm_customer_classifications.classificata_il end,
    aggiornata_il = case
      when crm_customer_classifications.area_automatica is distinct from excluded.area_automatica
        or crm_customer_classifications.agente_classificazione is distinct from excluded.agente_classificazione
      then now() else crm_customer_classifications.aggiornata_il end;

  return query
  select
    count(*)::bigint,
    count(*) filter (where classificazione.area_crm = 'conto_terzi')::bigint,
    count(*) filter (where classificazione.area_crm = 'b2b')::bigint,
    count(*) filter (where classificazione.area_crm = 'online')::bigint,
    count(*) filter (where classificazione.area_crm is null)::bigint
  from public.crm_customer_classifications classificazione;
end;
$$;

create or replace function public.crm_classify_customer_after_mexal_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.crm_refresh_customer_classification(new.codice_cliente);
  return new;
end;
$$;

drop trigger if exists crm_classify_customer_after_mexal_sync on public.ordini_clienti_cache;
create trigger crm_classify_customer_after_mexal_sync
after insert or update of codice_agente_mexal on public.ordini_clienti_cache
for each row execute function public.crm_classify_customer_after_mexal_sync();

create or replace function public.crm_refresh_customers_after_agent_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  customer record;
begin
  for customer in
    select codice_cliente
    from public.ordini_clienti_cache
    where public.normalize_mexal_agent_code(codice_agente_mexal) in (
      public.normalize_mexal_agent_code(old.codice),
      public.normalize_mexal_agent_code(new.codice)
    )
  loop
    perform public.crm_refresh_customer_classification(customer.codice_cliente);
  end loop;
  return new;
end;
$$;

drop trigger if exists crm_refresh_customers_after_agent_change on public.mexal_agenti;
create trigger crm_refresh_customers_after_agent_change
after update of codice, nome, cognome, attivo_mexal on public.mexal_agenti
for each row execute function public.crm_refresh_customers_after_agent_change();

create or replace view public.crm_classified_customers
with (security_invoker = true)
as
select
  cliente.codice_cliente,
  cliente.ragione_sociale,
  cliente.codice_agente_mexal,
  classificazione.agente_classificazione,
  classificazione.area_automatica,
  classificazione.area_override,
  classificazione.area_crm,
  classificazione.origine_classificazione,
  case when classificazione.area_override is null then 'automatico' else 'manuale' end as modalita,
  classificazione.classificata_il,
  classificazione.override_da,
  classificazione.override_il,
  classificazione.override_note,
  cliente.attivo_mexal,
  cliente.ultimo_sync_mexal
from public.ordini_clienti_cache cliente
join public.crm_customer_classifications classificazione
  on classificazione.codice_cliente = cliente.codice_cliente;

create or replace function public.crm_set_customer_area_override(
  customer_codes text[], target_area text, note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := public.workspace_current_profile_id();
  affected integer;
begin
  if not public.workspace_user_is_admin() then
    raise exception 'Solo un Amministratore Workspace può modificare la classificazione CRM.' using errcode = '42501';
  end if;
  if target_area not in ('conto_terzi','b2b','online') then
    raise exception 'Area CRM non valida.' using errcode = '22023';
  end if;

  update public.crm_customer_classifications
  set area_override = target_area,
      override_da = current_user_id,
      override_il = now(),
      override_note = nullif(btrim(note), ''),
      aggiornata_il = now()
  where codice_cliente = any(customer_codes);
  get diagnostics affected = row_count;

  insert into public.crm_audit_log (utente_id, entita_tipo, operazione, dettagli)
  select current_user_id, 'crm_customer_classification', 'manual_override',
    jsonb_build_object('codice_cliente', codice_cliente, 'area', target_area, 'note', nullif(btrim(note), ''))
  from unnest(customer_codes) codice_cliente;
  return affected;
end;
$$;

create or replace function public.crm_clear_customer_area_override(customer_codes text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := public.workspace_current_profile_id();
  affected integer;
begin
  if not public.workspace_user_is_admin() then
    raise exception 'Solo un Amministratore Workspace può ripristinare la classificazione automatica.' using errcode = '42501';
  end if;

  update public.crm_customer_classifications
  set area_override = null, override_da = null, override_il = null,
      override_note = null, aggiornata_il = now()
  where codice_cliente = any(customer_codes);
  get diagnostics affected = row_count;

  insert into public.crm_audit_log (utente_id, entita_tipo, operazione, dettagli)
  select current_user_id, 'crm_customer_classification', 'restore_agent_rule',
    jsonb_build_object('codice_cliente', codice_cliente)
  from unnest(customer_codes) codice_cliente;
  return affected;
end;
$$;

alter table public.crm_customer_classifications enable row level security;
drop policy if exists "crm customer classifications admin read" on public.crm_customer_classifications;
create policy "crm customer classifications admin read"
on public.crm_customer_classifications for select to authenticated
using (public.crm_has_module_level('crm','amministrazione'));
drop policy if exists "crm customer classifications admin write" on public.crm_customer_classifications;
create policy "crm customer classifications admin write"
on public.crm_customer_classifications for all to authenticated
using (public.workspace_user_is_admin())
with check (public.workspace_user_is_admin());

revoke all on public.crm_customer_classifications from public, anon;
grant select on public.crm_customer_classifications to authenticated;
grant select on public.crm_classified_customers to authenticated;
grant insert, update, delete on public.crm_customer_classifications to service_role;

revoke all on function public.crm_refresh_customer_classification(text) from public, anon, authenticated;
grant execute on function public.crm_refresh_customer_classification(text) to service_role;
revoke all on function public.crm_refresh_customer_classifications() from public, anon;
grant execute on function public.crm_refresh_customer_classifications() to authenticated, service_role;
revoke all on function public.crm_set_customer_area_override(text[],text,text) from public, anon;
grant execute on function public.crm_set_customer_area_override(text[],text,text) to authenticated;
revoke all on function public.crm_clear_customer_area_override(text[]) from public, anon;
grant execute on function public.crm_clear_customer_area_override(text[]) to authenticated;

comment on table public.crm_customer_classifications is
  'Allocazione CRM 1:1 dei clienti canonici Workspace/Mexal; nessun dato anagrafico duplicato.';
comment on function public.crm_refresh_customer_classifications() is
  'Popolamento idempotente da eseguire solo dopo simulazione read-only con zero non classificati.';

commit;
