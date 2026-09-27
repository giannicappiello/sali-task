begin;

create or replace function public.crm_verified_open_order_values_v2()
returns table(order_id uuid, pr_amount numeric, stralci_amount numeric, ph_amount numeric, oct_amount numeric, prenotazioni_amount numeric)
language sql stable security invoker set search_path=public as $verified$
with candidates as materialized (
 select o.id order_id,o.codice_cliente,d.tipo_documento kind,coalesce(nullif(d.sigla,''),'OC') sigla,d.numero,coalesce(nullif(d.anno,0),extract(year from o.data_ordine)::integer) as anno,
   coalesce(
    (select sum((v->>1)::numeric) from jsonb_array_elements(d.dati_mexal->'tot_documento') v)
    - (select sum((v->>1)::numeric) from jsonb_array_elements(d.dati_mexal->'tot_iva') v),
    (select sum((case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCI' then r.quantita_oci when 'OCX' then r.quantita_ocx end)
     * coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0)))
     from public.ordini_righe r where r.ordine_id=o.id and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true))
   )::numeric amount
 from public.ordini_testate o join public.ordini_documenti_mexal d on d.ordine_id=o.id
 where o.modulo_ordini='prof' and d.tipo_documento in ('OCM','OCI','OCX')
  and d.stato_operativo='APERTO' and d.presente_in_mexal is true and d.ultimo_sync_mexal is not null
  and d.numero is not null and d.anno is not null
 union all
 select o.id,o.codice_cliente,'OCT',coalesce(nullif(o.mexal_sigla,''),'OC'),o.mexal_numero::text,coalesce(nullif(o.mexal_anno,0),extract(year from o.data_ordine)::integer),
  coalesce(o.totale_imponibile,(select sum(coalesce(r.imponibile_riga,r.quantita*r.prezzo_netto)) from public.ordini_righe r where r.ordine_id=o.id and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)))
 from public.ordini_testate o where o.modulo_ordini='private' and o.origine='mexal_oct'
  and o.mexal_sincronizzato_il is not null and o.mexal_eliminato_il is null and o.mexal_numero is not null and o.mexal_anno is not null
 union all
 select o.id,o.codice_cliente,case when o.tipo_ordine='prenotazione' then 'PH_OCI' else 'PH' end,null,null,null,
 coalesce((select sum(coalesce(r.imponibile_riga,r.quantita*r.prezzo_netto)) from public.ordini_righe r where r.ordine_id=o.id and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)),o.totale_imponibile,o.totale_documento,0)
 from public.ordini_testate o where o.modulo_ordini='ph'
), invoice_refs as materialized (
 select f.codice_cliente,n->>1 numero,s->>1 sigla,left(dt->>1,4) anno
 from public.mexal_fatture_vendita f
 cross join lateral jsonb_array_elements(coalesce(f.dati_mexal->'numero_ordine','[]'::jsonb)) n
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'sigla_ordine','[]'::jsonb)) s on s->>0=n->>0
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'data_ordine','[]'::jsonb)) dt on dt->>0=n->>0
 where f.sigla='FT'
), eligible as (
 select c.* from candidates c where c.amount is not null and not exists(
  select 1 from invoice_refs f where f.codice_cliente=c.codice_cliente and f.numero=c.numero and f.sigla=c.sigla and f.anno=c.anno::text)
)
select order_id,coalesce(sum(amount) filter(where kind='OCM'),0),
 coalesce(sum(amount) filter(where kind='OCX'),0),coalesce(sum(amount) filter(where kind='PH'),0),
 coalesce(sum(amount) filter(where kind='OCT'),0),coalesce(sum(amount) filter(where kind in ('OCI','PH_OCI')),0)
