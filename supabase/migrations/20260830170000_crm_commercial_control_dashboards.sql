begin;

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
  result jsonb;
  comparison_from date;
  comparison_to date;
begin
  if p_scope not in ('global', 'private', 'direct') then
    raise exception 'Perimetro dashboard CRM non valido.' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Intervallo CRM non valido.' using errcode = '22023';
  end if;
  if coalesce(p_compare, 'previous_period') not in ('previous_period', 'previous_year', 'none') then
    raise exception 'Confronto CRM non valido.' using errcode = '22023';
  end if;
  if coalesce(p_market, '') not in ('', 'italy', 'foreign') then
    raise exception 'Mercato CRM non valido.' using errcode = '22023';
  end if;
  if coalesce(p_business, '') not in ('', 'PRIVATE', 'DIRECT') then
    raise exception 'Business CRM non valido.' using errcode = '22023';
  end if;
  if coalesce(p_channel, '') not in ('', 'BtoB', 'BtoC') then
    raise exception 'Canale DIRECT non valido.' using errcode = '22023';
  end if;
  if coalesce(p_granularity, 'month') not in ('day', 'week', 'month') then
    raise exception 'Granularità CRM non valida.' using errcode = '22023';
  end if;

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

  with customer_source as (
    select
      customer.codice_cliente,
      customer.ragione_sociale,
      customer.codice_agente_mexal,
      coalesce(nullif(btrim(concat_ws(' ', agent.nome, agent.cognome)), ''), customer.codice_agente_mexal, 'Senza agente') agent_name,
      upper(coalesce(nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'cod_paese'), ''), 'ND')) country_code,
      upper(coalesce(nullif(btrim(customer.cod_alternativo), ''), '')) business_code,
      upper(coalesce(nullif(btrim(customer.nome_ricerca_cf), ''), '')) channel_code,
      classification.area_crm::text crm_area,
      customer.attivo_mexal,
      coalesce(status.crm_active, true) crm_active,
      status.changed_at crm_status_changed_at
    from public.ordini_clienti_cache customer
    join public.crm_customer_classifications classification using (codice_cliente)
    left join public.mexal_agenti agent on agent.codice = customer.codice_agente_mexal
    left join public.crm_customer_status status on status.customer_key = 'mexal:' || customer.codice_cliente
    where customer.attivo_mexal is true
      and public.crm_customer_classification_visible(classification.codice_cliente, classification.area_crm)
      and (
        p_scope = 'global'
        or (p_scope = 'private' and classification.area_crm::text = 'conto_terzi')
        or (p_scope = 'direct' and classification.area_crm::text in ('b2b', 'online'))
      )
  ), customers as (
    select source.*,
      case when source.business_code = 'PRIVATE' then 'PRIVATE' else 'DIRECT' end business,
      case when source.channel_code = 'BTOB' then 'BtoB' when source.channel_code = 'BTOC' then 'BtoC' else null end channel,
      case when source.country_code = 'IT' then 'Italia' when source.country_code = 'ND' then 'Non disponibile' else 'Estero' end market
    from customer_source source
    where (coalesce(p_market, '') = ''
        or (p_market = 'italy' and source.country_code = 'IT')
        or (p_market = 'foreign' and source.country_code not in ('IT', 'ND')))
      and (coalesce(btrim(p_business), '') = '' or source.business_code = upper(btrim(p_business)))
      and (coalesce(btrim(p_country), '') = '' or source.country_code = upper(btrim(p_country)))
      and (coalesce(btrim(p_agent), '') = '' or source.codice_agente_mexal = btrim(p_agent))
      and (coalesce(btrim(p_channel), '') = '' or source.channel_code = upper(btrim(p_channel)))
      and (coalesce(btrim(p_customer), '') = ''
        or source.codice_cliente ilike '%' || btrim(p_customer) || '%'
        or source.ragione_sociale ilike '%' || btrim(p_customer) || '%')
  ), invoice_values as (
    select invoice.id, invoice.codice_cliente, invoice.data_documento document_date,
      coalesce(sum(coalesce(line.valore_netto, line.valore_lordo, line.quantita * line.prezzo_unitario, 0)), invoice.totale_imponibile, invoice.totale_documento, 0)::numeric amount
    from public.mexal_fatture_vendita invoice
    join customers customer using (codice_cliente)
    left join public.mexal_fatture_vendita_righe line on line.fattura_id = invoice.id
    group by invoice.id, invoice.codice_cliente, invoice.data_documento, invoice.totale_imponibile, invoice.totale_documento
  ), order_values as (
    select customer_order.id, customer_order.codice_cliente, customer_order.data_ordine document_date,
      coalesce(sum(coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0))
        filter (where not coalesce(line.riga_descrittiva, false) and coalesce(line.mexal_attiva, true)), customer_order.totale_imponibile, customer_order.totale_documento, 0)::numeric amount
    from public.ordini_testate customer_order
    join customers customer using (codice_cliente)
    left join public.ordini_righe line on line.ordine_id = customer_order.id
    group by customer_order.id, customer_order.codice_cliente, customer_order.data_ordine, customer_order.totale_imponibile, customer_order.totale_documento
  ), first_activity as (
    select customer.codice_cliente,
      least(
        (select min(document_date) from invoice_values invoice where invoice.codice_cliente = customer.codice_cliente),
        (select min(document_date) from order_values customer_order where customer_order.codice_cliente = customer.codice_cliente)
      ) first_commercial_date
    from customers customer
  ), current_invoice as (
    select codice_cliente, count(*)::bigint document_count, coalesce(sum(amount), 0)::numeric amount
    from invoice_values where document_date between p_from and p_to group by codice_cliente
  ), current_order as (
    select codice_cliente, count(*)::bigint document_count, coalesce(sum(amount), 0)::numeric amount
    from order_values where document_date between p_from and p_to group by codice_cliente
  ), comparison_invoice as (
    select coalesce(sum(amount), 0)::numeric amount
    from invoice_values where comparison_from is not null and document_date between comparison_from and comparison_to
  ), comparison_order as (
    select coalesce(sum(amount), 0)::numeric amount
    from order_values where comparison_from is not null and document_date between comparison_from and comparison_to
  ), customer_metrics as (
    select customer.*,
      coalesce(invoice.document_count, 0) invoice_count,
      coalesce(invoice.amount, 0)::numeric invoice_total,
      coalesce(customer_order.document_count, 0) order_count,
      coalesce(customer_order.amount, 0)::numeric order_total,
      first_activity.first_commercial_date,
      (select max(document_date) from order_values history where history.codice_cliente = customer.codice_cliente) last_order_date,
      (select max(document_date) from invoice_values history where history.codice_cliente = customer.codice_cliente) last_invoice_date
    from customers customer
    left join current_invoice invoice using (codice_cliente)
    left join current_order customer_order using (codice_cliente)
    left join first_activity using (codice_cliente)
  ), purchase_dates as (
    select distinct codice_cliente, document_date purchase_date from invoice_values
  ), purchase_intervals as (
    select codice_cliente, purchase_date,
      purchase_date - lag(purchase_date) over (partition by codice_cliente order by purchase_date) gap_days
    from purchase_dates
  ), cadence as (
    select codice_cliente, count(*)::bigint purchase_count, max(purchase_date) last_purchase,
      avg(gap_days) filter (where gap_days is not null and gap_days > 0)::numeric average_gap_days
    from purchase_intervals group by codice_cliente
  ), health as (
    select metric.*,
      cadence.purchase_count, cadence.last_purchase, round(cadence.average_gap_days, 1) average_gap_days,
      case when cadence.last_purchase is not null then (p_to - cadence.last_purchase) end days_since_purchase,
      case
        when cadence.purchase_count < 2 or cadence.average_gap_days is null then 'insufficient'
        when (p_to - cadence.last_purchase) <= cadence.average_gap_days * 0.85 then 'regular'
        when (p_to - cadence.last_purchase) <= cadence.average_gap_days * 1.15 then 'expected'
        when (p_to - cadence.last_purchase) <= cadence.average_gap_days * 1.75 then 'late'
        when (p_to - cadence.last_purchase) <= cadence.average_gap_days * 2.50 then 'risk'
        else 'lost'
      end reorder_status,
      case when cadence.average_gap_days is not null then cadence.last_purchase + ceil(cadence.average_gap_days)::integer end expected_reorder_date,
      case when cadence.purchase_count > 0 then
        (select avg(value.amount)::numeric from invoice_values value where value.codice_cliente = metric.codice_cliente)
      end average_purchase_value
    from customer_metrics metric
    left join cadence using (codice_cliente)
  ), open_document_orders as (
    select distinct document.ordine_id
    from public.ordini_documenti_mexal document
    where document.stato_operativo = 'APERTO' and coalesce(document.presente_in_mexal, true)
  ), portfolio as (
    select count(*)::bigint order_count, coalesce(sum(value.amount), 0)::numeric amount
    from open_document_orders open_document
    join order_values value on value.id = open_document.ordine_id
  ), portfolio_coverage as (
    select count(*)::bigint monitored_documents from public.ordini_documenti_mexal
  ), pipeline as (
    select count(*) filter (where not coalesce(stage.finale, false))::bigint open_count,
      coalesce(sum(opportunity.valore) filter (where not coalesce(stage.finale, false)), 0)::numeric value,
      coalesce(sum(opportunity.valore * coalesce(opportunity.probabilita, 0) / 100.0)
        filter (where not coalesce(stage.finale, false)), 0)::numeric weighted,
      count(*) filter (where not coalesce(stage.finale, false) and opportunity.chiusura_prevista < current_date)::bigint overdue
    from public.crm_opportunities opportunity
    join public.crm_accounts account on account.id = opportunity.account_id
    left join public.crm_opportunity_stages stage on stage.id = opportunity.stage_id
    where (p_scope = 'global' or (p_scope = 'private' and account.tipo = 'conto_terzi')
      or (p_scope = 'direct' and account.tipo in ('b2b', 'online')))
  ), overdue_activities as (
    select count(*)::bigint count
    from public.crm_activities activity
    where activity.stato <> 'completata' and activity.data_attivita < now()
      and (p_scope = 'global' or (p_scope = 'private' and activity.crm_tipo = 'conto_terzi')
        or (p_scope = 'direct' and activity.crm_tipo in ('b2b', 'online')))
  ), stage_performance as (
    select stage.id, stage.codice, stage.nome, stage.ordine,
      count(opportunity.id)::bigint opportunity_count,
      coalesce(sum(opportunity.valore), 0)::numeric value,
      coalesce(sum(opportunity.valore * coalesce(opportunity.probabilita, 0) / 100.0), 0)::numeric weighted_value,
      coalesce(avg(extract(epoch from (now() - opportunity.aggiornato_il)) / 86400.0), 0)::numeric average_days
    from public.crm_opportunity_stages stage
    left join public.crm_opportunities opportunity on opportunity.stage_id = stage.id
    where stage.attiva and ((p_scope = 'private' and stage.crm_tipo = 'conto_terzi')
      or (p_scope = 'direct' and stage.crm_tipo = 'b2b')
      or (p_scope = 'global' and stage.crm_tipo in ('conto_terzi', 'b2b')))
    group by stage.id, stage.codice, stage.nome, stage.ordine
  ), trend_source as (
    select date_trunc(p_granularity, document_date)::date bucket, sum(amount)::numeric invoice_total, 0::numeric order_total
    from invoice_values where document_date between p_from and p_to group by 1
    union all
    select date_trunc(p_granularity, document_date)::date bucket, 0::numeric invoice_total, sum(amount)::numeric order_total
    from order_values where document_date between p_from and p_to group by 1
  ), trend as (
    select bucket, sum(invoice_total)::numeric invoice_total, sum(order_total)::numeric order_total
    from trend_source group by bucket
  ), business_performance as (
    select health.business,
      count(*)::bigint customers,
      count(*) filter (where health.crm_active)::bigint crm_active_customers,
      sum(health.invoice_total)::numeric invoice_total,
      sum(health.order_total)::numeric order_total
    from health group by health.business
  ), agent_performance as (
    select health.codice_agente_mexal agent_code, health.agent_name,
      count(*)::bigint customers,
      count(*) filter (where health.first_commercial_date between p_from and p_to)::bigint new_customers,
      count(*) filter (where health.reorder_status in ('late', 'risk', 'lost'))::bigint declining_customers,
      sum(health.invoice_total)::numeric invoice_total,
      sum(health.order_total)::numeric order_total,
      count(*) filter (where health.reorder_status in ('regular', 'expected'))::numeric
        / nullif(count(*) filter (where health.reorder_status <> 'insufficient'), 0) reorder_rate
    from health group by health.codice_agente_mexal, health.agent_name
  ), country_performance as (
    select health.country_code,
      count(*)::bigint customers,
      sum(health.invoice_total)::numeric invoice_total,
      sum(health.order_total)::numeric order_total,
      count(distinct health.codice_agente_mexal)::bigint agents
    from health group by health.country_code
  ), acquisition as (
    select
      coalesce(sum(health.order_total) filter (where health.first_commercial_date between p_from and p_to), 0)::numeric new_customer_orders,
      coalesce(sum(health.order_total) filter (where health.first_commercial_date < p_from), 0)::numeric reorder_orders,
      coalesce(sum(health.order_total) filter (where health.first_commercial_date is null), 0)::numeric other_orders
    from health
  ), concentration_ranked as (
    select invoice_total,
      row_number() over (order by invoice_total desc, codice_cliente) rank_order
    from health
  ), concentration as (
    select coalesce(sum(invoice_total), 0)::numeric total,
      coalesce(sum(invoice_total) filter (where rank_order <= 1), 0)::numeric top_1,
      coalesce(sum(invoice_total) filter (where rank_order <= 5), 0)::numeric top_5,
      coalesce(sum(invoice_total) filter (where rank_order <= 10), 0)::numeric top_10
    from concentration_ranked
  ), totals as (
    select count(*)::bigint customers,
      count(*) filter (where crm_active)::bigint crm_active_customers,
      count(*) filter (where not crm_active)::bigint crm_inactive_customers,
      count(*) filter (where first_commercial_date between p_from and p_to)::bigint new_customers,
      count(*) filter (where reorder_status = 'lost')::bigint lost_customers,
      count(*) filter (where reorder_status in ('expected', 'late'))::bigint reorders_due,
      coalesce(sum(invoice_total), 0)::numeric invoice_total,
      coalesce(sum(invoice_count), 0)::bigint invoice_count,
      coalesce(sum(order_total), 0)::numeric order_total,
      coalesce(sum(order_count), 0)::bigint order_count,
      avg(average_gap_days) filter (where reorder_status <> 'insufficient')::numeric average_reorder_days
    from health
  )
  select jsonb_build_object(
    'scope', p_scope,
    'from', p_from,
    'to', p_to,
    'generated_at', now(),
    'comparison', jsonb_build_object(
      'mode', p_compare, 'from', comparison_from, 'to', comparison_to,
      'invoice_total', comparison_invoice.amount, 'order_total', comparison_order.amount
    ),
    'totals', jsonb_build_object(
      'invoice_total', totals.invoice_total, 'invoice_count', totals.invoice_count,
      'order_total', totals.order_total, 'order_count', totals.order_count,
      'average_order_value', totals.order_total / nullif(totals.order_count, 0),
      'customers', totals.customers, 'mexal_active_customers', totals.customers,
      'crm_active_customers', totals.crm_active_customers, 'crm_inactive_customers', totals.crm_inactive_customers,
      'new_customers', totals.new_customers, 'lost_customers', totals.lost_customers,
      'reorders_due', totals.reorders_due, 'average_reorder_days', totals.average_reorder_days,
      'portfolio_total', portfolio.amount, 'portfolio_orders', portfolio.order_count,
      'portfolio_monitored_documents', portfolio_coverage.monitored_documents,
      'pipeline_count', pipeline.open_count, 'pipeline_value', pipeline.value,
      'weighted_pipeline', pipeline.weighted, 'overdue_opportunities', pipeline.overdue,
      'overdue_activities', overdue_activities.count
    ),
    'acquisition', to_jsonb(acquisition),
    'concentration', to_jsonb(concentration),
    'business', coalesce((select jsonb_agg(to_jsonb(row) order by row.business) from business_performance row), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(to_jsonb(row) order by row.bucket) from trend row), '[]'::jsonb),
    'top_customers', coalesce((select jsonb_agg(to_jsonb(row) order by row.invoice_total desc, row.order_total desc) from (
      select codice_cliente, ragione_sociale, crm_area, channel, agent_name, country_code, crm_active, attivo_mexal,
        invoice_total, order_total, last_order_date, last_invoice_date, first_commercial_date,
        reorder_status, average_gap_days, expected_reorder_date, health.average_purchase_value
      from health order by invoice_total desc, order_total desc limit 25
    ) row), '[]'::jsonb),
    'attention', coalesce((select jsonb_agg(to_jsonb(row) order by row.priority, row.days_since_purchase desc) from (
      select codice_cliente, ragione_sociale, crm_area, channel, agent_name, invoice_total, order_total,
        last_purchase, average_gap_days, expected_reorder_date, days_since_purchase,
        reorder_status, health.average_purchase_value,
        case reorder_status when 'lost' then 1 when 'risk' then 2 when 'late' then 3 else 4 end priority
      from health where reorder_status in ('expected', 'late', 'risk', 'lost')
      order by priority, days_since_purchase desc limit 50
    ) row), '[]'::jsonb),
    'reorder_health', coalesce((select jsonb_agg(to_jsonb(row) order by row.sort_order) from (
      select reorder_status status,
        case reorder_status when 'regular' then 1 when 'expected' then 2 when 'late' then 3 when 'risk' then 4 when 'lost' then 5 else 6 end sort_order,
        count(*)::bigint customers, sum(invoice_total)::numeric historical_value,
        sum(coalesce(health.average_purchase_value, 0))::numeric potential_value,
        avg(health.average_purchase_value)::numeric average_order_value
      from health group by reorder_status
    ) row), '[]'::jsonb),
    'pipeline_stages', coalesce((select jsonb_agg(to_jsonb(row) order by row.ordine, row.nome) from stage_performance row), '[]'::jsonb),
    'agents', coalesce((select jsonb_agg(to_jsonb(row) order by row.invoice_total desc, row.agent_name) from agent_performance row), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(to_jsonb(row) order by row.invoice_total desc, row.country_code) from country_performance row), '[]'::jsonb),
    'filters', jsonb_build_object(
      'agents', coalesce((select jsonb_agg(jsonb_build_object('code', row.agent_code, 'name', row.agent_name) order by row.agent_name)
        from (select distinct codice_agente_mexal agent_code, agent_name from customer_source where codice_agente_mexal is not null) row), '[]'::jsonb),
      'countries', coalesce((select jsonb_agg(row.country_code order by row.country_code)
        from (select distinct upper(coalesce(nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_paese'), ''), 'ND')) country_code
          from public.ordini_clienti_cache where attivo_mexal is true) row), '[]'::jsonb)
    ),
    'data_gaps', jsonb_build_array(
      jsonb_build_object('dimension', 'field_force', 'available', false, 'reason', 'cod_zona Mexal è popolato ma non esiste un mapping affidabile verso Field Force Estero/Farmacia/Prof.'),
      jsonb_build_object('dimension', 'online_independent', 'available', false, 'reason', 'Nel modello reale Online coincide oggi con DIRECT/BtoC; le tabelle ecommerce non contengono clienti o ordini.'),
      jsonb_build_object('dimension', 'portfolio_coverage', 'available', portfolio_coverage.monitored_documents > 0,
        'reason', 'Portafoglio calcolato esclusivamente sui documenti Mexal monitorati con stato_operativo APERTO.',
        'monitored_documents', portfolio_coverage.monitored_documents)
    )
  ) into result
  from totals
  cross join comparison_invoice
  cross join comparison_order
  cross join portfolio
  cross join portfolio_coverage
  cross join pipeline
  cross join overdue_activities
  cross join acquisition
  cross join concentration;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) to authenticated, service_role;

comment on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) is
  'Dashboard commerciali CRM server-side su campi reali: classificazione Mexal, Paese, agente, fatture nette, ordini netti, stato CRM, pipeline/attività e riordino relativo alla frequenza individuale.';

commit;
