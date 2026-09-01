begin;

-- Dataset ordine canonico per la CRM Overview. Parte dalle testate reali e
-- applica la classificazione cliente solo agli ordini che non dichiarano gia
-- in modo autorevole il proprio business.
create or replace function public.crm_commercial_control_order_dataset(
  p_scope text,
  p_from date,
  p_to date,
  p_business text default null,
  p_market text default null,
  p_country text default null,
  p_agent text default null,
  p_channel text default null,
  p_customer text default null
)
returns table (
  order_id uuid,
  customer_code text,
  customer_name text,
  document_date date,
  amount numeric,
  business text,
  channel text,
  country_code text,
  agent_code text,
  agent_name text,
  crm_area text,
  order_source text
)
language sql
stable
security definer
set search_path = public
as $$
  with valid_line_values as materialized (
    select
      line.ordine_id,
      sum(coalesce(
        line.totale_riga,
        line.imponibile_riga,
        line.quantita * line.prezzo_netto,
        0
      ))::numeric as amount
    from public.ordini_righe line
    where not coalesce(line.riga_descrittiva, false)
      and coalesce(line.mexal_attiva, true)
    group by line.ordine_id
  ), dimensioned_orders as materialized (
    select
      order_header.id as order_id,
      order_header.codice_cliente as customer_code,
      coalesce(customer.ragione_sociale, order_header.ragione_sociale_cliente, order_header.codice_cliente) as customer_name,
      order_header.data_ordine as document_date,
      coalesce(line_value.amount, order_header.totale_imponibile, order_header.totale_documento, 0)::numeric as amount,
      case
        when order_header.origine = 'mexal_oct' and order_header.modulo_ordini = 'private' then 'PRIVATE'
        when upper(coalesce(nullif(btrim(customer.cod_alternativo), ''), '')) = 'PRIVATE' then 'PRIVATE'
        else 'DIRECT'
      end as business,
      case upper(coalesce(nullif(btrim(customer.nome_ricerca_cf), ''), ''))
        when 'BTOB' then 'BtoB'
        when 'BTOC' then 'BtoC'
        else null
      end as channel,
      coalesce(
        public.crm_normalize_country_code(customer.paese, coalesce(customer.json_mexal, customer.dati_mexal)),
        'ND'
      ) as country_code,
      customer.codice_agente_mexal as agent_code,
      coalesce(
        nullif(btrim(concat_ws(' ', agent.nome, agent.cognome)), ''),
        customer.codice_agente_mexal,
        'Senza agente'
      ) as agent_name,
      case
        when order_header.origine = 'mexal_oct' and order_header.modulo_ordini = 'private' then 'conto_terzi'
        else classification.area_crm::text
      end as crm_area,
      order_header.crm_order_source as order_source
    from public.crm_order_kpi_source order_header
    left join public.ordini_clienti_cache customer
      on customer.codice_cliente = order_header.codice_cliente
    left join public.crm_customer_classifications classification
      on classification.codice_cliente = order_header.codice_cliente
    left join public.mexal_agenti agent
      on agent.codice = customer.codice_agente_mexal
    left join valid_line_values line_value
      on line_value.ordine_id = order_header.id
    where order_header.data_ordine between p_from and p_to
  )
  select
    source.order_id,
    source.customer_code,
    source.customer_name,
    source.document_date,
    source.amount,
    source.business,
    source.channel,
    source.country_code,
    source.agent_code,
    source.agent_name,
    source.crm_area,
    source.order_source
  from dimensioned_orders source
  where source.customer_code is not null
    and source.crm_area is not null
    and public.crm_customer_classification_visible(source.customer_code, source.crm_area)
    and (
      p_scope = 'global'
      or (p_scope = 'private' and source.business = 'PRIVATE')
      or (p_scope = 'direct' and source.business = 'DIRECT' and source.crm_area in ('b2b', 'online'))
    )
    and (coalesce(btrim(p_business), '') = '' or source.business = upper(btrim(p_business)))
    and (
      coalesce(p_market, '') = ''
      or (p_market = 'italy' and source.country_code = 'IT')
      or (p_market = 'foreign' and source.country_code not in ('IT', 'ND'))
    )
    and (coalesce(btrim(p_country), '') = '' or source.country_code = upper(btrim(p_country)))
    and (coalesce(btrim(p_agent), '') = '' or source.agent_code = btrim(p_agent))
    and (coalesce(btrim(p_channel), '') = '' or source.channel = p_channel)
    and (
      coalesce(btrim(p_customer), '') = ''
      or source.customer_code ilike '%' || btrim(p_customer) || '%'
      or source.customer_name ilike '%' || btrim(p_customer) || '%'
    );