from eligible group by order_id;
$verified$;
revoke all on function public.crm_verified_open_order_values_v2() from public,anon,authenticated;
grant execute on function public.crm_verified_open_order_values_v2() to service_role;
CREATE OR REPLACE FUNCTION public.crm_dashboard_metrics(p_crm_type text, p_from date, p_to date, p_inactivity_days integer DEFAULT 90)
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
    where x.area_crm = p_crm_type
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
      count(*) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id))::bigint order_count,
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
    where public.crm_row_visible(coalesce(o.responsabile_id, a.responsabile_id), coalesce(o.reparto_id, a.reparto_id), public.crm_module_for_type(p_crm_type))
  ), activity as (
    select count(*) filter (where a.stato <> 'completata' and a.data_attivita < now())::bigint overdue_followups
    from public.crm_activities a
    where a.crm_tipo = p_crm_type
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
$function$
;
CREATE OR REPLACE FUNCTION public.crm_commercial_control_order_dataset(p_scope text, p_from date, p_to date, p_business text DEFAULT NULL::text, p_market text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_customer text DEFAULT NULL::text)
 RETURNS TABLE(order_id uuid, customer_code text, customer_name text, document_date date, amount numeric, business text, channel text, country_code text, agent_code text, agent_name text, crm_area text, order_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  , invoiced_orders as materialized (
    select distinct ordine_id from public.workspace_order_invoice_links(array(select order_id from dimensioned_orders))
  )
  select
    source.order_id,
    source.customer_code,
    source.customer_name,
    source.document_date,
    (verified.pr_amount+verified.stralci_amount+verified.ph_amount+verified.oct_amount+verified.prenotazioni_amount)::numeric,
    source.business,
    source.channel,
    source.country_code,
    source.agent_code,
    source.agent_name,
    source.crm_area,
    source.order_source
  from dimensioned_orders source join public.crm_verified_open_order_values_v2() verified on verified.order_id=source.order_id
  where source.customer_code is not null
    and source.crm_area is not null
    and (source.customer_code in (select public.crm_visible_canonical_customer_codes()) and source.crm_area = any((select public.crm_visible_customer_areas())::text[]))
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
$function$;

CREATE OR REPLACE FUNCTION public.crm_commercial_control_order_metrics(p_scope text, p_from date, p_to date, p_compare text DEFAULT 'previous_period'::text, p_business text DEFAULT NULL::text, p_market text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_customer text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select dataset.*, header.modulo_ordini, verified.pr_amount, verified.stralci_amount, verified.ph_amount, verified.oct_amount, verified.prenotazioni_amount from public.crm_commercial_control_order_dataset(
      p_scope, p_from, p_to, p_business, p_market, p_country, p_agent, p_channel, p_customer
    ) dataset join public.ordini_testate header on header.id=dataset.order_id join public.crm_verified_open_order_values_v2() verified on verified.order_id=dataset.order_id
  ), comparison_orders as materialized (
    select * from public.crm_commercial_control_order_dataset(
      p_scope,
      coalesce(comparison_from, p_from),
      coalesce(comparison_to, p_from - 1),
      p_business, p_market, p_country, p_agent, p_channel, p_customer
    )
    where comparison_from is not null
  ), current_totals as (
    select count(*)::bigint as order_count, coalesce(sum(amount), 0)::numeric as order_total, count(*) filter(where modulo_ordini='ph')::bigint ph_order_count, coalesce(sum(ph_amount),0)::numeric ph_order_total, count(*) filter(where modulo_ordini='prof')::bigint pr_order_count, coalesce(sum(pr_amount),0)::numeric pr_order_total, coalesce(sum(stralci_amount),0)::numeric stralci_order_total, coalesce(sum(oct_amount),0)::numeric oct_order_total, coalesce(sum(prenotazioni_amount),0)::numeric prenotazioni_order_total, coalesce(sum(prenotazioni_amount) filter(where modulo_ordini='ph'),0)::numeric ph_prenotazioni_total, coalesce(sum(prenotazioni_amount) filter(where modulo_ordini='prof'),0)::numeric pr_prenotazioni_total
    from current_orders
  ), comparison_totals as (
    select coalesce(sum(amount), 0)::numeric as order_total from comparison_orders
  ), business_rows as (
    select business, count(*)::bigint as order_count, coalesce(sum(amount), 0)::numeric as order_total, count(*) filter(where modulo_ordini='ph')::bigint ph_order_count, coalesce(sum(ph_amount),0)::numeric ph_order_total, count(*) filter(where modulo_ordini='prof')::bigint pr_order_count, coalesce(sum(pr_amount),0)::numeric pr_order_total, coalesce(sum(stralci_amount),0)::numeric stralci_order_total, coalesce(sum(oct_amount),0)::numeric oct_order_total, coalesce(sum(prenotazioni_amount),0)::numeric prenotazioni_order_total, coalesce(sum(prenotazioni_amount) filter(where modulo_ordini='ph'),0)::numeric ph_prenotazioni_total, coalesce(sum(prenotazioni_amount) filter(where modulo_ordini='prof'),0)::numeric pr_prenotazioni_total
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
      'ph_order_count', current_totals.ph_order_count,
      'ph_order_total', current_totals.ph_order_total,
      'pr_order_count', current_totals.pr_order_count,
      'pr_order_total', current_totals.pr_order_total, 'stralci_order_total',current_totals.stralci_order_total, 'oct_order_total',current_totals.oct_order_total, 'prenotazioni_order_total',current_totals.prenotazioni_order_total, 'ph_prenotazioni_total',current_totals.ph_prenotazioni_total, 'pr_prenotazioni_total',current_totals.pr_prenotazioni_total, 'oc_order_total',current_totals.pr_order_total+current_totals.stralci_order_total+current_totals.ph_order_total+current_totals.prenotazioni_order_total,
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
$function$;

CREATE OR REPLACE FUNCTION public.crm_commercial_control_dashboard_pre_oct_fix(p_scope text, p_from date, p_to date, p_compare text DEFAULT 'previous_period'::text, p_business text DEFAULT NULL::text, p_market text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_customer text DEFAULT NULL::text, p_granularity text DEFAULT 'month'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      upper(coalesce(nullif(btrim(customer.paese), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'cod_paese'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'codice_paese'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'paese'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'cod_nazione'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'nazione'), ''), 'ND')) country_code,
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
      and (classification.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and classification.area_crm = any((select public.crm_visible_customer_areas())::text[]))
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
  ), invoice_values as materialized (
    select invoice.id, invoice.codice_cliente, invoice.data_documento document_date,
      coalesce(sum(coalesce(line.valore_netto, line.valore_lordo, line.quantita * line.prezzo_unitario, 0)), invoice.totale_imponibile, invoice.totale_documento, 0)::numeric amount
    from public.mexal_fatture_vendita invoice
    join customers customer using (codice_cliente)
    left join public.mexal_fatture_vendita_righe line on line.fattura_id = invoice.id
    group by invoice.id, invoice.codice_cliente, invoice.data_documento, invoice.totale_imponibile, invoice.totale_documento
  ), historical_order_values as materialized (
    select customer_order.id, customer_order.codice_cliente, customer_order.data_ordine document_date,
      coalesce(sum(coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0))
        filter (where not coalesce(line.riga_descrittiva, false) and coalesce(line.mexal_attiva, true)), customer_order.totale_imponibile, customer_order.totale_documento, 0)::numeric amount
    from public.crm_order_kpi_source customer_order
    join customers customer using (codice_cliente)
    left join public.ordini_righe line on line.ordine_id = customer_order.id
    group by customer_order.id, customer_order.codice_cliente, customer_order.data_ordine, customer_order.totale_imponibile, customer_order.totale_documento
  ), invoiced_orders as materialized (
    select distinct ordine_id from public.workspace_order_invoice_links(array(select id from historical_order_values))
  ), order_values as materialized (
    select h.id,h.codice_cliente,h.document_date,(v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount)::numeric amount from historical_order_values h join public.crm_verified_open_order_values_v2() v on v.order_id=h.id
  ), invoice_lifetime as materialized (
    select codice_cliente, min(document_date) first_invoice, max(document_date) last_invoice,
      avg(amount)::numeric average_purchase_value
    from invoice_values group by codice_cliente
  ), order_lifetime as materialized (
    select codice_cliente, min(document_date) first_order, max(document_date) last_order
    from historical_order_values group by codice_cliente
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
  ), health as materialized (
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
      metric.average_purchase_value as lifetime_average_purchase_value    from customer_metrics metric
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
  ), trend as (
    select date_trunc(p_granularity, invoice.document_date)::date bucket,
      sum(invoice.amount)::numeric invoice_total,
      coalesce(sum(invoice.amount) filter (where customer.business = 'PRIVATE'), 0)::numeric private_invoice_total,
      coalesce(sum(invoice.amount) filter (where customer.business = 'DIRECT'), 0)::numeric direct_invoice_total
    from invoice_values invoice
    join customers customer using (codice_cliente)
    where invoice.document_date between p_from and p_to
    group by 1
  ), business_performance as (
    select health.business,
      count(*)::bigint customers,
      count(*) filter (where health.crm_active)::bigint crm_active_customers,
      sum(health.invoice_total)::numeric invoice_total,
      sum(health.order_total)::numeric order_total
    from health group by health.business
  ), direct_breakdown as (
    select
      coalesce(sum(invoice_total) filter (where business = 'DIRECT' and channel = 'BtoB'), 0)::numeric btob_invoice_total,
      coalesce(sum(invoice_total) filter (where business = 'DIRECT' and channel = 'BtoC'), 0)::numeric btoc_invoice_total,
      coalesce(sum(invoice_total) filter (where business = 'DIRECT' and country_code not in ('IT', 'ND')), 0)::numeric foreign_invoice_total
    from health
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
    'direct_breakdown', coalesce((select to_jsonb(row) from direct_breakdown row), '{}'::jsonb),
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
        from (select distinct upper(coalesce(nullif(btrim(paese), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_paese'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'codice_paese'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'paese'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_nazione'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'nazione'), ''), 'ND')) country_code
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
$function$;

CREATE OR REPLACE FUNCTION public.crm_commercial_control_dashboard(p_scope text, p_from date, p_to date, p_compare text DEFAULT 'previous_period'::text, p_business text DEFAULT NULL::text, p_market text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_customer text DEFAULT NULL::text, p_granularity text DEFAULT 'month'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'order_count', coalesce((orders.item ->> 'order_count')::bigint, 0),
      'ph_order_count', coalesce((orders.item ->> 'ph_order_count')::numeric, 0),
      'ph_order_total', coalesce((orders.item ->> 'ph_order_total')::numeric, 0),
      'pr_order_count', coalesce((orders.item ->> 'pr_order_count')::numeric, 0),
      'pr_order_total', coalesce((orders.item ->> 'pr_order_total')::numeric, 0), 'stralci_order_total', coalesce((orders.item ->> 'stralci_order_total')::numeric, 0), 'oct_order_total', coalesce((orders.item ->> 'oct_order_total')::numeric, 0), 'prenotazioni_order_total', coalesce((orders.item ->> 'prenotazioni_order_total')::numeric, 0), 'ph_prenotazioni_total', coalesce((orders.item ->> 'ph_prenotazioni_total')::numeric, 0), 'pr_prenotazioni_total', coalesce((orders.item ->> 'pr_prenotazioni_total')::numeric, 0)
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
$function$;

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
  ), invoiced_orders as materialized (
 select distinct links.ordine_id from public.workspace_order_invoice_links(
  array(select o.id from public.ordini_testate o where o.codice_cliente in (select codice_cliente from customers) and o.data_ordine between p_from and p_to)
 ) links
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
        count(distinct customer_order.id) filter (where customer_order.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=customer_order.id))::bigint order_count,
        coalesce(sum(v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount) filter(where customer_order.data_ordine between p_from and p_to),0)::numeric order_total,
        min(customer_order.data_ordine) first_date,
        max(customer_order.data_ordine) last_date
      from public.ordini_testate customer_order
      left join verified_values v on v.order_id=customer_order.id
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
$function$
;


notify pgrst, 'reload schema';
commit;
