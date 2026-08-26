begin;
-- Elenco unificato per le dashboard CRM. Lo stato resta nel layer
-- crm_customer_status già auditato; anagrafiche e storico Mexal non cambiano.
create or replace function public.crm_customer_list(
  p_crm_type text,
  p_from date,
  p_to date,
  p_customer_status text default 'active',
  p_metric text default 'all',
  p_search text default null,
  p_agent text default null,
  p_owner uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  entity_kind text, entity_id text, customer_name text, customer_code text,
  agent_name text, crm_type text, crm_active boolean,
  last_order_at date, invoice_total numeric, order_total numeric,
  last_activity_at timestamptz, next_activity_at timestamptz,
  filtered_total bigint, dataset_total bigint, active_total bigint, inactive_total bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with canonical as (
    select
      'canonical'::text as entity_kind,
      catalog.codice_cliente::text as entity_id,
      catalog.ragione_sociale::text as customer_name,
      catalog.codice_cliente::text as customer_code,
      catalog.agente_classificazione::text as agent_name,
      catalog.area_crm::text as crm_type,
      account.responsabile_id,
      catalog.crm_active,
      account.ultima_attivita_il as last_activity_at,
      account.prossima_attivita_il as next_activity_at
    from public.crm_customer_classification_catalog catalog
    left join lateral (
      select candidate.*
      from public.crm_accounts candidate
      where candidate.tipo = catalog.area_crm
        and candidate.codice_cliente_mexal = catalog.codice_cliente
        and public.crm_row_visible(
          candidate.responsabile_id,
          candidate.reparto_id,
          public.crm_module_for_type(candidate.tipo)
        )
      order by candidate.aggiornato_il desc
      limit 1
    ) account on true
    where catalog.area_crm = p_crm_type
  ), prospects as (
    select
      'prospect'::text as entity_kind,
      account.id::text as entity_id,
      account.nome::text as customer_name,
      null::text as customer_code,
      null::text as agent_name,
      account.tipo::text as crm_type,
      account.responsabile_id,
      coalesce(status.crm_active, true) as crm_active,
      account.ultima_attivita_il as last_activity_at,
      account.prossima_attivita_il as next_activity_at
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
  ), base as (
    select * from canonical
    union all
    select * from prospects
  ), measured as (
    select base.*,
      coalesce(invoice.invoice_total, 0)::numeric as invoice_total,
      invoice.first_invoice,
      coalesce(customer_order.order_total, 0)::numeric as order_total,
      customer_order.first_order,
      customer_order.last_order_at
    from base
    left join lateral (
      select
        coalesce(sum(document.totale_documento)
          filter (where document.data_documento between p_from and p_to), 0)::numeric as invoice_total,
        min(document.data_documento) as first_invoice
      from public.mexal_fatture_vendita document
      where base.entity_kind = 'canonical'
        and document.codice_cliente = base.customer_code
    ) invoice on true
    left join lateral (
      select
        coalesce(sum(document.totale_documento)
          filter (where document.data_ordine between p_from and p_to), 0)::numeric as order_total,
        min(document.data_ordine) as first_order,
        max(document.data_ordine) as last_order_at
      from public.ordini_testate document
      where base.entity_kind = 'canonical'
        and document.codice_cliente = base.customer_code
    ) customer_order on true
  ), totals as (
    select count(*)::bigint as dataset_total,
      count(*) filter (where crm_active)::bigint as active_total,
      count(*) filter (where not crm_active)::bigint as inactive_total
    from measured
  ), filtered as (
    select measured.*
    from measured
    where (coalesce(p_customer_status, 'active') = 'all'
        or (coalesce(p_customer_status, 'active') = 'active' and measured.crm_active)
        or (p_customer_status = 'inactive' and not measured.crm_active))
      and (nullif(btrim(p_search), '') is null
        or measured.customer_name ilike '%' || btrim(p_search) || '%'
        or coalesce(measured.customer_code, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(measured.agent_name, '') ilike '%' || btrim(p_search) || '%')
      and (nullif(btrim(p_agent), '') is null
        or coalesce(measured.agent_name, '') ilike '%' || btrim(p_agent) || '%')
      and (p_owner is null or measured.responsabile_id = p_owner)
      and (coalesce(p_metric, 'all') = 'all'
        or (p_metric = 'active' and (measured.invoice_total > 0 or measured.order_total > 0))
        or (p_metric = 'invoiced' and measured.invoice_total > 0)
        or (p_metric = 'ordered' and measured.order_total > 0)
        or (p_metric = 'inactive' and measured.invoice_total = 0 and measured.order_total = 0)
        or (p_metric = 'new' and coalesce(
          least(measured.first_invoice, measured.first_order),
          measured.first_invoice,
          measured.first_order
        ) between p_from and p_to))
  )
  select filtered.entity_kind, filtered.entity_id, filtered.customer_name,
    filtered.customer_code, filtered.agent_name, filtered.crm_type,
    filtered.crm_active, filtered.last_order_at, filtered.invoice_total,
    filtered.order_total, filtered.last_activity_at, filtered.next_activity_at,
    count(*) over()::bigint as filtered_total, totals.dataset_total,
    totals.active_total, totals.inactive_total
  from filtered
  cross join totals
  where public.crm_has_module_level(public.crm_module_for_type(p_crm_type), 'lettura')
  order by filtered.customer_name
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;
revoke all on function public.crm_customer_list(
  text, date, date, text, text, text, text, uuid, integer, integer
) from public, anon;
grant execute on function public.crm_customer_list(
  text, date, date, text, text, text, text, uuid, integer, integer
) to authenticated, service_role;
comment on function public.crm_customer_list(
  text, date, date, text, text, text, text, uuid, integer, integer
) is 'Elenco clienti CRM area-scoped con stato operativo, filtri persistenti, metriche periodo e conteggi server-side.';
commit;
