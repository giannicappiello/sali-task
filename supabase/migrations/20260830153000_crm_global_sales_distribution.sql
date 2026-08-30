begin;

create or replace function public.crm_global_sales_distribution(
  p_from date,
  p_to date,
  p_macro text default null,
  p_area text default null,
  p_customer_status text default 'all',
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Intervallo CRM non valido.' using errcode = '22023';
  end if;
  if coalesce(p_macro, '') not in ('', 'private', 'direct') then
    raise exception 'Blocco CRM non valido.' using errcode = '22023';
  end if;
  if coalesce(p_area, '') not in ('', 'conto_terzi', 'b2b', 'online') then
    raise exception 'Canale CRM non valido.' using errcode = '22023';
  end if;
  if coalesce(p_customer_status, 'all') not in ('all', 'active', 'inactive') then
    raise exception 'Stato cliente CRM non valido.' using errcode = '22023';
  end if;
  if auth.role() <> 'service_role' and not public.workspace_user_is_admin() then
    raise exception 'Dashboard globale CRM riservata agli amministratori Workspace.' using errcode = '42501';
  end if;

  with visible_customers as (
    select customer.codice_cliente
    from public.ordini_clienti_cache customer
    join public.crm_customer_classifications classification using (codice_cliente)
    left join public.crm_customer_status status
      on status.customer_key = 'mexal:' || customer.codice_cliente
    where customer.attivo_mexal is true
      and (p_macro is null or p_macro = ''
        or (p_macro = 'private' and classification.area_crm::text = 'conto_terzi')
        or (p_macro = 'direct' and classification.area_crm::text in ('b2b', 'online')))
      and (p_area is null or p_area = '' or classification.area_crm::text = p_area)
      and (coalesce(p_customer_status, 'all') = 'all'
        or (p_customer_status = 'active' and coalesce(status.crm_active, true))
        or (p_customer_status = 'inactive' and not coalesce(status.crm_active, true)))
      and (coalesce(btrim(p_search), '') = ''
        or customer.codice_cliente ilike '%' || btrim(p_search) || '%'
        or customer.ragione_sociale ilike '%' || btrim(p_search) || '%')
  ), product_catalog as (
    select distinct on (product.codice_mexal)
      product.codice_mexal,
      coalesce(nullif(btrim(product.categoria_mexal), ''), nullif(btrim(product.categoria), ''), 'Senza categoria') as category,
      coalesce(nullif(btrim(product.sottocategoria_mexal), ''), nullif(btrim(product.sottocategoria), ''), 'Senza sottocategoria') as subcategory
    from public.prodotti product
    where coalesce(btrim(product.codice_mexal), '') <> ''
    order by product.codice_mexal, product.updated_at desc nulls last
  ), invoice_documents as (
    select count(*)::bigint invoice_count,
      coalesce(sum(invoice.totale_documento), 0)::numeric invoice_total
    from public.mexal_fatture_vendita invoice
    join visible_customers customer using (codice_cliente)
    where invoice.data_documento between p_from and p_to
  ), order_documents as (
    select count(*)::bigint order_count,
      coalesce(sum(customer_order.totale_documento), 0)::numeric order_total
    from public.ordini_testate customer_order
    join visible_customers customer using (codice_cliente)
    where customer_order.data_ordine between p_from and p_to
  ), invoice_lines as (
    select
      coalesce(product.category, 'Senza categoria') as category,
      coalesce(product.subcategory, 'Senza sottocategoria') as subcategory,
      coalesce(line.valore_netto, line.valore_lordo, line.quantita * line.prezzo_unitario, 0)::numeric as amount,
      coalesce(line.quantita, 0)::numeric as pieces
    from public.mexal_fatture_vendita invoice
    join visible_customers customer using (codice_cliente)
    join public.mexal_fatture_vendita_righe line on line.fattura_id = invoice.id
    left join product_catalog product on product.codice_mexal = line.codice_articolo
    where invoice.data_documento between p_from and p_to
      and coalesce(btrim(line.codice_articolo), '') <> ''
  ), order_lines as (
    select
      coalesce(product.category, 'Senza categoria') as category,
      coalesce(product.subcategory, 'Senza sottocategoria') as subcategory,
      coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0)::numeric as amount,
      coalesce(line.quantita, 0)::numeric as pieces
    from public.ordini_testate customer_order
    join visible_customers customer using (codice_cliente)
    join public.ordini_righe line on line.ordine_id = customer_order.id
    left join product_catalog product on product.codice_mexal = line.codice_articolo
    where customer_order.data_ordine between p_from and p_to
      and not coalesce(line.riga_descrittiva, false)
      and coalesce(line.mexal_attiva, true)
      and coalesce(btrim(line.codice_articolo), '') <> ''
  ), invoice_categories as (
    select category, sum(amount)::numeric invoice_amount, sum(pieces)::numeric invoice_pieces
    from invoice_lines group by category
  ), order_categories as (
    select category, sum(amount)::numeric order_amount, sum(pieces)::numeric order_pieces
    from order_lines group by category
  ), categories as (
    select coalesce(invoice.category, customer_order.category) category,
      coalesce(invoice.invoice_amount, 0)::numeric invoice_amount,
      coalesce(customer_order.order_amount, 0)::numeric order_amount,
      coalesce(invoice.invoice_pieces, 0)::numeric invoice_pieces,
      coalesce(customer_order.order_pieces, 0)::numeric order_pieces
    from invoice_categories invoice
    full join order_categories customer_order using (category)
  ), invoice_subcategories as (
    select category, subcategory, sum(amount)::numeric invoice_amount, sum(pieces)::numeric invoice_pieces
    from invoice_lines group by category, subcategory
  ), order_subcategories as (
    select category, subcategory, sum(amount)::numeric order_amount, sum(pieces)::numeric order_pieces
    from order_lines group by category, subcategory
  ), subcategories as (
    select coalesce(invoice.category, customer_order.category) category,
      coalesce(invoice.subcategory, customer_order.subcategory) subcategory,
      coalesce(invoice.invoice_amount, 0)::numeric invoice_amount,
      coalesce(customer_order.order_amount, 0)::numeric order_amount,
      coalesce(invoice.invoice_pieces, 0)::numeric invoice_pieces,
      coalesce(customer_order.order_pieces, 0)::numeric order_pieces
    from invoice_subcategories invoice
    full join order_subcategories customer_order using (category, subcategory)
  ), line_totals as (
    select
      coalesce((select sum(pieces) from invoice_lines), 0)::numeric invoice_pieces,
      coalesce((select sum(pieces) from order_lines), 0)::numeric order_pieces
  ), invoice_customer_metrics as (
    select invoice.codice_cliente,
      coalesce(sum(coalesce(line.valore_netto, line.valore_lordo, line.quantita * line.prezzo_unitario, 0)), 0)::numeric invoice_net
    from public.mexal_fatture_vendita invoice
    join visible_customers customer using (codice_cliente)
    left join public.mexal_fatture_vendita_righe line on line.fattura_id = invoice.id
    where invoice.data_documento between p_from and p_to
    group by invoice.codice_cliente
  ), order_customer_metrics as (
    select customer_order.codice_cliente,
      coalesce(sum(coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0))
        filter (where not coalesce(line.riga_descrittiva, false) and coalesce(line.mexal_attiva, true)), 0)::numeric order_net
    from public.ordini_testate customer_order
    join visible_customers customer using (codice_cliente)
    left join public.ordini_righe line on line.ordine_id = customer_order.id
    where customer_order.data_ordine between p_from and p_to
    group by customer_order.codice_cliente
  ), customer_metrics as (
    select customer.codice_cliente,
      coalesce(invoice.invoice_net, 0)::numeric invoice_net,
      coalesce(customer_order.order_net, 0)::numeric order_net
    from visible_customers customer
    left join invoice_customer_metrics invoice using (codice_cliente)
    left join order_customer_metrics customer_order using (codice_cliente)
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'generated_at', now(),
    'totals', jsonb_build_object(
      'invoice_total', invoice.invoice_total,
      'invoice_count', invoice.invoice_count,
      'invoice_pieces', lines.invoice_pieces,
      'order_total', customer_order.order_total,
      'order_count', customer_order.order_count,
      'order_pieces', lines.order_pieces
    ),
    'customers', coalesce((
      select jsonb_agg(to_jsonb(customer) order by customer.codice_cliente)
      from customer_metrics customer
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(ranked) order by ranked.rank_order)
      from (
        select row_number() over (order by greatest(invoice_amount, order_amount) desc, category) rank_order,
          category as label, invoice_amount, order_amount, invoice_pieces, order_pieces
        from categories
        order by greatest(invoice_amount, order_amount) desc, category
        limit 12
      ) ranked
    ), '[]'::jsonb),
    'subcategories', coalesce((
      select jsonb_agg(to_jsonb(ranked) order by ranked.rank_order)
      from (
        select row_number() over (order by greatest(invoice_amount, order_amount) desc, category, subcategory) rank_order,
          category, subcategory as label, invoice_amount, order_amount, invoice_pieces, order_pieces
        from subcategories
        order by greatest(invoice_amount, order_amount) desc, category, subcategory
        limit 16
      ) ranked
    ), '[]'::jsonb)
  ) into result
  from invoice_documents invoice
  cross join order_documents customer_order
  cross join line_totals lines;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.crm_global_sales_distribution(date,date,text,text,text,text) from public, anon;
