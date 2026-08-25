begin;

-- Stato operativo CRM separato dall'anagrafica Workspace/Mexal e dallo stato
-- commerciale nel periodo. La chiave canonica evita qualsiasi duplicazione.
create table if not exists public.crm_customer_status (
  customer_key text primary key,
  crm_type text not null check (crm_type in ('conto_terzi', 'b2b', 'online')),
  crm_active boolean not null default true,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.utenti(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_customer_status_key_check check (
    customer_key ~ '^mexal:.+' or customer_key ~ '^crm:[0-9a-fA-F-]{36}$'
  )
);

create index if not exists crm_customer_status_type_active_idx
  on public.crm_customer_status (crm_type, crm_active, customer_key);

alter table public.crm_customer_status enable row level security;

drop policy if exists "crm customer status scoped read" on public.crm_customer_status;
create policy "crm customer status scoped read"
on public.crm_customer_status for select to authenticated
using (
  case
    when customer_key like 'mexal:%' then exists (
      select 1
      from public.crm_customer_classifications classification
      where classification.codice_cliente = substr(customer_key, 7)
        and classification.area_crm = crm_type
        and public.crm_customer_classification_visible(
          classification.codice_cliente,
          classification.area_crm
        )
    )
    when customer_key like 'crm:%' then exists (
      select 1
      from public.crm_accounts account
      where account.id = substr(customer_key, 5)::uuid
        and account.tipo = crm_type
        and public.crm_row_visible(
          account.responsabile_id,
          account.reparto_id,
          public.crm_module_for_type(account.tipo)
        )
    )
    else false
  end
);

-- Le mutazioni passano soltanto dalla RPC atomica sottostante. In questo modo
-- autorizzazione, timestamp e audit non possono divergere.
revoke all on public.crm_customer_status from public, anon;
grant select on public.crm_customer_status to authenticated, service_role;
grant all on public.crm_customer_status to service_role;

create or replace function public.crm_set_customer_active(
  p_customer_key text,
  p_crm_type text,
  p_active boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_key text := btrim(coalesce(p_customer_key, ''));
  actor_id uuid := public.workspace_current_profile_id();
  entity_uuid uuid;
  allowed boolean := false;
  previous_active boolean := true;
  result public.crm_customer_status;
begin
  if p_crm_type not in ('conto_terzi', 'b2b', 'online') then
    raise exception 'Area CRM non valida.' using errcode = '22023';
  end if;
  if p_active is null or actor_id is null then
    raise exception 'Richiesta stato CRM non valida.' using errcode = '22023';
  end if;
  if not public.crm_has_module_level(public.crm_module_for_type(p_crm_type), 'scrittura')
     and auth.role() <> 'service_role' then
    raise exception 'Scrittura CRM non autorizzata.' using errcode = '42501';
  end if;

  if normalized_key like 'mexal:%' then
    select exists (
      select 1
      from public.crm_customer_classifications classification
      where classification.codice_cliente = substr(normalized_key, 7)
        and classification.area_crm = p_crm_type
        and public.crm_customer_classification_visible(
          classification.codice_cliente,
          classification.area_crm
        )
    ) into allowed;
  elsif normalized_key like 'crm:%' then
    begin
      entity_uuid := substr(normalized_key, 5)::uuid;
    exception when invalid_text_representation then
      raise exception 'Identificatore cliente CRM non valido.' using errcode = '22023';
    end;
    select exists (
      select 1
      from public.crm_accounts account
      where account.id = entity_uuid
        and account.tipo = p_crm_type
        and public.crm_row_visible(
          account.responsabile_id,
          account.reparto_id,
          public.crm_module_for_type(account.tipo)
        )
    ) into allowed;
  else
    raise exception 'Identificatore cliente canonico non valido.' using errcode = '22023';
  end if;

  if not allowed and auth.role() <> 'service_role' then
    raise exception 'Cliente CRM non visibile o non autorizzato.' using errcode = '42501';
  end if;

  select status.crm_active into previous_active
  from public.crm_customer_status status
  where status.customer_key = normalized_key;
  previous_active := coalesce(previous_active, true);

  insert into public.crm_customer_status (
    customer_key, crm_type, crm_active, changed_at, changed_by, reason, updated_at
  ) values (
    normalized_key, p_crm_type, p_active, now(), actor_id,
    nullif(btrim(coalesce(p_reason, '')), ''), now()
  )
  on conflict (customer_key) do update set
    crm_type = excluded.crm_type,
    crm_active = excluded.crm_active,
    changed_at = excluded.changed_at,
    changed_by = excluded.changed_by,
    reason = excluded.reason,
    updated_at = excluded.updated_at
  returning * into result;

  insert into public.crm_audit_log (
    utente_id, entita_tipo, entita_id, operazione, dettagli
  ) values (
    actor_id,
    'crm_customer_status',
    entity_uuid,
    case when p_active then 'customer_reactivated' else 'customer_deactivated' end,
    jsonb_build_object(
      'customer_key', normalized_key,
      'crm_type', p_crm_type,
      'previous_active', previous_active,
      'crm_active', p_active,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  return jsonb_build_object(
    'customer_key', result.customer_key,
    'crm_type', result.crm_type,
    'crm_active', result.crm_active,
    'changed_at', result.changed_at,
    'changed_by', result.changed_by,
    'reason', result.reason
  );
end;
$$;

revoke all on function public.crm_set_customer_active(text, text, boolean, text)
  from public, anon;
grant execute on function public.crm_set_customer_active(text, text, boolean, text)
  to authenticated, service_role;

create or replace function public.crm_customer_status_counts(p_crm_type text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with visible_customers as (
    select 'mexal:' || classification.codice_cliente as customer_key
    from public.crm_customer_classifications classification
    where classification.area_crm = p_crm_type
      and public.crm_customer_classification_visible(
        classification.codice_cliente,
        classification.area_crm
      )
    union all
    select 'crm:' || account.id::text
    from public.crm_accounts account
    where account.tipo = p_crm_type
      and account.codice_cliente_mexal is null
      and public.crm_row_visible(
        account.responsabile_id,
        account.reparto_id,
        public.crm_module_for_type(account.tipo)
      )
  ), measured as (
    select visible.customer_key, coalesce(status.crm_active, true) as crm_active
    from visible_customers visible
    left join public.crm_customer_status status using (customer_key)
  )
  select jsonb_build_object(
    'total', count(*)::bigint,
    'active', count(*) filter (where crm_active)::bigint,
    'inactive', count(*) filter (where not crm_active)::bigint
  )
  from measured;
$$;

revoke all on function public.crm_customer_status_counts(text) from public, anon;
grant execute on function public.crm_customer_status_counts(text) to authenticated, service_role;

-- Overload con filtro stato CRM; la funzione analytics precedente resta
-- disponibile ai consumer esistenti e continua a rappresentare lo storico.
create or replace function public.crm_customer_metric_details(
  p_crm_type text,
  p_from date,
  p_to date,
  p_metric text,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_customer_status text
)
returns table (
  codice_cliente text,
  ragione_sociale text,
  agente_classificazione text,
  origine_classificazione text,
  modalita text,
  attivo_mexal boolean,
  crm_account_id uuid,
  stato_crm text,
  ultima_attivita_il timestamptz,
  prossima_attivita_il timestamptz,
  opportunita_count bigint,
  invoice_count bigint,
  invoice_total numeric,
  order_count bigint,
  order_total numeric,
  ultimo_ordine_il date,
  crm_active boolean,
  crm_status_changed_at timestamptz,
  crm_status_changed_by uuid,
  crm_status_reason text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with customers as (
    select customer.codice_cliente, customer.ragione_sociale,
      classification.agente_classificazione,
      classification.origine_classificazione,
      case when classification.area_override is null then 'automatico' else 'manuale' end modalita,
      customer.attivo_mexal,
      coalesce(status.crm_active, true) crm_active,
      status.changed_at crm_status_changed_at,
      status.changed_by crm_status_changed_by,
      status.reason crm_status_reason
    from public.crm_customer_classifications classification
    join public.ordini_clienti_cache customer using (codice_cliente)
    left join public.crm_customer_status status
      on status.customer_key = 'mexal:' || customer.codice_cliente
    where classification.area_crm = p_crm_type
      and public.crm_customer_classification_visible(
        classification.codice_cliente,
        classification.area_crm
      )
      and (nullif(btrim(p_search), '') is null
        or customer.codice_cliente ilike '%' || btrim(p_search) || '%'
        or customer.ragione_sociale ilike '%' || btrim(p_search) || '%'
        or classification.agente_classificazione ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_customer_status, 'active') = 'all'
        or (p_customer_status = 'inactive' and not coalesce(status.crm_active, true))
        or (coalesce(p_customer_status, 'active') = 'active' and coalesce(status.crm_active, true)))
  ), measured as (
    select customer.*,
      account.id crm_account_id, account.stato stato_crm,
      account.ultima_attivita_il, account.prossima_attivita_il,
      coalesce(opportunities.opportunita_count, 0) opportunita_count,
      coalesce(invoice.invoice_count, 0) invoice_count,
      coalesce(invoice.invoice_total, 0) invoice_total,
      invoice.first_date first_invoice,
      invoice.last_date last_invoice,
      coalesce(customer_order.order_count, 0) order_count,
      coalesce(customer_order.order_total, 0) order_total,
      customer_order.first_date first_order,
      customer_order.last_date ultimo_ordine_il
    from customers customer
    left join lateral (
      select candidate.* from public.crm_accounts candidate
      where candidate.tipo = p_crm_type
        and candidate.codice_cliente_mexal = customer.codice_cliente
        and public.crm_row_visible(
          candidate.responsabile_id,
          candidate.reparto_id,
          public.crm_module_for_type(candidate.tipo)
        )
      order by candidate.aggiornato_il desc limit 1
    ) account on true
    left join lateral (
      select count(*)::bigint opportunita_count
      from public.crm_opportunities opportunity
      where opportunity.account_id = account.id
    ) opportunities on true
    left join lateral (
      select
        count(*) filter (where document.data_documento between p_from and p_to)::bigint invoice_count,
        coalesce(sum(document.totale_documento) filter (where document.data_documento between p_from and p_to), 0)::numeric invoice_total,
        min(document.data_documento) first_date,
        max(document.data_documento) last_date
      from public.mexal_fatture_vendita document
      where document.codice_cliente = customer.codice_cliente
    ) invoice on true
    left join lateral (
      select
        count(*) filter (where customer_order.data_ordine between p_from and p_to)::bigint order_count,
        coalesce(sum(customer_order.totale_documento) filter (where customer_order.data_ordine between p_from and p_to), 0)::numeric order_total,
        min(customer_order.data_ordine) first_date,
        max(customer_order.data_ordine) last_date
      from public.ordini_testate customer_order
      where customer_order.codice_cliente = customer.codice_cliente
    ) customer_order on true
  ), filtered as (
    select * from measured metric
    where coalesce(p_metric, '') in ('', 'all')
      or (p_metric = 'active' and (metric.invoice_count > 0 or metric.order_count > 0))
      or (p_metric = 'invoiced' and metric.invoice_count > 0)
      or (p_metric = 'ordered' and metric.order_count > 0)
      or (p_metric = 'new' and least(metric.first_invoice, metric.first_order) between p_from and p_to)
      or (p_metric = 'inactive' and (
        greatest(metric.last_invoice, metric.ultimo_ordine_il) is null
        or greatest(metric.last_invoice, metric.ultimo_ordine_il) < p_to - 90
      ))
  )
  select filtered.codice_cliente, filtered.ragione_sociale,
    filtered.agente_classificazione, filtered.origine_classificazione,
    filtered.modalita, filtered.attivo_mexal, filtered.crm_account_id,
    filtered.stato_crm, filtered.ultima_attivita_il,
    filtered.prossima_attivita_il, filtered.opportunita_count,
    filtered.invoice_count, filtered.invoice_total, filtered.order_count,
    filtered.order_total, filtered.ultimo_ordine_il, filtered.crm_active,
    filtered.crm_status_changed_at, filtered.crm_status_changed_by,
    filtered.crm_status_reason, count(*) over()::bigint total_count
  from filtered
  order by filtered.ragione_sociale
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.crm_customer_metric_details(
  text, date, date, text, text, integer, integer, text
) from public, anon;
grant execute on function public.crm_customer_metric_details(
  text, date, date, text, text, integer, integer, text
) to authenticated, service_role;

create or replace function public.crm_prospect_customer_details(
  p_crm_type text,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_customer_status text default 'active'
)
returns table (
  id uuid,
  nome text,
  stato text,
  stato_relazione text,
  valore_cliente numeric,
  email text,
  telefono text,
  ultima_attivita_il timestamptz,
  prossima_attivita_il timestamptz,
  opportunita_count bigint,
  crm_active boolean,
  crm_status_changed_at timestamptz,
  crm_status_changed_by uuid,
  crm_status_reason text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select account.*,
      coalesce(status.crm_active, true) crm_active,
      status.changed_at crm_status_changed_at,
      status.changed_by crm_status_changed_by,
      status.reason crm_status_reason
    from public.crm_accounts account
    left join public.crm_customer_status status
      on status.customer_key = 'crm:' || account.id::text
    where account.tipo = p_crm_type
      and account.codice_cliente_mexal is null
      and public.crm_row_visible(
        account.responsabile_id,
        account.reparto_id,
        public.crm_module_for_type(account.tipo)
      )
      and (nullif(btrim(p_search), '') is null
        or account.nome ilike '%' || btrim(p_search) || '%'
        or account.email ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_customer_status, 'active') = 'all'
        or (p_customer_status = 'inactive' and not coalesce(status.crm_active, true))
        or (coalesce(p_customer_status, 'active') = 'active' and coalesce(status.crm_active, true)))
  )
  select visible.id, visible.nome, visible.stato, visible.stato_relazione,
    visible.valore_cliente, visible.email, visible.telefono,
    visible.ultima_attivita_il, visible.prossima_attivita_il,
    (select count(*)::bigint from public.crm_opportunities opportunity
      where opportunity.account_id = visible.id) opportunita_count,
    visible.crm_active, visible.crm_status_changed_at,
    visible.crm_status_changed_by, visible.crm_status_reason,
    count(*) over()::bigint total_count
  from visible
  order by visible.aggiornato_il desc
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.crm_prospect_customer_details(
  text, text, integer, integer, text
) from public, anon;
grant execute on function public.crm_prospect_customer_details(
  text, text, integer, integer, text
) to authenticated, service_role;

-- Le view canoniche espongono lo stato CRM senza sostituire attivo_mexal.
create or replace view public.crm_customer_classification_catalog
with (security_invoker = false, security_barrier = true)
as
select
  customer.codice_cliente,
  customer.ragione_sociale,
  customer.codice_agente_mexal,
  classification.agente_classificazione,
  classification.area_automatica,
  classification.area_override,
  classification.area_crm,
  classification.origine_classificazione,
  case when classification.area_override is null then 'automatico' else 'manuale' end as modalita,
  classification.classificata_il,
  classification.override_il,
  classification.override_note,
  customer.attivo_mexal,
  coalesce(status.crm_active, true) as crm_active,
  status.changed_at as crm_status_changed_at,
  status.changed_by as crm_status_changed_by,
  status.reason as crm_status_reason
from public.ordini_clienti_cache customer
join public.crm_customer_classifications classification
  on classification.codice_cliente = customer.codice_cliente
left join public.crm_customer_status status
  on status.customer_key = 'mexal:' || customer.codice_cliente
where classification.area_crm::text = any (
  ((select public.crm_visible_customer_areas()))::text[]
)
and classification.codice_cliente::text = any (
  (select coalesce(array_agg(visible.customer_code), '{}'::text[])
   from public.crm_visible_canonical_customer_codes() visible(customer_code))::text[]
);

revoke all on public.crm_customer_classification_catalog from public, anon;
grant select on public.crm_customer_classification_catalog to authenticated, service_role;

create or replace view public.crm_classified_customers
with (security_invoker = false, security_barrier = true)
as
select
  customer.codice_cliente,
  customer.ragione_sociale,
  customer.codice_agente_mexal,
  classification.agente_classificazione,
  classification.area_automatica,
  classification.area_override,
  classification.area_crm,
  classification.origine_classificazione,
  case when classification.area_override is null then 'automatico' else 'manuale' end as modalita,
  classification.classificata_il,
  classification.override_da,
  classification.override_il,
  classification.override_note,
  customer.attivo_mexal,
  customer.ultimo_sync_mexal,
  customer.partita_iva,
  customer.codice_fiscale,
  customer.indirizzo,
  customer.cap,
  customer.localita,
  customer.provincia,
  customer.telefono,
  customer.email,
  account.id as crm_account_id,
  account.stato as stato_crm,
  account.stato_relazione,
  account.valore_cliente,
  account.ultima_attivita_il,
  account.prossima_attivita_il,
  coalesce(opportunities.opportunita_count, 0)::bigint as opportunita_count,
  customer_order.ultimo_ordine_il,
  invoice.fatturato,
  coalesce(status.crm_active, true) as crm_active,
  status.changed_at as crm_status_changed_at,
  status.changed_by as crm_status_changed_by,
  status.reason as crm_status_reason
from public.ordini_clienti_cache customer
join public.crm_customer_classifications classification
  on classification.codice_cliente = customer.codice_cliente
left join public.crm_customer_status status
  on status.customer_key = 'mexal:' || customer.codice_cliente
left join lateral (
  select candidate.* from public.crm_accounts candidate
  where candidate.tipo = classification.area_crm
    and candidate.codice_cliente_mexal = customer.codice_cliente
    and public.crm_row_visible(
      candidate.responsabile_id,
      candidate.reparto_id,
      public.crm_module_for_type(candidate.tipo)
    )
  order by candidate.aggiornato_il desc limit 1
) account on true
left join lateral (
  select count(*)::bigint as opportunita_count
  from public.crm_opportunities opportunity
  where opportunity.account_id = account.id
    and public.crm_row_visible(
      coalesce(opportunity.responsabile_id, account.responsabile_id),
      coalesce(opportunity.reparto_id, account.reparto_id),
      public.crm_module_for_type(classification.area_crm)
    )
) opportunities on true
left join lateral (
  select max(document.data_ordine) as ultimo_ordine_il
  from public.ordini_testate document
  where document.codice_cliente = customer.codice_cliente
) customer_order on true
left join lateral (
  select coalesce(sum(document.totale_documento), 0)::numeric(16, 2) as fatturato
  from public.mexal_fatture_vendita document
  where document.codice_cliente = customer.codice_cliente
) invoice on true
where public.crm_customer_classification_visible(
  classification.codice_cliente,
  classification.area_crm
);

revoke all on public.crm_classified_customers from public, anon;
grant select on public.crm_classified_customers to authenticated, service_role;

comment on table public.crm_customer_status is
  'Stato operativo CRM 1:1; non modifica anagrafiche, ordini, fatture o classificazioni Workspace/Mexal.';
comment on function public.crm_set_customer_active(text, text, boolean, text) is
  'Disattiva o riattiva un cliente CRM con controllo livello, timestamp e audit atomico.';

commit;
