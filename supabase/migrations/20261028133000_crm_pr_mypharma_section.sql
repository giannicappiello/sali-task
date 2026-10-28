begin;
-- PR customer segmentation is a presentation boundary, not a change to customer classification.
-- 501.00288 is the verified canonical Mexal account for MyPharma Srl.
create or replace function public.crm_b2b_order_customers(p_customer_group text,p_order_module text,p_from date,p_to date,p_agent text default null)
returns table(customer_code text) language sql stable security definer set search_path=public as $$
select distinct o.codice_cliente from public.ordini_testate o
join public.crm_customer_classifications c using(codice_cliente)
join public.ordini_clienti_cache cc using(codice_cliente)
where p_order_module in('ph','prof') and o.modulo_ordini=p_order_module
and p_customer_group in('all','regular','mypharma')
and (p_customer_group='all' or (p_order_module='prof' and ((p_customer_group='mypharma' and o.codice_cliente='501.00288') or (p_customer_group='regular' and o.codice_cliente<>'501.00288'))))
and o.data_ordine between p_from and p_to and c.area_crm='b2b'
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and o.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
order by o.codice_cliente;
$$;
CREATE OR REPLACE FUNCTION public.crm_b2b_order_dashboard_metrics(p_customer_group text,p_crm_type text, p_from date, p_to date, p_inactivity_days integer DEFAULT 90, p_agent text DEFAULT NULL::text, p_order_module text DEFAULT NULL::text)
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
    where p_crm_type='b2b' and x.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent)) and x.area_crm = p_crm_type and (nullif(p_agent,'') is null or c.codice_agente_mexal=p_agent)
      and (x.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and x.area_crm = any((select public.crm_visible_customer_areas())::text[]))
  ), verified_values as materialized (select v.* from public.crm_verified_open_order_values_v2() v join public.ordini_testate h on h.id=v.order_id where h.modulo_ordini=p_order_module), invoiced_orders as materialized (
 select distinct links.ordine_id from public.workspace_order_invoice_links(
  array(select o.id from public.ordini_testate o where o.codice_cliente in (select codice_cliente from visible_customers) and o.data_ordine between p_from and p_to)
 ) links
), invoice_by_customer as (
    select f.codice_cliente,
      count(*) filter (where f.data_documento between p_from and p_to)::bigint invoice_count,
      coalesce(sum(invoice_lines.net_amount) filter (where f.data_documento between p_from and p_to), 0)::numeric invoice_total,
      min(f.data_documento) first_invoice,
      max(f.data_documento) last_invoice
    from public.mexal_fatture_vendita f
    left join lateral(select sum(coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0)) net_amount from public.mexal_fatture_vendita_righe l where l.fattura_id=f.id) invoice_lines on true
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
    where o.modulo_ordini=p_order_module
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
    where a.codice_cliente_mexal in (select codice_cliente from visible_customers) and public.crm_row_visible(coalesce(o.responsabile_id, a.responsabile_id), coalesce(o.reparto_id, a.reparto_id), public.crm_module_for_type(p_crm_type))
  ), activity as (
    select count(*) filter (where a.stato <> 'completata' and a.data_attivita < now())::bigint overdue_followups
    from public.crm_activities a
    where a.crm_tipo = p_crm_type and exists(select 1 from public.crm_accounts ac where ac.id=a.account_id and ac.codice_cliente_mexal in (select codice_cliente from visible_customers))
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
CREATE OR REPLACE FUNCTION public.crm_b2b_order_customer_details(p_customer_group text,p_crm_type text, p_from date, p_to date, p_metric text, p_search text, p_limit integer, p_offset integer, p_customer_status text, p_order_module text DEFAULT NULL::text, p_agent text DEFAULT NULL::text)
 RETURNS TABLE(codice_cliente text, ragione_sociale text, agente_classificazione text, origine_classificazione text, modalita text, attivo_mexal boolean, crm_account_id uuid, stato_crm text, ultima_attivita_il timestamp with time zone, prossima_attivita_il timestamp with time zone, opportunita_count bigint, invoice_count bigint, invoice_total numeric, order_count bigint, order_total numeric, ultimo_ordine_il date, crm_active boolean, crm_status_changed_at timestamp with time zone, crm_status_changed_by uuid, crm_status_reason text, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with verified_values as materialized (select v.* from public.crm_verified_open_order_values_v2() v join public.ordini_testate h on h.id=v.order_id where h.modulo_ordini=p_order_module), customers as (
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
      where customer_order.modulo_ordini=p_order_module and customer_order.codice_cliente = customer.codice_cliente
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
create or replace function public.crm_b2b_order_status_counts(p_customer_group text,p_order_module text,p_from date,p_to date,p_agent text default null)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('total',count(*),'active',count(*) filter(where coalesce(s.crm_active,true)),'inactive',count(*) filter(where not coalesce(s.crm_active,true)))
from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent) c left join public.crm_customer_status s on s.customer_key='mexal:'||c.customer_code;
$$;
create or replace function public.crm_b2b_order_product_rows(p_customer_group text,p_crm_type text,p_from date,p_to date,p_agent text default null,p_order_module text default null)
returns table(category text,line_id text,document_id text,document_number text,document_date date,document_status text,
customer_code text,customer_name text,product_code text,description text,quantity numeric,unit text,net_amount numeric,line_position integer)
language sql stable security definer set search_path=public as $$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.ordini_testate o
 join public.crm_customer_classifications c on c.codice_cliente=o.codice_cliente
 join public.ordini_clienti_cache cc on cc.codice_cliente=o.codice_cliente
 where p_crm_type='b2b' and o.data_ordine between p_from and p_to and c.area_crm=p_crm_type
 and o.codice_cliente in(select public.crm_visible_canonical_customer_codes())
 and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
 and o.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent)) and o.modulo_ordini=p_order_module and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
), invoice_refs as materialized (
 select f.codice_cliente,n->>1 numero,s->>1 sigla,left(dt->>1,4) anno
 from public.mexal_fatture_vendita f
 cross join lateral jsonb_array_elements(coalesce(f.dati_mexal->'numero_ordine','[]'::jsonb)) n
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'sigla_ordine','[]'::jsonb)) s on s->>0=n->>0
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'data_ordine','[]'::jsonb)) dt on dt->>0=n->>0
 where f.sigla='FT' and f.codice_cliente in(select codice_cliente from visible_orders where modulo_ordini='prof')
), open_documents as materialized (
 select distinct o.id,d.tipo_documento from visible_orders o join public.ordini_documenti_mexal d on d.ordine_id=o.id
 where o.modulo_ordini='prof' and d.tipo_documento in ('OCM','OCX','OCI') and d.stato_operativo='APERTO'
 and d.presente_in_mexal is true and d.ultimo_sync_mexal is not null and d.numero is not null and d.anno is not null
 and not exists(select 1 from invoice_refs f where f.codice_cliente=o.codice_cliente and f.numero=d.numero
 and f.sigla=coalesce(nullif(d.sigla,''),'OC') and f.anno=coalesce(nullif(d.anno,0),extract(year from o.data_ordine)::integer)::text)

), allocations as (
 select o.id,case when o.tipo_ordine='prenotazione' then 'reserved' else 'ordered' end category,
 r.id row_id,'PH'::text kind,r.quantita::numeric quantity
 from visible_orders o join public.ordini_righe r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.ordini_righe r on r.ordine_id=o.id
)
select a.category,r.id::text||':'||a.kind,o.id::text||':'||a.kind,
 a.kind||' '||coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text),
 o.data_ordine,case when a.kind='PH' then o.stato else 'APERTO' end,o.codice_cliente,o.customer_name,
 r.codice_articolo,coalesce(nullif(r.descrizione,''),r.codice_articolo),a.quantity,
 coalesce(nullif(btrim(r.unita_misura_oct),''),nullif(btrim(r.tipo_unita_misura_mexal),'')),
 case when a.kind='PH' then coalesce(r.imponibile_riga,a.quantity*r.prezzo_netto)
 else a.quantity*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0)) end,
 coalesce(r.mexal_posizione,0)
