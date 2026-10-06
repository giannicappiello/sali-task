begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- Read the most recent inventory day in one batch. Only article/warehouse
-- pairs absent from that day require an indexed lookup of older history.
-- Preserve the same JSON, filters, customer aggregation and authorization.
CREATE OR REPLACE FUNCTION public.workspace_warehouse_dashboard(p_as_of_date date DEFAULT CURRENT_DATE, p_warehouse integer DEFAULT NULL::integer, p_article_type text DEFAULT NULL::text, p_unit text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_stock_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with parameters as (
  select
    coalesce(p_as_of_date, current_date) as inventory_date,
    nullif(nullif(upper(btrim(coalesce(p_article_type, ''))), 'TOTALE'), '') as article_type,
    nullif(nullif(upper(btrim(coalesce(p_unit, ''))), 'TUTTE'), '') as unit_filter,
    nullif(btrim(coalesce(p_query, '')), '') as search_text,
    lower(btrim(coalesce(p_stock_filter, 'all'))) as stock_filter,
    greatest(1, least(coalesce(p_limit, 100), 250)) as page_limit,
    greatest(0, coalesce(p_offset, 0)) as page_offset
), customer_scope as materialized (
  select public.workspace_current_customer_code() as customer_code,
    auth.role() = 'service_role' as all_customers,
    array(select upper(btrim(code)) from unnest(public.workspace_current_customer_codes()) code) as customer_codes
), customer_articles as materialized (
  select distinct upper(btrim(line.codice_articolo)) as article_code
  from customer_scope scope
  join public.ordini_testate header
    on scope.customer_code is not null
   and (scope.all_customers or upper(btrim(header.codice_cliente)) = any(scope.customer_codes))
  join public.ordini_righe line on line.ordine_id = header.id
  where nullif(btrim(line.codice_articolo), '') is not null
  union
  select distinct upper(btrim(line.codice_articolo)) as article_code
  from customer_scope scope
  join public.mexal_fatture_vendita invoice
    on scope.customer_code is not null
   and (scope.all_customers or upper(btrim(invoice.codice_cliente)) = any(scope.customer_codes))
  join public.mexal_fatture_vendita_righe line on line.fattura_id = invoice.id
  where nullif(btrim(line.codice_articolo), '') is not null
), available_dates as (
  select array_agg(distinct snapshot_date order by snapshot_date) as dates,
    array_agg(distinct warehouse_number order by warehouse_number) as warehouses
  from public.workspace_warehouse_stock_history
), snapshot_status as (
  select exists (
    select 1 from public.workspace_warehouse_stock_history history, parameters
    where history.snapshot_date <= parameters.inventory_date
  ) as available
), latest_day_rows as materialized (
  select h.* from public.workspace_warehouse_stock_history h
  where h.snapshot_date = (
    select max(day) from available_dates, parameters, unnest(available_dates.dates) day
    where day <= parameters.inventory_date
  )
), raw_inventory as materialized (
  select
    history.snapshot_date,
    history.article_code,
    coalesce(product.descrizione, history.article_code) as description,
    history.warehouse_number,
    history.warehouse_name,
    upper(coalesce(nullif(btrim(history.unit_of_measure), ''), nullif(btrim(product.unita_misura), ''), 'SENZA UDM')) as unit_of_measure,
    history.on_hand,
    history.committed,
    history.available,
    case when scope.customer_code is null then greatest(history.unit_cost, 0) else null::numeric end as unit_cost,
    history.source,
    history.captured_at,
    case
      when history.article_code ilike 'MKT%' then 'MKT'
      when history.article_code ilike 'MP%' then 'MP'
      when history.article_code ilike 'IT%' then 'IT'
      when history.article_code ilike 'CN%' then 'CN'
      when history.article_code ilike 'FP%' then 'FP'
      when history.article_code ilike 'AS%' then 'AS'
      when history.article_code ilike 'TB%' then 'TB'
      else 'ALTRI'
    end as article_type
  from public.ordini_prodotti_cache product
  cross join parameters
  cross join customer_scope scope
  cross join available_dates
  cross join lateral unnest(available_dates.warehouses) as location(warehouse_number)
  left join latest_day_rows recent
    on recent.article_code = product.codice_articolo and recent.warehouse_number = location.warehouse_number
  left join lateral (
    select h.snapshot_date,h.article_code,h.warehouse_number,h.warehouse_name,h.unit_of_measure,
      h.on_hand,h.committed,h.available,h.unit_cost,h.source,h.captured_at
    from public.workspace_warehouse_stock_history h
    where recent.article_code is null and h.article_code = product.codice_articolo
      and h.warehouse_number = location.warehouse_number and h.snapshot_date <= parameters.inventory_date
    order by h.snapshot_date desc,h.captured_at desc limit 1
  ) previous on true
  cross join lateral (
    select recent.snapshot_date,recent.article_code,recent.warehouse_number,recent.warehouse_name,recent.unit_of_measure,recent.on_hand,recent.committed,recent.available,recent.unit_cost,recent.source,recent.captured_at where recent.article_code is not null
    union all
    select previous.snapshot_date,previous.article_code,previous.warehouse_number,previous.warehouse_name,previous.unit_of_measure,previous.on_hand,previous.committed,previous.available,previous.unit_cost,previous.source,previous.captured_at where previous.article_code is not null
  ) history
  where product.mostra_in_app is true
    and (scope.customer_code is null
      or upper(btrim(product.codice_articolo)) in (select article_code from customer_articles))
), inventory as (
  select raw_inventory.*
  from raw_inventory
  cross join customer_scope scope
  where scope.customer_code is null
  union all
  select
    raw.snapshot_date,
    raw.article_code,
    max(raw.description) as description,
    null::integer as warehouse_number,
    null::text as warehouse_name,
    raw.unit_of_measure,
    sum(raw.on_hand)::numeric as on_hand,
    case when count(raw.committed) = 0 then null else sum(raw.committed)::numeric end as committed,
    case when count(raw.available) = 0 then null else sum(raw.available)::numeric end as available,
    max(raw.unit_cost)::numeric as unit_cost,
    null::text as source,
    max(raw.captured_at) as captured_at,
    raw.article_type
  from raw_inventory raw
  cross join customer_scope scope
  where scope.customer_code is not null
  group by raw.snapshot_date, raw.article_code, raw.unit_of_measure, raw.article_type
), filtered as (
  select inventory.*
  from inventory
  cross join parameters
  cross join customer_scope scope
  where (scope.customer_code is not null or p_warehouse is null or inventory.warehouse_number = p_warehouse)
    and (parameters.article_type is null or inventory.article_type = parameters.article_type)
    and (parameters.unit_filter is null or inventory.unit_of_measure = parameters.unit_filter)
    and (parameters.search_text is null or inventory.article_code ilike '%' || parameters.search_text || '%' or inventory.description ilike '%' || parameters.search_text || '%')
    and case parameters.stock_filter
      when 'positive' then inventory.on_hand > 0
      when 'zero' then inventory.on_hand = 0
      when 'negative' then inventory.on_hand < 0
      when 'unvalued' then scope.customer_code is not null or inventory.unit_cost <= 0
      else true
    end
), totals as (
  select
    count(*)::bigint as locations,
    count(distinct article_code)::bigint as articles,
    count(distinct article_code) filter (where on_hand < 0)::bigint as negative_articles,
    count(distinct article_code) filter (where unit_cost <= 0)::bigint as unvalued_articles,
    coalesce(sum(case when on_hand > 0 then on_hand * unit_cost else 0 end), 0)::numeric as stock_value,
    max(captured_at) as last_updated
  from filtered
), type_breakdown as (
  select coalesce(jsonb_agg(to_jsonb(item) order by item.stock_value desc, item.article_type), '[]'::jsonb) as value
  from (
    select article_type, count(distinct article_code)::bigint as articles,
      coalesce(sum(case when on_hand > 0 then on_hand * unit_cost else 0 end), 0)::numeric as stock_value
    from filtered group by article_type
  ) item
), warehouse_breakdown as (
  select coalesce(jsonb_agg(to_jsonb(item) order by item.warehouse_number), '[]'::jsonb) as value
  from (
    select warehouse_number, max(warehouse_name) as warehouse_name, count(distinct article_code)::bigint as articles,
      coalesce(sum(case when on_hand > 0 then on_hand * unit_cost else 0 end), 0)::numeric as stock_value
    from filtered
    cross join customer_scope scope
    where scope.customer_code is null
    group by warehouse_number
  ) item
), unit_breakdown as (
  select coalesce(jsonb_agg(to_jsonb(item) order by item.unit_of_measure), '[]'::jsonb) as value
  from (
    select unit_of_measure, count(distinct article_code)::bigint as articles, sum(on_hand)::numeric as quantity,
      coalesce(sum(case when on_hand > 0 then on_hand * unit_cost else 0 end), 0)::numeric as stock_value
    from filtered group by unit_of_measure
  ) item
), page_rows as (
  select coalesce(jsonb_agg(
    case when scope.customer_code is not null
      then to_jsonb(item) - 'warehouse_number' - 'warehouse_name' - 'source' - 'unit_cost' - 'stock_value'
      else to_jsonb(item)
    end order by item.article_code, item.warehouse_number
  ), '[]'::jsonb) as value
  from (
    select snapshot_date, article_code, description, warehouse_number, warehouse_name, unit_of_measure,
      on_hand, committed, available, unit_cost, article_type, source, captured_at,
      case when on_hand > 0 then on_hand * unit_cost else 0 end::numeric as stock_value
    from filtered
    order by article_code, warehouse_number
    limit (select page_limit from parameters)
    offset (select page_offset from parameters)
  ) item
  cross join customer_scope scope
)
select jsonb_build_object(
  'inventoryDate', parameters.inventory_date,
  'snapshotAvailable', snapshot_status.available,
  'customerScoped', customer_scope.customer_code is not null,
  'customerCode', customer_scope.customer_code,
  'availableDates', coalesce(to_jsonb(available_dates.dates), '[]'::jsonb),
  'lastUpdated', totals.last_updated,
  'totalRows', totals.locations,
  'summary', (jsonb_build_object(
    'locations', totals.locations,
    'articles', totals.articles,
    'negativeArticles', totals.negative_articles,
    'unvaluedArticles', totals.unvalued_articles,
    'stockValue', totals.stock_value
  ) - case when customer_scope.customer_code is not null then array['stockValue','unvaluedArticles'] else array[]::text[] end),
  'breakdown', jsonb_build_object('byType', case when customer_scope.customer_code is null then type_breakdown.value else (select coalesce(jsonb_agg(value - 'stock_value'), '[]'::jsonb) from jsonb_array_elements(type_breakdown.value)) end, 'byWarehouse', warehouse_breakdown.value, 'byUnit', case when customer_scope.customer_code is null then unit_breakdown.value else (select coalesce(jsonb_agg(value - 'stock_value'), '[]'::jsonb) from jsonb_array_elements(unit_breakdown.value)) end),
  'rows', page_rows.value
)
from parameters, customer_scope, available_dates, snapshot_status, totals, type_breakdown, warehouse_breakdown, unit_breakdown, page_rows;
$function$
;

revoke all on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) to authenticated, service_role;
comment on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) is
  'Dashboard Magazzino: ultima data letta insieme, recupero indicizzato delle giacenze mancanti; filtri e visibilita invariati.';
commit;