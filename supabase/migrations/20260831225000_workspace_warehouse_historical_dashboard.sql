begin;

create table if not exists public.workspace_warehouse_stock_history (
  snapshot_date date not null,
  article_code text not null references public.ordini_prodotti_cache(codice_articolo) on update cascade on delete cascade,
  warehouse_number integer not null check (warehouse_number > 0),
  warehouse_name text,
  unit_of_measure text,
  on_hand numeric(18,4) not null,
  committed numeric(18,4),
  available numeric(18,4),
  unit_cost numeric(14,6) not null default 0 check (unit_cost >= 0),
  source text not null check (source in ('mexal_progressive','mexal_reconstructed')),
  source_payload jsonb not null default '{}'::jsonb,
  sync_run_id bigint references public.mexal_sync_runs(id) on delete set null,
  captured_at timestamptz not null default now(),
  primary key (snapshot_date, article_code, warehouse_number)
);

create index if not exists workspace_warehouse_stock_history_lookup_idx
  on public.workspace_warehouse_stock_history (snapshot_date, warehouse_number, article_code);

alter table public.workspace_warehouse_stock_history enable row level security;

drop policy if exists "warehouse stock history authenticated read" on public.workspace_warehouse_stock_history;
create policy "warehouse stock history authenticated read"
  on public.workspace_warehouse_stock_history for select to authenticated using (true);

grant select on public.workspace_warehouse_stock_history to authenticated;
grant select, insert, update on public.workspace_warehouse_stock_history to service_role;

create or replace function public.workspace_warehouse_dashboard(
  p_as_of_date date default current_date,
  p_warehouse integer default null,
  p_article_type text default null,
  p_unit text default null,
  p_query text default null,
  p_stock_filter text default 'all',
  p_limit integer default 100,
  p_offset integer default 0
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with parameters as (
  select
    coalesce(p_as_of_date, current_date) as inventory_date,
    nullif(nullif(upper(btrim(coalesce(p_article_type, ''))), 'TOTALE'), '') as article_type,
    nullif(nullif(upper(btrim(coalesce(p_unit, ''))), 'TUTTE'), '') as unit_filter,
    nullif(btrim(coalesce(p_query, '')), '') as search_text,
    lower(btrim(coalesce(p_stock_filter, 'all'))) as stock_filter,
    greatest(1, least(coalesce(p_limit, 100), 250)) as page_limit,
    greatest(0, coalesce(p_offset, 0)) as page_offset
), available_dates as (
  select array_agg(distinct snapshot_date order by snapshot_date) as dates
  from public.workspace_warehouse_stock_history
), inventory as (
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
    greatest(history.unit_cost, 0) as unit_cost,
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
  from public.workspace_warehouse_stock_history history
  join parameters on history.snapshot_date = parameters.inventory_date
  join public.ordini_prodotti_cache product
    on product.codice_articolo = history.article_code
   and product.mostra_in_app is true
), filtered as (
  select inventory.*
  from inventory, parameters
  where (p_warehouse is null or inventory.warehouse_number = p_warehouse)
    and (parameters.article_type is null or inventory.article_type = parameters.article_type)
    and (parameters.unit_filter is null or inventory.unit_of_measure = parameters.unit_filter)
    and (parameters.search_text is null or inventory.article_code ilike '%' || parameters.search_text || '%' or inventory.description ilike '%' || parameters.search_text || '%')
    and case parameters.stock_filter
      when 'positive' then inventory.on_hand > 0
      when 'zero' then inventory.on_hand = 0
      when 'negative' then inventory.on_hand < 0
      when 'unvalued' then inventory.unit_cost <= 0
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
    from filtered group by warehouse_number
  ) item
), unit_breakdown as (
  select coalesce(jsonb_agg(to_jsonb(item) order by item.unit_of_measure), '[]'::jsonb) as value
  from (
    select unit_of_measure, count(distinct article_code)::bigint as articles, sum(on_hand)::numeric as quantity,
      coalesce(sum(case when on_hand > 0 then on_hand * unit_cost else 0 end), 0)::numeric as stock_value
    from filtered group by unit_of_measure
  ) item
), page_rows as (
  select coalesce(jsonb_agg(to_jsonb(item) order by item.article_code, item.warehouse_number), '[]'::jsonb) as value
  from (
    select snapshot_date, article_code, description, warehouse_number, warehouse_name, unit_of_measure,
      on_hand, committed, available, unit_cost, article_type, source, captured_at,
      case when on_hand > 0 then on_hand * unit_cost else 0 end::numeric as stock_value
    from filtered
    order by article_code, warehouse_number
    limit (select page_limit from parameters)
    offset (select page_offset from parameters)
  ) item
)
select jsonb_build_object(
  'inventoryDate', parameters.inventory_date,
  'snapshotAvailable', exists(select 1 from inventory),
  'availableDates', coalesce(to_jsonb(available_dates.dates), '[]'::jsonb),
  'lastUpdated', totals.last_updated,
  'totalRows', totals.locations,
  'summary', jsonb_build_object(
    'locations', totals.locations,
    'articles', totals.articles,
    'negativeArticles', totals.negative_articles,
    'unvaluedArticles', totals.unvalued_articles,
    'stockValue', totals.stock_value
  ),
  'breakdown', jsonb_build_object('byType', type_breakdown.value, 'byWarehouse', warehouse_breakdown.value, 'byUnit', unit_breakdown.value),
  'rows', page_rows.value
)
from parameters, available_dates, totals, type_breakdown, warehouse_breakdown, unit_breakdown, page_rows;
$$;

revoke all on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) to authenticated, service_role;

comment on table public.workspace_warehouse_stock_history is
  'Snapshot inventariali append-only per data, articolo e magazzino. synchronized_at/captured_at indica solo l ultimo aggiornamento.';
comment on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) is
  'Dataset unico server-side per tabella, KPI e grafici Magazzino; le giacenze negative restano visibili ma valgono zero.';

commit;
