begin;

-- Count canonical parent headers once, even when OCM and OCX are both present.
CREATE OR REPLACE FUNCTION public.crm_dashboard_metrics_filtered(p_crm_type text, p_from date, p_to date, p_inactivity_days integer DEFAULT 90, p_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if p_crm_type not in ('conto_terzi', 'b2b', 'online') then
    raise exception 'Area CRM non valida.' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Intervallo CRM non valido.' using errcode = '22023';
  end if;
  if not public.crm_has_module_level(public.crm_module_for_type(p_crm_type), 'lettura')
     and auth.role() <> 'service_role' then
    raise exception 'Accesso CRM non autorizzato.' using errcode = '42501';
  end if;

  with visible_customers as (
    select c.codice_cliente, c.attivo_mexal
    from public.crm_customer_classifications x
    join public.ordini_clienti_cache c using (codice_cliente)
    where x.area_crm = p_crm_type and (nullif(p_agent,'') is null or c.codice_agente_mexal=p_agent)
      and (x.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and x.area_crm = any((select public.crm_visible_customer_areas())::text[]))
  ), verified_values as materialized (select * from public.crm_verified_open_order_values_v2()), invoiced_orders as materialized (
 select distinct links.ordine_id from public.workspace_order_invoice_links(
  array(select o.id from public.ordini_testate o where o.codice_cliente in (select codice_cliente from visible_customers) and o.data_ordine between p_from and p_to)
 ) links
), invoice_by_customer as (
    select f.codice_cliente,
      count(*) filter (where f.data_documento between p_from and p_to)::bigint invoice_count,
      coalesce(sum(f.totale_documento) filter (where f.data_documento between p_from and p_to), 0)::numeric invoice_total,
      min(f.data_documento) first_invoice,
      max(f.data_documento) last_invoice
    from public.mexal_fatture_vendita f
    join visible_customers v using (codice_cliente)
    group by f.codice_cliente
  ), order_by_customer as (
    select o.codice_cliente,
      count(distinct o.id) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id))::bigint order_count,
      coalesce(sum((select v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount from verified_values v where v.order_id=o.id)) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)), 0)::numeric order_total,
      min(o.data_ordine) first_order,
      max(o.data_ordine) last_order
    from public.ordini_testate o
    join visible_customers v using (codice_cliente)
    group by o.codice_cliente
  ), customer_metrics as (
    select v.codice_cliente, v.attivo_mexal,
      coalesce(i.invoice_count, 0) invoice_count,
      coalesce(i.invoice_total, 0) invoice_total,
      i.first_invoice, i.last_invoice,
      coalesce(o.order_count, 0) order_count,
      coalesce(o.order_total, 0) order_total,
      o.first_order, o.last_order,
      greatest(i.last_invoice, o.last_order) last_commercial_activity
    from visible_customers v
    left join invoice_by_customer i using (codice_cliente)
    left join order_by_customer o using (codice_cliente)
  ), customer_totals as (
    select
      count(*)::bigint customers,
      count(*) filter (where attivo_mexal)::bigint active_customers,
      count(*) filter (where invoice_count > 0 or order_count > 0)::bigint customers_with_activity,
      count(*) filter (where order_count > 0)::bigint customers_with_orders,
      count(*) filter (where invoice_count > 0)::bigint customers_with_invoices,
      count(*) filter (where least(first_invoice, first_order) between p_from and p_to)::bigint new_customers,
      count(*) filter (where last_commercial_activity is null or last_commercial_activity < p_to - greatest(p_inactivity_days, 1))::bigint inactive_customers,
      coalesce(sum(invoice_count), 0)::bigint invoice_count,
      coalesce(sum(invoice_total), 0)::numeric invoice_total,
      coalesce(sum(order_count), 0)::bigint order_count,
      coalesce(sum(order_total), 0)::numeric order_total
    from customer_metrics
  ), pipeline as (
    select
      count(*) filter (where not coalesce(s.finale, false))::bigint open_opportunities,
      coalesce(sum(o.valore) filter (where not coalesce(s.finale, false)), 0)::numeric pipeline_value,
      coalesce(sum(o.valore * coalesce(o.probabilita, 0) / 100.0) filter (where not coalesce(s.finale, false)), 0)::numeric weighted_pipeline,
      count(*) filter (where not coalesce(s.finale, false) and o.chiusura_prevista < current_date)::bigint overdue_opportunities
    from public.crm_opportunities o
    join public.crm_accounts a on a.id = o.account_id and a.tipo = p_crm_type
    left join public.crm_opportunity_stages s on s.id = o.stage_id
    where (nullif(p_agent,'') is null or a.codice_cliente_mexal in (select codice_cliente from visible_customers)) and public.crm_row_visible(coalesce(o.responsabile_id, a.responsabile_id), coalesce(o.reparto_id, a.reparto_id), public.crm_module_for_type(p_crm_type))
  ), activity as (
    select count(*) filter (where a.stato <> 'completata' and a.data_attivita < now())::bigint overdue_followups
    from public.crm_activities a
    where a.crm_tipo = p_crm_type and (nullif(p_agent,'') is null or exists(select 1 from public.crm_accounts ac where ac.id=a.account_id and ac.codice_cliente_mexal in (select codice_cliente from visible_customers)))
      and public.crm_row_visible(a.responsabile_id, a.reparto_id, public.crm_module_for_type(p_crm_type))
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'customers', c.customers,
    'active_customers', c.active_customers,
    'customers_with_activity', c.customers_with_activity,
    'customers_with_orders', c.customers_with_orders,
    'customers_with_invoices', c.customers_with_invoices,
    'new_customers', c.new_customers,
    'inactive_customers', c.inactive_customers,
    'invoice_count', c.invoice_count,
    'invoice_total', c.invoice_total,
    'order_count', c.order_count,
    'order_total', c.order_total,
    'ph_order_count', (select count(*) from public.ordini_testate o join visible_customers v using(codice_cliente) where o.modulo_ordini='ph' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'pr_order_count', (select count(*) from public.ordini_testate o join visible_customers v using(codice_cliente) where o.modulo_ordini='prof' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'ph_order_total', (select coalesce(sum(v.ph_amount),0) from verified_values v join public.ordini_testate o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'pr_order_total', (select coalesce(sum(v.pr_amount),0) from verified_values v join public.ordini_testate o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'stralci_order_total', (select coalesce(sum(v.stralci_amount),0) from verified_values v join public.ordini_testate o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'prenotazioni_order_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.ordini_testate o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'ph_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.ordini_testate o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='ph'),
    'pr_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.ordini_testate o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='prof'),
    'invoiced_orders_excluded', (select count(*) from invoiced_orders),
    'average_order_value', case when c.order_count > 0 then c.order_total / c.order_count else 0 end,
    'open_opportunities', p.open_opportunities,
    'pipeline_value', p.pipeline_value,
    'weighted_pipeline', p.weighted_pipeline,
    'overdue_opportunities', p.overdue_opportunities,
    'overdue_followups', a.overdue_followups,
    'order_source_note', 'Importi netti: PR OCM, Prenotazioni OCI e Stralci OCX verificati aperti e non fatturati; PH sempre ordini. Esclusione delle fatture senza limite di periodo, per singolo documento.',
    'invoice_source_note', 'Fatture di vendita Mexal sincronizzate nel Workspace.'
  ) into result
  from customer_totals c cross join pipeline p cross join activity a;

  return coalesce(result, '{}'::jsonb);
end;
$function$;

notify pgrst,'reload schema';
commit;