$$;

create or replace function public.crm_commercial_control_order_metrics(
  p_scope text,
  p_from date,
  p_to date,
  p_compare text default 'previous_period',
  p_business text default null,
  p_market text default null,
  p_country text default null,
  p_agent text default null,
  p_channel text default null,
  p_customer text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  comparison_from date;
  comparison_to date;
  result jsonb;
begin
  if p_compare = 'previous_year' then
    comparison_from := (p_from - interval '1 year')::date;
    comparison_to := (p_to - interval '1 year')::date;
  elsif p_compare = 'none' then
    comparison_from := null;
    comparison_to := null;
  else
    comparison_to := p_from - 1;
    comparison_from := comparison_to - (p_to - p_from);
  end if;

  with current_orders as materialized (
    select * from public.crm_commercial_control_order_dataset(
      p_scope, p_from, p_to, p_business, p_market, p_country, p_agent, p_channel, p_customer
    )
  ), comparison_orders as materialized (
    select * from public.crm_commercial_control_order_dataset(
      p_scope,
      coalesce(comparison_from, p_from),
      coalesce(comparison_to, p_from - 1),
      p_business, p_market, p_country, p_agent, p_channel, p_customer
    )
    where comparison_from is not null
  ), current_totals as (
    select count(*)::bigint as order_count, coalesce(sum(amount), 0)::numeric as order_total
    from current_orders
  ), comparison_totals as (
    select coalesce(sum(amount), 0)::numeric as order_total from comparison_orders
  ), business_rows as (
    select business, count(*)::bigint as order_count, coalesce(sum(amount), 0)::numeric as order_total
    from current_orders group by business
  ), agent_rows as (
    select agent_code, agent_name, count(*)::bigint as order_count,
      coalesce(sum(amount), 0)::numeric as order_total
    from current_orders group by agent_code, agent_name
  ), country_rows as (
    select country_code, count(*)::bigint as order_count,
      coalesce(sum(amount), 0)::numeric as order_total
    from current_orders group by country_code
  ), customer_rows as (
    select customer_code, max(customer_name) as customer_name,
      count(*)::bigint as order_count, coalesce(sum(amount), 0)::numeric as order_total,
      max(document_date) as last_order_date
    from current_orders group by customer_code
  ), first_dates as (
    select order_customer.customer_code,
      least(
        (select min(invoice.data_documento) from public.mexal_fatture_vendita invoice
          where invoice.codice_cliente = order_customer.customer_code),
        (select min(order_header.data_ordine) from public.crm_order_kpi_source order_header
          where order_header.codice_cliente = order_customer.customer_code)
      ) as first_commercial_date
    from (select distinct customer_code from current_orders) order_customer
  ), acquisition as (
    select
      coalesce(sum(order_row.amount) filter (where first_dates.first_commercial_date between p_from and p_to), 0)::numeric as new_customer_orders,
      coalesce(sum(order_row.amount) filter (where first_dates.first_commercial_date < p_from), 0)::numeric as reorder_orders,
      coalesce(sum(order_row.amount) filter (where first_dates.first_commercial_date is null), 0)::numeric as other_orders
    from current_orders order_row
    left join first_dates using (customer_code)
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'order_total', current_totals.order_total,
      'order_count', current_totals.order_count,
      'average_order_value', current_totals.order_total / nullif(current_totals.order_count, 0)
    ),
    'comparison', jsonb_build_object('order_total', comparison_totals.order_total),
    'business', coalesce((select jsonb_agg(to_jsonb(row) order by row.business) from business_rows row), '[]'::jsonb),
    'agents', coalesce((select jsonb_agg(to_jsonb(row) order by row.agent_name, row.agent_code) from agent_rows row), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(to_jsonb(row) order by row.country_code) from country_rows row), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(to_jsonb(row) order by row.order_total desc, row.customer_code) from customer_rows row), '[]'::jsonb),
    'acquisition', (select to_jsonb(row) from acquisition row)
  ) into result
  from current_totals cross join comparison_totals;

  return result;
end;
$$;