grant execute on function public.crm_global_sales_distribution(date,date,text,text,text,text) to authenticated, service_role;

comment on function public.crm_global_sales_distribution(date,date,text,text,text,text) is
  'KPI globali CRM: fatturato e pezzi da fatture Mexal, ordinato/ordini/pezzi da Workspace, distribuiti per categoria e sottocategoria prodotto.';

-- Mantiene il contratto dell'elenco clienti CRM, ma rende i due importi
-- esplicitamente netti aggregando le righe anziché i totali documento.
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
  codice_cliente text, ragione_sociale text, agente_classificazione text,
  origine_classificazione text, modalita text, attivo_mexal boolean,
  crm_account_id uuid, stato_crm text, ultima_attivita_il timestamptz,
  prossima_attivita_il timestamptz, opportunita_count bigint,
  invoice_count bigint, invoice_total numeric, order_count bigint,
  order_total numeric, ultimo_ordine_il date, crm_active boolean,
  crm_status_changed_at timestamptz, crm_status_changed_by uuid,
  crm_status_reason text, total_count bigint
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
      and public.crm_customer_classification_visible(classification.codice_cliente, classification.area_crm)
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
        and public.crm_row_visible(candidate.responsabile_id, candidate.reparto_id, public.crm_module_for_type(candidate.tipo))
      order by candidate.aggiornato_il desc limit 1
    ) account on true
    left join lateral (
      select count(*)::bigint opportunita_count
      from public.crm_opportunities opportunity
      where opportunity.account_id = account.id
    ) opportunities on true
    left join lateral (
      select
        count(distinct document.id) filter (where document.data_documento between p_from and p_to)::bigint invoice_count,
        coalesce(sum(coalesce(line.valore_netto, line.valore_lordo, line.quantita * line.prezzo_unitario, 0))
          filter (where document.data_documento between p_from and p_to), 0)::numeric invoice_total,
        min(document.data_documento) first_date,
        max(document.data_documento) last_date
      from public.mexal_fatture_vendita document
      left join public.mexal_fatture_vendita_righe line on line.fattura_id = document.id
      where document.codice_cliente = customer.codice_cliente
    ) invoice on true
    left join lateral (
      select
        count(distinct customer_order.id) filter (where customer_order.data_ordine between p_from and p_to)::bigint order_count,
        coalesce(sum(coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0))
          filter (where customer_order.data_ordine between p_from and p_to
            and not coalesce(line.riga_descrittiva, false)
            and coalesce(line.mexal_attiva, true)), 0)::numeric order_total,
        min(customer_order.data_ordine) first_date,
        max(customer_order.data_ordine) last_date
      from public.ordini_testate customer_order
      left join public.ordini_righe line on line.ordine_id = customer_order.id
      where customer_order.codice_cliente = customer.codice_cliente
    ) customer_order on true
  ), filtered as (
    select * from measured metric
    where coalesce(p_metric, '') in ('', 'all')
      or (p_metric = 'active' and (metric.invoice_count > 0 or metric.order_count > 0))
      or (p_metric = 'invoiced' and metric.invoice_count > 0)
      or (p_metric = 'ordered' and metric.order_count > 0)
      or (p_metric = 'new' and coalesce(least(metric.first_invoice, metric.first_order), metric.first_invoice, metric.first_order) between p_from and p_to)
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

revoke all on function public.crm_customer_metric_details(text,date,date,text,text,integer,integer,text) from public, anon;
grant execute on function public.crm_customer_metric_details(text,date,date,text,text,integer,integer,text) to authenticated, service_role;

comment on function public.crm_customer_metric_details(text,date,date,text,text,integer,integer,text) is
  'Elenco clienti CRM con fatturato netto da righe fattura Mexal e ordinato netto da righe ordine Workspace nel periodo.';

commit;
