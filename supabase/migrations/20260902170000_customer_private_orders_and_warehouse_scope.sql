begin;

-- Un account cliente può creare e correggere esclusivamente bozze OCT Private
-- intestate al cliente canonico collegato. Gli utenti interni mantengono le
-- policy già esistenti e nessun accesso viene esteso agli altri moduli ordine.
drop policy if exists "linked customer creates own private drafts" on public.ordini_testate;
create policy "linked customer creates own private drafts"
on public.ordini_testate for insert to authenticated
with check (
  public.workspace_current_customer_code() is not null
  and lower(coalesce(modulo_ordini, '')) = 'private'
  and lower(coalesce(stato, 'bozza')) = 'bozza'
  and public.workspace_customer_data_visible(codice_cliente)
);

drop policy if exists "linked customer updates own private drafts" on public.ordini_testate;
create policy "linked customer updates own private drafts"
on public.ordini_testate for update to authenticated
using (
  public.workspace_current_customer_code() is not null
  and lower(coalesce(modulo_ordini, '')) = 'private'
  and lower(coalesce(stato, '')) = 'bozza'
  and public.workspace_customer_data_visible(codice_cliente)
)
with check (
  public.workspace_current_customer_code() is not null
  and lower(coalesce(modulo_ordini, '')) = 'private'
  and lower(coalesce(stato, '')) = 'bozza'
  and public.workspace_customer_data_visible(codice_cliente)
);

drop policy if exists "linked customer creates lines on own private drafts" on public.ordini_righe;
create policy "linked customer creates lines on own private drafts"
on public.ordini_righe for insert to authenticated
with check (exists (
  select 1
  from public.ordini_testate parent
  where parent.id = ordine_id
    and public.workspace_current_customer_code() is not null
    and lower(coalesce(parent.modulo_ordini, '')) = 'private'
    and lower(coalesce(parent.stato, '')) = 'bozza'
    and public.workspace_customer_data_visible(parent.codice_cliente)
));

drop policy if exists "linked customer updates lines on own private drafts" on public.ordini_righe;
create policy "linked customer updates lines on own private drafts"
on public.ordini_righe for update to authenticated
using (exists (
  select 1 from public.ordini_testate parent
  where parent.id = ordine_id
    and public.workspace_current_customer_code() is not null
    and lower(coalesce(parent.modulo_ordini, '')) = 'private'
    and lower(coalesce(parent.stato, '')) = 'bozza'
    and public.workspace_customer_data_visible(parent.codice_cliente)
))
with check (exists (
  select 1 from public.ordini_testate parent
  where parent.id = ordine_id
    and public.workspace_current_customer_code() is not null
    and lower(coalesce(parent.modulo_ordini, '')) = 'private'
    and lower(coalesce(parent.stato, '')) = 'bozza'
    and public.workspace_customer_data_visible(parent.codice_cliente)
));

drop policy if exists "linked customer deletes lines on own private drafts" on public.ordini_righe;
create policy "linked customer deletes lines on own private drafts"
on public.ordini_righe for delete to authenticated
using (exists (
  select 1 from public.ordini_testate parent
  where parent.id = ordine_id
    and public.workspace_current_customer_code() is not null
    and lower(coalesce(parent.modulo_ordini, '')) = 'private'
    and lower(coalesce(parent.stato, '')) = 'bozza'
    and public.workspace_customer_data_visible(parent.codice_cliente)
));

grant insert, update on public.ordini_testate to authenticated;
grant insert, update, delete on public.ordini_righe to authenticated;

-- Dataset Magazzino unico e server-side. Per gli account cliente i codici
-- ammessi sono esclusivamente quelli presenti nelle proprie righe ordine o
-- fattura. Gli utenti interni continuano a vedere l'intero catalogo.
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
), customer_scope as materialized (
  select public.workspace_current_customer_code() as customer_code
), customer_articles as materialized (
  select distinct upper(btrim(line.codice_articolo)) as article_code
  from customer_scope scope
  join public.ordini_testate header
    on scope.customer_code is not null
   and upper(btrim(header.codice_cliente)) = upper(btrim(scope.customer_code))
  join public.ordini_righe line on line.ordine_id = header.id
  where nullif(btrim(line.codice_articolo), '') is not null
  union
  select distinct upper(btrim(line.codice_articolo)) as article_code
  from customer_scope scope
  join public.mexal_fatture_vendita invoice
    on scope.customer_code is not null
   and upper(btrim(invoice.codice_cliente)) = upper(btrim(scope.customer_code))
  join public.mexal_fatture_vendita_righe line on line.fattura_id = invoice.id
  where nullif(btrim(line.codice_articolo), '') is not null
), available_dates as (
  select array_agg(distinct snapshot_date order by snapshot_date) as dates
  from public.workspace_warehouse_stock_history
), snapshot_status as (
  select exists (
    select 1 from public.workspace_warehouse_stock_history history, parameters
    where history.snapshot_date = parameters.inventory_date
  ) as available
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
  cross join customer_scope scope
  where scope.customer_code is null
     or upper(btrim(history.article_code)) in (select article_code from customer_articles)
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
  'snapshotAvailable', snapshot_status.available,
  'customerScoped', customer_scope.customer_code is not null,
  'customerCode', customer_scope.customer_code,
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
from parameters, customer_scope, available_dates, snapshot_status, totals, type_breakdown, warehouse_breakdown, unit_breakdown, page_rows;
$$;

revoke all on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) to authenticated, service_role;

comment on function public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer) is
  'Dataset unico Magazzino; gli account cliente vedono solo articoli presenti nei propri ordini o fatture, gli interni mantengono il catalogo completo.';

commit;