from allocations a join visible_orders o on o.id=a.id join public.ordini_righe r on r.id=a.row_id
where a.quantity>0 and nullif(btrim(r.codice_articolo),'') is not null
and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
union all
select 'purchased','invoice:'||l.id::text,f.id::text,
 f.sigla||f.cod_modulo||' '||f.serie||'/'||f.numero,
 f.data_documento,'Documento sincronizzato',f.codice_cliente,cc.ragione_sociale,
 l.codice_articolo,coalesce(nullif(l.descrizione,''),l.codice_articolo),
 case when upper(f.sigla)='NC' then -abs(l.quantita) else l.quantita end,
 coalesce(nullif(l.dati_mexal->>'unita_misura',''),nullif(l.dati_mexal->>'um','')),
 case when upper(f.sigla)='NC' then -abs(l.valore_netto) else l.valore_netto end,
 coalesce(l.posizione,0)
from public.mexal_fatture_vendita f
join public.mexal_fatture_vendita_righe l on l.fattura_id=f.id
join public.crm_customer_classifications c on c.codice_cliente=f.codice_cliente
join public.ordini_clienti_cache cc on cc.codice_cliente=f.codice_cliente
where p_crm_type='b2b' and f.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent)) and f.data_documento between p_from and p_to and c.area_crm=p_crm_type
and f.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
;
$$;
create or replace function public.crm_b2b_order_product_summary(p_customer_group text,p_crm_type text,p_from date,p_to date,p_agent text default null,p_order_module text default null)
returns jsonb language sql stable security definer set search_path=public as $$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.ordini_testate o
 join public.crm_customer_classifications c on c.codice_cliente=o.codice_cliente
 join public.ordini_clienti_cache cc on cc.codice_cliente=o.codice_cliente
 where p_crm_type='b2b' and o.data_ordine between p_from and p_to and c.area_crm=p_crm_type
 and o.codice_cliente in(select public.crm_visible_canonical_customer_codes())
 and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
 and o.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent)) and o.modulo_ordini=p_order_module and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
), invoice_refs as materialized (
 select f.codice_cliente,n->>1 numero,s->>1 sigla,left(dt->>1,4) anno
 from public.mexal_fatture_vendita f
 cross join lateral jsonb_array_elements(coalesce(f.dati_mexal->'numero_ordine','[]'::jsonb)) n
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'sigla_ordine','[]'::jsonb)) s on s->>0=n->>0
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'data_ordine','[]'::jsonb)) dt on dt->>0=n->>0
 where f.sigla='FT' and f.codice_cliente in(select codice_cliente from visible_orders where modulo_ordini='prof')
), open_documents as materialized (
 select distinct o.id,d.tipo_documento from visible_orders o join public.ordini_documenti_mexal d on d.ordine_id=o.id
 where o.modulo_ordini='prof' and d.tipo_documento in ('OCM','OCX','OCI') and d.stato_operativo='APERTO'
 and d.presente_in_mexal is true and d.ultimo_sync_mexal is not null and d.numero is not null and d.anno is not null
 and not exists(select 1 from invoice_refs f where f.codice_cliente=o.codice_cliente and f.numero=d.numero
 and f.sigla=coalesce(nullif(d.sigla,''),'OC') and f.anno=coalesce(nullif(d.anno,0),extract(year from o.data_ordine)::integer)::text)

), allocations as (
 select o.id,case when o.tipo_ordine='prenotazione' then 'reserved' else 'ordered' end category,
 r.id row_id,'PH'::text kind,r.quantita::numeric quantity
 from visible_orders o join public.ordini_righe r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.ordini_righe r on r.ordine_id=o.id
), product_codes as (
select a.category,r.codice_articolo product_code
from allocations a join public.ordini_righe r on r.id=a.row_id
where a.quantity>0 and nullif(btrim(r.codice_articolo),'') is not null
and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
union all
select 'purchased',l.codice_articolo from public.mexal_fatture_vendita f
join public.mexal_fatture_vendita_righe l on l.fattura_id=f.id
join public.crm_customer_classifications c on c.codice_cliente=f.codice_cliente
join public.ordini_clienti_cache cc on cc.codice_cliente=f.codice_cliente
where p_crm_type='b2b' and f.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent)) and f.data_documento between p_from and p_to and c.area_crm=p_crm_type
and f.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
)
select coalesce(jsonb_object_agg(category,products),'{}'::jsonb)
from(select category,count(distinct product_code) products from product_codes group by category)s;
$$;
create or replace function public.crm_b2b_order_product_groups(p_customer_group text,p_crm_type text,p_from date,p_to date,p_agent text default null,p_category text default null,p_limit integer default 500,p_offset integer default 0,p_order_module text default null)
returns table(code text,description text,quantity numeric,documents bigint,net_amount numeric,unknown_amounts bigint)
language sql stable security definer set search_path=public as $$
 select product_code,(array_agg(description order by document_date desc,line_id))[1],sum(quantity),count(distinct document_id),
 coalesce(sum(net_amount),0),count(*) filter(where net_amount is null)
 from public.crm_b2b_order_product_rows(p_customer_group,p_crm_type,p_from,p_to,p_agent,p_order_module)
 where category=p_category
 group by product_code order by coalesce(sum(net_amount),0) desc,product_code
 limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
