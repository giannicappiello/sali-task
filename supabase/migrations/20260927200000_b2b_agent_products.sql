begin;
CREATE OR REPLACE FUNCTION public.crm_dashboard_metrics_filtered(p_crm_type text, p_from date, p_to date, p_inactivity_days integer DEFAULT 90, p_agent text DEFAULT NULL)
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
$function$
;
CREATE OR REPLACE FUNCTION public.crm_customer_status_counts_filtered(p_crm_type text,p_agent text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with visible_customers as (
    select 'mexal:' || classification.codice_cliente as customer_key
    from public.crm_customer_classifications classification
    where classification.area_crm = p_crm_type and (nullif(p_agent,'') is null or exists(select 1 from public.ordini_clienti_cache c where c.codice_cliente=classification.codice_cliente and c.codice_agente_mexal=p_agent))
      and (classification.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and classification.area_crm = any((select public.crm_visible_customer_areas())::text[]))
    union all
    select 'crm:' || account.id::text
    from public.crm_accounts account
    where account.tipo = p_crm_type and nullif(p_agent,'') is null
      and account.codice_cliente_mexal is null
      and public.crm_row_visible(
        account.responsabile_id,
        account.reparto_id,
        public.crm_module_for_type(account.tipo)
      )
  ), measured as (
    select visible.customer_key, coalesce(status.crm_active, true) as crm_active
    from visible_customers visible
    left join public.crm_customer_status status using (customer_key)
  )
  select jsonb_build_object(
    'total', count(*)::bigint,
    'active', count(*) filter (where crm_active)::bigint,
    'inactive', count(*) filter (where not crm_active)::bigint
  )
  from measured;
$function$
;

create or replace function public.crm_b2b_agent_customers(p_limit integer default 200,p_offset integer default 0)
returns table(customer_code text,agent_code text,agent_name text)
language sql stable security definer set search_path=public as $$
select c.codice_cliente,c.codice_agente_mexal,coalesce(nullif(btrim(concat_ws(' ',a.nome,a.cognome)),''),c.codice_agente_mexal)
from public.crm_customer_classifications x join public.ordini_clienti_cache c using(codice_cliente)
left join public.mexal_agenti a on a.codice=c.codice_agente_mexal
where x.area_crm='b2b' and x.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and x.area_crm=any((select public.crm_visible_customer_areas())::text[])
order by c.codice_cliente limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
$$;

create or replace function public.crm_dashboard_product_lines(p_crm_type text,p_from date,p_to date,p_agent text default null,p_limit integer default 200,p_offset integer default 0)
returns table(category text,line_id text,document_id text,document_number text,document_date date,document_status text,
customer_code text,customer_name text,product_code text,description text,quantity numeric,unit text,net_amount numeric,line_position integer)
language sql stable security definer set search_path=public as $$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.ordini_testate o
 join public.crm_customer_classifications c on c.codice_cliente=o.codice_cliente
 join public.ordini_clienti_cache cc on cc.codice_cliente=o.codice_cliente
 where o.data_ordine between p_from and p_to and c.area_crm=p_crm_type
 and o.codice_cliente in(select public.crm_visible_canonical_customer_codes())
 and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
 and o.modulo_ordini in ('ph','prof') and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
), invoice_refs as materialized (
 select f.codice_cliente,n->>1 numero,s->>1 sigla,left(dt->>1,4) anno
 from public.mexal_fatture_vendita f
 cross join lateral jsonb_array_elements(coalesce(f.dati_mexal->'numero_ordine','[]'::jsonb)) n
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'sigla_ordine','[]'::jsonb)) s on s->>0=n->>0
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'data_ordine','[]'::jsonb)) dt on dt->>0=n->>0
 where f.sigla='FT'
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
order by a.category,o.id,a.kind,r.id
limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
$$;
revoke all on function public.crm_dashboard_metrics_filtered(text,date,date,integer,text) from public,anon;
grant execute on function public.crm_dashboard_metrics_filtered(text,date,date,integer,text) to authenticated,service_role;
revoke all on function public.crm_customer_status_counts_filtered(text,text) from public,anon;
grant execute on function public.crm_customer_status_counts_filtered(text,text) to authenticated,service_role;
revoke all on function public.crm_b2b_agent_customers(integer,integer) from public,anon;
grant execute on function public.crm_b2b_agent_customers(integer,integer) to authenticated,service_role;
revoke all on function public.crm_dashboard_product_lines(text,date,date,text,integer,integer) from public,anon;
grant execute on function public.crm_dashboard_product_lines(text,date,date,text,integer,integer) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
