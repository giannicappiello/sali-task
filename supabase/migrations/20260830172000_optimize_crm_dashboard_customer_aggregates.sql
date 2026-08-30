begin;

do $$
declare
  function_oid regprocedure := 'public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text)'::regprocedure;
  definition text;
  first_activity_start integer;
  purchase_dates_start integer;
  health_average_start integer;
  health_average_end integer;
  replacement text;
begin
  select pg_get_functiondef(function_oid) into definition;
  first_activity_start := strpos(definition, 'first_activity as (');
  purchase_dates_start := strpos(definition, 'purchase_dates as (');
  if first_activity_start = 0 or purchase_dates_start = 0 or purchase_dates_start <= first_activity_start then
    raise exception 'Definizione crm_commercial_control_dashboard non riconosciuta: aggregati cliente non applicati.';
  end if;

  replacement := $sql$invoice_lifetime as materialized (
    select codice_cliente, min(document_date) first_invoice, max(document_date) last_invoice,
      avg(amount)::numeric average_purchase_value
    from invoice_values group by codice_cliente
  ), order_lifetime as materialized (
    select codice_cliente, min(document_date) first_order, max(document_date) last_order
    from order_values group by codice_cliente
  ), first_activity as materialized (
    select customer.codice_cliente,
      least(invoice.first_invoice, customer_order.first_order) first_commercial_date
    from customers customer
    left join invoice_lifetime invoice using (codice_cliente)
    left join order_lifetime customer_order using (codice_cliente)
  ), current_invoice as materialized (
    select codice_cliente, count(*)::bigint document_count, coalesce(sum(amount), 0)::numeric amount
    from invoice_values where document_date between p_from and p_to group by codice_cliente
  ), current_order as materialized (
    select codice_cliente, count(*)::bigint document_count, coalesce(sum(amount), 0)::numeric amount
    from order_values where document_date between p_from and p_to group by codice_cliente
  ), comparison_invoice as (
    select coalesce(sum(amount), 0)::numeric amount
    from invoice_values where comparison_from is not null and document_date between comparison_from and comparison_to
  ), comparison_order as (
    select coalesce(sum(amount), 0)::numeric amount
    from order_values where comparison_from is not null and document_date between comparison_from and comparison_to
  ), customer_metrics as materialized (
    select customer.*,
      coalesce(invoice.document_count, 0) invoice_count,
      coalesce(invoice.amount, 0)::numeric invoice_total,
      coalesce(customer_order.document_count, 0) order_count,
      coalesce(customer_order.amount, 0)::numeric order_total,
      first_activity.first_commercial_date,
      order_lifetime.last_order last_order_date,
      invoice_lifetime.last_invoice last_invoice_date,
      invoice_lifetime.average_purchase_value
    from customers customer
    left join current_invoice invoice using (codice_cliente)
    left join current_order customer_order using (codice_cliente)
    left join first_activity using (codice_cliente)
    left join invoice_lifetime using (codice_cliente)
    left join order_lifetime using (codice_cliente)
  ), $sql$;

  definition := left(definition, first_activity_start - 1)
    || replacement
    || substring(definition from purchase_dates_start);

  health_average_start := strpos(definition, 'case when cadence.purchase_count > 0 then');
  health_average_end := strpos(definition, 'end average_purchase_value');
  if health_average_start = 0 or health_average_end = 0 or health_average_end <= health_average_start then
    raise exception 'Definizione crm_commercial_control_dashboard non riconosciuta: valore medio cliente non applicato.';
  end if;
  health_average_end := health_average_end + length('end average_purchase_value');
  definition := left(definition, health_average_start - 1)
    || 'metric.average_purchase_value as lifetime_average_purchase_value'
    || substring(definition from health_average_end + 1);

  execute definition;
end;
$$;

comment on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) is
  'Dashboard commerciali CRM server-side su righe nette reali; lifetime e metriche cliente preaggregate senza query correlate.';

commit;