$$;
create or replace function public.crm_b2b_order_product_detail_lines(p_customer_group text,p_crm_type text,p_from date,p_to date,p_agent text default null,p_category text default null,p_product text default null,p_limit integer default 500,p_offset integer default 0,p_order_module text default null)
returns table(category text,line_id text,document_id text,document_number text,document_date date,document_status text,
customer_code text,customer_name text,product_code text,description text,quantity numeric,unit text,net_amount numeric,line_position integer)
language sql stable security definer set search_path=public as $$
 select * from public.crm_b2b_order_product_rows(p_customer_group,p_crm_type,p_from,p_to,p_agent,p_order_module)
 where category=p_category and product_code=p_product order by document_date desc,document_id,line_id
 limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
$$;
CREATE OR REPLACE FUNCTION public.crm_b2b_order_lifecycle_details(p_customer_group text,p_order_module text,p_from date,p_to date,p_agent text default null)
 RETURNS TABLE(codice_cliente text, ragione_sociale text, classificazione text, numero_ordini bigint, ultimo_ordine_il date, frequenza_media_giorni numeric, contatto_consigliato_il date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare settings public.crm_workflow_settings%rowtype;
begin
  if not public.crm_has_module_level('crm_b2b','lettura') and auth.role()<>'service_role' then
    raise exception 'Accesso CRM B2B non autorizzato' using errcode='42501';
  end if;
  select * into settings from public.crm_workflow_settings where crm_tipo='b2b';
  return query
  with customers as (
    select c.codice_cliente,c.ragione_sociale from public.crm_classified_customers c
    where c.area_crm='b2b' and c.crm_active and c.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent))
  ), dates as (
    select c.codice_cliente,c.ragione_sociale,o.data_ordine,
      lag(o.data_ordine) over(partition by c.codice_cliente order by o.data_ordine) previous_date
    from customers c left join public.crm_order_kpi_source o on o.codice_cliente=c.codice_cliente and o.modulo_ordini=p_order_module and o.data_ordine<=p_to
  ), stats as (
    select d.codice_cliente,d.ragione_sociale,count(d.data_ordine)::bigint order_count,
      max(d.data_ordine) last_date,avg(d.data_ordine-d.previous_date) filter(where d.previous_date is not null) average_days
    from dates d group by d.codice_cliente,d.ragione_sociale
  )
  select s.codice_cliente,s.ragione_sociale,
    case when s.order_count=0 then 'prospect' when s.order_count=1 then 'primo_ordine'
      when s.last_date>=current_date-coalesce(round(s.average_days)::int,settings.riordino_giorni_default) then 'riordino'
      when s.last_date>=current_date-(coalesce(round(s.average_days)::int,settings.riordino_giorni_default)*settings.rischio_moltiplicatore)::int then 'a_rischio'
      when s.last_date>=current_date-(coalesce(round(s.average_days)::int,settings.riordino_giorni_default)*settings.dormiente_moltiplicatore)::int then 'dormiente'
      else 'perso' end,
    s.order_count,s.last_date,round(s.average_days::numeric,1),
    s.last_date+coalesce(round(s.average_days)::int,settings.riordino_giorni_default)
  from stats s order by s.ragione_sociale,s.codice_cliente;