do $$
begin
  if to_regprocedure('public.crm_commercial_control_dashboard_pre_oct_fix(text,date,date,text,text,text,text,text,text,text,text)') is null then
    alter function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text)
      rename to crm_commercial_control_dashboard_pre_oct_fix;
  end if;
end;
$$;

create or replace function public.crm_commercial_control_dashboard(
  p_scope text,
  p_from date,
  p_to date,
  p_compare text default 'previous_period',
  p_business text default null,
  p_market text default null,
  p_country text default null,
  p_agent text default null,
  p_channel text default null,
  p_customer text default null,
  p_granularity text default 'month'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  dashboard jsonb;
  order_metrics jsonb;
  merged_rows jsonb;
begin
  dashboard := public.crm_commercial_control_dashboard_pre_oct_fix(
    p_scope, p_from, p_to, p_compare, p_business, p_market, p_country,
    p_agent, p_channel, p_customer, p_granularity
  );
  order_metrics := public.crm_commercial_control_order_metrics(
    p_scope, p_from, p_to, p_compare, p_business, p_market, p_country,
    p_agent, p_channel, p_customer
  );

  dashboard := jsonb_set(
    dashboard,
    '{totals}',
    coalesce(dashboard -> 'totals', '{}'::jsonb) || coalesce(order_metrics -> 'totals', '{}'::jsonb)
  );
  dashboard := jsonb_set(
    dashboard,
    '{comparison}',
    coalesce(dashboard -> 'comparison', '{}'::jsonb) || coalesce(order_metrics -> 'comparison', '{}'::jsonb)
  );
  dashboard := jsonb_set(dashboard, '{acquisition}', coalesce(order_metrics -> 'acquisition', '{}'::jsonb));

  with keys as (
    select value ->> 'business' as key from jsonb_array_elements(coalesce(dashboard -> 'business', '[]'::jsonb))
    union
    select value ->> 'business' as key from jsonb_array_elements(coalesce(order_metrics -> 'business', '[]'::jsonb))
  )
  select coalesce(jsonb_agg(
    coalesce(base.item, jsonb_build_object('business', keys.key, 'customers', 0, 'crm_active_customers', 0, 'invoice_total', 0))
    || jsonb_build_object(
      'order_total', coalesce((orders.item ->> 'order_total')::numeric, 0),
      'order_count', coalesce((orders.item ->> 'order_count')::bigint, 0)
    ) order by keys.key
  ), '[]'::jsonb) into merged_rows
  from keys
  left join lateral (
    select value as item from jsonb_array_elements(coalesce(dashboard -> 'business', '[]'::jsonb))
    where value ->> 'business' = keys.key limit 1
  ) base on true
  left join lateral (
    select value as item from jsonb_array_elements(coalesce(order_metrics -> 'business', '[]'::jsonb))
    where value ->> 'business' = keys.key limit 1
  ) orders on true;
  dashboard := jsonb_set(dashboard, '{business}', merged_rows);

  with keys as (
    select coalesce(value ->> 'agent_code', value ->> 'agent_name', '') as key
    from jsonb_array_elements(coalesce(dashboard -> 'agents', '[]'::jsonb))
    union
    select coalesce(value ->> 'agent_code', value ->> 'agent_name', '') as key
    from jsonb_array_elements(coalesce(order_metrics -> 'agents', '[]'::jsonb))
  )
  select coalesce(jsonb_agg(
    coalesce(base.item, jsonb_build_object(
      'agent_code', nullif(orders.item ->> 'agent_code', ''),
      'agent_name', coalesce(orders.item ->> 'agent_name', 'Senza agente'),
      'customers', 0, 'new_customers', 0, 'declining_customers', 0, 'invoice_total', 0
    )) || jsonb_build_object(
      'order_total', coalesce((orders.item ->> 'order_total')::numeric, 0),
      'order_count', coalesce((orders.item ->> 'order_count')::bigint, 0)
    ) order by coalesce(base.item ->> 'agent_name', orders.item ->> 'agent_name'), keys.key
  ), '[]'::jsonb) into merged_rows
  from keys
  left join lateral (
    select value as item from jsonb_array_elements(coalesce(dashboard -> 'agents', '[]'::jsonb))
    where coalesce(value ->> 'agent_code', value ->> 'agent_name', '') = keys.key limit 1
  ) base on true
  left join lateral (
    select value as item from jsonb_array_elements(coalesce(order_metrics -> 'agents', '[]'::jsonb))
    where coalesce(value ->> 'agent_code', value ->> 'agent_name', '') = keys.key limit 1
  ) orders on true;
  dashboard := jsonb_set(dashboard, '{agents}', merged_rows);

  with keys as (
    select value ->> 'country_code' as key from jsonb_array_elements(coalesce(dashboard -> 'countries', '[]'::jsonb))
    union
    select value ->> 'country_code' as key from jsonb_array_elements(coalesce(order_metrics -> 'countries', '[]'::jsonb))
  )
  select coalesce(jsonb_agg(
    coalesce(base.item, jsonb_build_object('country_code', keys.key, 'customers', 0, 'agents', 0, 'invoice_total', 0))
    || jsonb_build_object(
      'order_total', coalesce((orders.item ->> 'order_total')::numeric, 0),
      'order_count', coalesce((orders.item ->> 'order_count')::bigint, 0)
    ) order by keys.key
  ), '[]'::jsonb) into merged_rows
  from keys
  left join lateral (
    select value as item from jsonb_array_elements(coalesce(dashboard -> 'countries', '[]'::jsonb))
    where value ->> 'country_code' = keys.key limit 1
  ) base on true
  left join lateral (
    select value as item from jsonb_array_elements(coalesce(order_metrics -> 'countries', '[]'::jsonb))
    where value ->> 'country_code' = keys.key limit 1
  ) orders on true;
  dashboard := jsonb_set(dashboard, '{countries}', merged_rows);

  select coalesce(jsonb_agg(
    customer.item || jsonb_build_object(
      'order_total', coalesce((orders.item ->> 'order_total')::numeric, 0),
      'order_count', coalesce((orders.item ->> 'order_count')::bigint, 0),
      'last_order_date', coalesce(orders.item -> 'last_order_date', customer.item -> 'last_order_date')
    ) order by coalesce((customer.item ->> 'invoice_total')::numeric, 0) desc,
      coalesce((orders.item ->> 'order_total')::numeric, 0) desc
  ), '[]'::jsonb) into merged_rows
  from jsonb_array_elements(coalesce(dashboard -> 'top_customers', '[]'::jsonb)) customer(item)
  left join lateral (
    select value as item from jsonb_array_elements(coalesce(order_metrics -> 'customers', '[]'::jsonb))
    where value ->> 'customer_code' = customer.item ->> 'codice_cliente' limit 1
  ) orders on true;
  dashboard := jsonb_set(dashboard, '{top_customers}', merged_rows);

  select coalesce(jsonb_agg(
    customer.item || jsonb_build_object(
      'order_total', coalesce((orders.item ->> 'order_total')::numeric, 0),
      'order_count', coalesce((orders.item ->> 'order_count')::bigint, 0),
      'last_order_date', coalesce(orders.item -> 'last_order_date', customer.item -> 'last_order_date')
    ) order by coalesce((customer.item ->> 'priority')::integer, 99),
      coalesce((customer.item ->> 'days_since_purchase')::numeric, 0) desc
  ), '[]'::jsonb) into merged_rows
  from jsonb_array_elements(coalesce(dashboard -> 'attention', '[]'::jsonb)) customer(item)
  left join lateral (
    select value as item from jsonb_array_elements(coalesce(order_metrics -> 'customers', '[]'::jsonb))
    where value ->> 'customer_code' = customer.item ->> 'codice_cliente' limit 1
  ) orders on true;
  dashboard := jsonb_set(dashboard, '{attention}', merged_rows);

  return dashboard;
end;
$$;

revoke all on function public.crm_commercial_control_order_dataset(text,date,date,text,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.crm_commercial_control_order_metrics(text,date,date,text,text,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.crm_commercial_control_dashboard_pre_oct_fix(text,date,date,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text)
  from public, anon;

grant execute on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text)
  to authenticated, service_role;
grant execute on function public.crm_commercial_control_order_dataset(text,date,date,text,text,text,text,text,text)
  to service_role;
grant execute on function public.crm_commercial_control_order_metrics(text,date,date,text,text,text,text,text,text,text)
  to service_role;

comment on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) is
  'CRM Overview: ordinato e order_count partono dalle testate reali; OCT PRIVATE autorevoli, righe economiche valide e lineage Mexal deduplicato.';

commit;
