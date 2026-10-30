-- Group once over authorized customers instead of repeating historical scans for every customer.

CREATE OR REPLACE FUNCTION public.crm_b2b_order_customer_details(p_crm_type text, p_from date, p_to date, p_metric text, p_search text, p_limit integer, p_offset integer, p_customer_status text, p_order_module text DEFAULT NULL::text, p_agent text DEFAULT NULL::text)
 RETURNS TABLE(codice_cliente text, ragione_sociale text, agente_classificazione text, origine_classificazione text, modalita text, attivo_mexal boolean, crm_account_id uuid, stato_crm text, ultima_attivita_il timestamp with time zone, prossima_attivita_il timestamp with time zone, opportunita_count bigint, invoice_count bigint, invoice_total numeric, order_count bigint, order_total numeric, ultimo_ordine_il date, crm_active boolean, crm_status_changed_at timestamp with time zone, crm_status_changed_by uuid, crm_status_reason text, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with verified_values as materialized (select v.* from public.crm_verified_open_order_values_v2() v join public.crm_sales_orders h on h.id=v.order_id where h.modulo_ordini=p_order_module), customers as (
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
    where p_crm_type='b2b' and classification.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_order_module,p_from,p_to,p_agent)) and classification.area_crm = p_crm_type
      and (classification.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and classification.area_crm = any((select public.crm_visible_customer_areas())::text[]))
      and (nullif(btrim(p_search), '') is null
        or customer.codice_cliente ilike '%' || btrim(p_search) || '%'
        or customer.ragione_sociale ilike '%' || btrim(p_search) || '%'
        or classification.agente_classificazione ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_customer_status, 'active') = 'all'
        or (p_customer_status = 'inactive' and not coalesce(status.crm_active, true))
        or (coalesce(p_customer_status, 'active') = 'active' and coalesce(status.crm_active, true)))
  ), invoice_stats as materialized (
 select document.codice_cliente,
 count(*) filter(where document.data_documento between p_from and p_to)::bigint invoice_count,
 coalesce(sum(document.net_amount) filter(where document.data_documento between p_from and p_to),0)::numeric invoice_total,
 min(document.data_documento) first_date,max(document.data_documento) last_date
 from public.crm_invoice_line_totals document
 join customers customer on customer.codice_cliente=document.codice_cliente group by document.codice_cliente
), order_stats as materialized (
 select o.codice_cliente,
 count(distinct o.id) filter(where o.data_ordine between p_from and p_to and v.order_id is not null)::bigint order_count,
 coalesce(sum(v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount) filter(where o.data_ordine between p_from and p_to),0)::numeric order_total,
 min(o.data_ordine) first_date,max(o.data_ordine) last_date
 from public.crm_sales_orders o join customers customer on customer.codice_cliente=o.codice_cliente
 left join verified_values v on v.order_id=o.id
 where o.modulo_ordini=p_order_module group by o.codice_cliente
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
    left join invoice_stats invoice on invoice.codice_cliente=customer.codice_cliente
    left join order_stats customer_order on customer_order.codice_cliente=customer.codice_cliente
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
$function$
;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_customer_details(p_customer_group text, p_crm_type text, p_from date, p_to date, p_metric text, p_search text, p_limit integer, p_offset integer, p_customer_status text, p_order_module text DEFAULT NULL::text, p_agent text DEFAULT NULL::text)
 RETURNS TABLE(codice_cliente text, ragione_sociale text, agente_classificazione text, origine_classificazione text, modalita text, attivo_mexal boolean, crm_account_id uuid, stato_crm text, ultima_attivita_il timestamp with time zone, prossima_attivita_il timestamp with time zone, opportunita_count bigint, invoice_count bigint, invoice_total numeric, order_count bigint, order_total numeric, ultimo_ordine_il date, crm_active boolean, crm_status_changed_at timestamp with time zone, crm_status_changed_by uuid, crm_status_reason text, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with verified_values as materialized (select v.* from public.crm_verified_open_order_values_v2() v join public.crm_sales_orders h on h.id=v.order_id where h.modulo_ordini=p_order_module), customers as (
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
    where p_crm_type='b2b' and classification.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent)) and classification.area_crm = p_crm_type
      and (classification.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and classification.area_crm = any((select public.crm_visible_customer_areas())::text[]))
      and (nullif(btrim(p_search), '') is null
        or customer.codice_cliente ilike '%' || btrim(p_search) || '%'
        or customer.ragione_sociale ilike '%' || btrim(p_search) || '%'
        or classification.agente_classificazione ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_customer_status, 'active') = 'all'
        or (p_customer_status = 'inactive' and not coalesce(status.crm_active, true))
        or (coalesce(p_customer_status, 'active') = 'active' and coalesce(status.crm_active, true)))
  ), invoice_stats as materialized (
 select document.codice_cliente,
 count(*) filter(where document.data_documento between p_from and p_to)::bigint invoice_count,
 coalesce(sum(document.net_amount) filter(where document.data_documento between p_from and p_to),0)::numeric invoice_total,
 min(document.data_documento) first_date,max(document.data_documento) last_date
 from public.crm_invoice_line_totals document
 join customers customer on customer.codice_cliente=document.codice_cliente group by document.codice_cliente
), order_stats as materialized (
 select o.codice_cliente,
 count(distinct o.id) filter(where o.data_ordine between p_from and p_to and v.order_id is not null)::bigint order_count,
 coalesce(sum(v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount) filter(where o.data_ordine between p_from and p_to),0)::numeric order_total,
 min(o.data_ordine) first_date,max(o.data_ordine) last_date
 from public.crm_sales_orders o join customers customer on customer.codice_cliente=o.codice_cliente
 left join verified_values v on v.order_id=o.id
 where o.modulo_ordini=p_order_module group by o.codice_cliente
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
    left join invoice_stats invoice on invoice.codice_cliente=customer.codice_cliente
    left join order_stats customer_order on customer_order.codice_cliente=customer.codice_cliente
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
$function$
;

CREATE OR REPLACE FUNCTION public.crm_customer_metric_details(p_crm_type text, p_from date, p_to date, p_metric text, p_search text, p_limit integer, p_offset integer, p_customer_status text)
 RETURNS TABLE(codice_cliente text, ragione_sociale text, agente_classificazione text, origine_classificazione text, modalita text, attivo_mexal boolean, crm_account_id uuid, stato_crm text, ultima_attivita_il timestamp with time zone, prossima_attivita_il timestamp with time zone, opportunita_count bigint, invoice_count bigint, invoice_total numeric, order_count bigint, order_total numeric, ultimo_ordine_il date, crm_active boolean, crm_status_changed_at timestamp with time zone, crm_status_changed_by uuid, crm_status_reason text, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with verified_values as materialized (select * from public.crm_verified_open_order_values_v2()), customers as (
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
      and (classification.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and classification.area_crm = any((select public.crm_visible_customer_areas())::text[]))
      and (nullif(btrim(p_search), '') is null
        or customer.codice_cliente ilike '%' || btrim(p_search) || '%'
        or customer.ragione_sociale ilike '%' || btrim(p_search) || '%'
        or classification.agente_classificazione ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_customer_status, 'active') = 'all'
        or (p_customer_status = 'inactive' and not coalesce(status.crm_active, true))
        or (coalesce(p_customer_status, 'active') = 'active' and coalesce(status.crm_active, true)))
  ), invoice_stats as materialized (
 select document.codice_cliente,
 count(*) filter(where document.data_documento between p_from and p_to)::bigint invoice_count,
 coalesce(sum(document.net_amount) filter(where document.data_documento between p_from and p_to),0)::numeric invoice_total,
 min(document.data_documento) first_date,max(document.data_documento) last_date
 from public.crm_invoice_line_totals document
 join customers customer on customer.codice_cliente=document.codice_cliente group by document.codice_cliente
), order_stats as materialized (
 select o.codice_cliente,
 count(distinct o.id) filter(where o.data_ordine between p_from and p_to and v.order_id is not null)::bigint order_count,
 coalesce(sum(v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount) filter(where o.data_ordine between p_from and p_to),0)::numeric order_total,
 min(o.data_ordine) first_date,max(o.data_ordine) last_date
 from public.crm_sales_orders o join customers customer on customer.codice_cliente=o.codice_cliente
 left join verified_values v on v.order_id=o.id
  group by o.codice_cliente
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
    left join invoice_stats invoice on invoice.codice_cliente=customer.codice_cliente
    left join order_stats customer_order on customer_order.codice_cliente=customer.codice_cliente
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
$function$
;