end;
$function$
;
create or replace function public.crm_b2b_order_cadence(p_customer_group text,p_order_module text,p_from date,p_to date,p_agent text default null)
returns table(codice_cliente text,average_gap_days numeric,expected_reorder_date date,ultimo_ordine_il date)
language sql stable set search_path=public as $$
select codice_cliente,frequenza_media_giorni,contatto_consigliato_il,ultimo_ordine_il
from public.crm_b2b_order_lifecycle_details(p_customer_group,p_order_module,p_from,p_to,p_agent);
$$;
create or replace function public.crm_b2b_order_scope_orders(p_customer_group text,p_order_module text,p_from date,p_to date,p_agent text default null)
returns table(order_id uuid) language sql stable security definer set search_path=public as $$
select o.id from public.ordini_testate o where o.modulo_ordini=p_order_module
and o.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent)) and o.data_ordine between p_from and p_to+greatest(coalesce((select beauty_post_evento_giorni from public.crm_workflow_settings where crm_tipo='b2b'),30),1) order by o.id;
$$;
revoke all on function public.crm_b2b_order_customers(text,text,date,date,text) from public,anon;
grant execute on function public.crm_b2b_order_customers(text,text,date,date,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_status_counts(text,text,date,date,text) from public,anon;
grant execute on function public.crm_b2b_order_status_counts(text,text,date,date,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_dashboard_metrics(text,text,date,date,integer,text,text) from public,anon;
grant execute on function public.crm_b2b_order_dashboard_metrics(text,text,date,date,integer,text,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_customer_details(text,text,date,date,text,text,integer,integer,text,text,text) from public,anon;
grant execute on function public.crm_b2b_order_customer_details(text,text,date,date,text,text,integer,integer,text,text,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_product_rows(text,text,date,date,text,text) from public,anon;
grant execute on function public.crm_b2b_order_product_rows(text,text,date,date,text,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_product_summary(text,text,date,date,text,text) from public,anon;
grant execute on function public.crm_b2b_order_product_summary(text,text,date,date,text,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_product_groups(text,text,date,date,text,text,integer,integer,text) from public,anon;
grant execute on function public.crm_b2b_order_product_groups(text,text,date,date,text,text,integer,integer,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_product_detail_lines(text,text,date,date,text,text,text,integer,integer,text) from public,anon;
grant execute on function public.crm_b2b_order_product_detail_lines(text,text,date,date,text,text,text,integer,integer,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_lifecycle_details(text,text,date,date,text) from public,anon;
grant execute on function public.crm_b2b_order_lifecycle_details(text,text,date,date,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_cadence(text,text,date,date,text) from public,anon;
grant execute on function public.crm_b2b_order_cadence(text,text,date,date,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_scope_orders(text,text,date,date,text) from public,anon;
grant execute on function public.crm_b2b_order_scope_orders(text,text,date,date,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
