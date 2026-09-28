begin;
create or replace function public.crm_private_dashboard_details(
 p_metric text,p_from date,p_to date,p_market text default null,p_country text default null,
 p_agent text default null,p_customer text default null,p_limit integer default 200,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path=public as $$
declare p_scope text := 'private'; p_business text := 'PRIVATE'; p_channel text := null;
begin
 if p_metric not in ('invoices','oct','customers','new','reorders','pipeline','forecast') or p_metric is null then raise exception 'Dettaglio non valido'; end if;
 if p_from is null or p_to is null or p_from > p_to then raise exception 'Periodo non valido'; end if;
 if not public.crm_has_module_level(public.crm_module_for_type('conto_terzi'),'lettura') then raise exception 'Accesso CRM Private non autorizzato' using errcode='42501'; end if;
 return query
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
    from invoice_values where false and document_date between p_from and p_to
  ), comparison_order as (
    select coalesce(sum(amount), 0)::numeric amount
    from order_values where false and document_date between p_from and p_to
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
  ), detail_rows as (
 select i.id::text id, 'invoice'::text kind, concat_ws(' ',i.sigla,concat(i.serie,'/',i.numero)) title,
 c.codice_cliente customer_code,c.ragione_sociale customer_name,v.document_date,v.amount,
 null::numeric probability,null::numeric weighted,null::text status
 from invoice_values v join mexal_fatture_vendita i on i.id=v.id join customers c on c.codice_cliente=v.codice_cliente
 where p_metric='invoices' and v.document_date between p_from and p_to
 union all
 select ds.order_id::text,'order',coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text),
 ds.customer_code,ds.customer_name,ds.document_date,v.oct_amount,null,null,'OCT aperto'
 from crm_commercial_control_order_dataset('private',p_from,p_to,'PRIVATE',p_market,p_country,p_agent,null,p_customer) ds
 join ordini_testate o on o.id=ds.order_id join crm_verified_open_order_values_v2() v on v.order_id=ds.order_id
 where p_metric='oct' and v.oct_amount<>0
 union all
 select h.codice_cliente,'customer',h.ragione_sociale,h.codice_cliente,h.ragione_sociale,
 case when p_metric='new' then h.first_commercial_date when p_metric='reorders' then h.expected_reorder_date else h.last_invoice_date end,
 h.invoice_total,null,null,h.reorder_status
 from health h where p_metric='customers' or (p_metric='new' and h.first_commercial_date between p_from and p_to)
 or (p_metric='reorders' and h.reorder_status in ('expected','late'))
 union all
 select o.id::text,'project',o.titolo,a.codice_cliente_mexal,a.nome,o.chiusura_prevista,
 coalesce(o.valore,0),coalesce(o.probabilita,0),coalesce(o.valore,0)*coalesce(o.probabilita,0)/100.0,s.nome
 from crm_opportunities o join crm_accounts a on a.id=o.account_id left join crm_opportunity_stages s on s.id=o.stage_id
 where p_metric in ('pipeline','forecast') and a.tipo='conto_terzi' and not coalesce(s.finale,false)
 and public.crm_row_visible(a.responsabile_id,a.reparto_id,public.crm_module_for_type(a.tipo))
 and public.crm_row_visible(coalesce(o.responsabile_id,a.responsabile_id),coalesce(o.reparto_id,a.reparto_id),public.crm_module_for_type(a.tipo))
 ) select to_jsonb(d) from detail_rows d order by d.document_date desc nulls last,d.id
 limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
end $$;
revoke all on function public.crm_private_dashboard_details(text,date,date,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.crm_private_dashboard_details(text,date,date,text,text,text,text,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
