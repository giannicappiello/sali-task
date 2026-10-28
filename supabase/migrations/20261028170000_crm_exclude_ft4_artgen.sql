-- CRM analytical exclusions only. Raw Mexal documents and accounting lineage remain intact.
create or replace view public.crm_invoice_exclusions with (security_invoker = true) as
select l.fattura_id,
 sum(case when upper(btrim(f.sigla))='NC' then -abs(coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0)) else coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0) end) as net_amount,
 sum((case when upper(btrim(f.sigla))='NC' then -abs(coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0)) else coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0) end)
 * coalesce(l.aliquota_iva/100, f.totale_iva/nullif(f.totale_imponibile,0),0)) as vat_amount
from public.mexal_fatture_vendita_righe l join public.mexal_fatture_vendita f on f.id=l.fattura_id
where upper(btrim(l.codice_articolo))='ARTGEN' group by l.fattura_id;

create or replace view public.crm_sales_invoices with (security_invoker = true) as
select f.id,
 f.sigla,
 f.cod_modulo,
 f.serie,
 f.numero,
 f.data_documento,
 f.codice_cliente,
 f.ragione_sociale_cliente,
 f.codice_agente_mexal,
 f.agente_nome,
 f.id_pagamento,
 f.nota,
 (f.totale_imponibile - coalesce(x.net_amount,0))::numeric(16,4) as totale_imponibile,
 (f.totale_iva - coalesce(x.vat_amount,0))::numeric(16,4) as totale_iva,
 (f.totale_documento - coalesce(x.net_amount,0) - coalesce(x.vat_amount,0))::numeric(16,4) as totale_documento,
 f.dati_mexal,
 f.sincronizzato_il,
 f.creato_il,
 f.aggiornato_il,
 f.causale_magazzino_codice,
 f.causale_magazzino_descrizione
from public.mexal_fatture_vendita f left join public.crm_invoice_exclusions x on x.fattura_id=f.id
where not (upper(btrim(coalesce(f.sigla,'')))='FT' and coalesce(f.serie,0)=4)
and (x.fattura_id is null or exists(select 1 from public.mexal_fatture_vendita_righe keep
 where keep.fattura_id=f.id and nullif(btrim(keep.codice_articolo),'') is not null and upper(btrim(keep.codice_articolo))<>'ARTGEN'));

create or replace view public.crm_sales_invoice_lines with (security_invoker = true) as
select l.* from public.mexal_fatture_vendita_righe l join public.crm_sales_invoices f on f.id=l.fattura_id
where upper(btrim(coalesce(l.codice_articolo,'')))<>'ARTGEN';

create or replace view public.crm_order_exclusions with (security_invoker = true) as
select r.ordine_id,
 sum(coalesce(r.imponibile_riga,r.quantita*r.prezzo_netto,r.totale_riga,0)) as net_amount,
 sum(coalesce(r.iva_riga,coalesce(r.imponibile_riga,r.quantita*r.prezzo_netto,r.totale_riga,0)*coalesce(r.aliquota_iva,0)/100)) as vat_amount,
 sum(r.quantita_ocm*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0),0)) as ocm_amount,
 sum(r.quantita_ocx*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0),0)) as ocx_amount,
 sum(r.quantita_oci*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0),0)) as oci_amount
from public.ordini_righe r where upper(btrim(r.codice_articolo))='ARTGEN'
and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true) group by r.ordine_id;

create or replace view public.crm_sales_orders with (security_invoker = true) as
select o.id,
 o.creato_da,
 o.codice_agente_mexal,
 o.codice_cliente,
 o.ragione_sociale_cliente,
 o.data_ordine,
 o.mese_ordine,
 o.stato,
 o.numero_ordine,
 o.numero_ocm,
 o.numero_ocx,
 (o.totale - coalesce(x.net_amount,0) - coalesce(x.vat_amount,0)) as totale,
 o.note,
 o.errore_mexal,
 o.risposta_mexal,
 o.created_at,
 o.updated_at,
 o.codice_pagamento,
 o.descrizione_pagamento,
 o.codice_listino,
 o.indirizzo_spedizione,
 o.note_mexal,
 o.commenti,
 o.sincronizzato_mexal,
 o.sincronizzato_mexal_il,
 o.confermato_at,
 o.stato_sincronizzazione,
 o.errore_sincronizzazione,
 o.ultimo_tentativo_sync,
 o.numero_oci,
 o.arresto_sync_richiesto,
 o.arresto_sync_richiesto_il,
 o.arresto_sync_richiesto_da,
 o.sincronizzazione_iniziata_il,
 o.sincronizzazione_heartbeat_il,
 o.sync_token,
 (o.totale_imponibile - coalesce(x.net_amount,0))::numeric(14,2) as totale_imponibile,
 (o.totale_iva - coalesce(x.vat_amount,0))::numeric(14,2) as totale_iva,
 (o.totale_documento - coalesce(x.net_amount,0) - coalesce(x.vat_amount,0))::numeric(14,2) as totale_documento,
 o.totali_mexal_verificati,
 o.differenza_iva_mexal,
 o.differenza_totale_mexal,
 o.totali_mexal_verificati_at,
 o.partita_iva,
 o.numero_progressivo,
 o.anno_progressivo,
 o.numero_ordine_visualizzato,
 o.codice_pagamento_mexal,
 o.descrizione_pagamento_mexal,
 o.trasporto_mexal,
 o.destinazione_mexal,
 o.modulo_ordini,
 o.agente_nome,
 o.tipo_ordine,
 o.origine,
 o.mexal_sigla,
 o.mexal_cod_modulo,
 o.mexal_serie,
 o.mexal_numero,
 o.mexal_anno,
 o.mexal_chiave,
 o.mexal_cod_conto,
 o.mexal_sincronizzato_il,
 o.cliente_mexal_risolto,
 o.data_consegna,
 o.numero_oct,
 o.mexal_eliminato_il,
 o.importo_minimo_porto_franco,
 o.addebito_spedizione,
 o.versione_conferma,
 o.mexal_mes_eliminato_il,
 o.mexal_mes_eliminazione_errore
from public.ordini_testate o left join public.crm_order_exclusions x on x.ordine_id=o.id
where x.ordine_id is null or exists(select 1 from public.ordini_righe keep where keep.ordine_id=o.id
 and not coalesce(keep.riga_descrittiva,false) and coalesce(keep.mexal_attiva,true)
 and nullif(btrim(keep.codice_articolo),'') is not null and upper(btrim(keep.codice_articolo))<>'ARTGEN');

create or replace view public.crm_sales_order_lines with (security_invoker = true) as
select r.* from public.ordini_righe r join public.crm_sales_orders o on o.id=r.ordine_id
where upper(btrim(coalesce(r.codice_articolo,'')))<>'ARTGEN';

revoke all on public.crm_invoice_exclusions, public.crm_sales_invoices, public.crm_sales_invoice_lines,
 public.crm_order_exclusions, public.crm_sales_orders, public.crm_sales_order_lines from public, anon;
grant select on public.crm_invoice_exclusions, public.crm_sales_invoices, public.crm_sales_invoice_lines,
 public.crm_order_exclusions, public.crm_sales_orders, public.crm_sales_order_lines to authenticated, service_role;

-- Rebind existing read-only CRM functions without changing authorization or RPC signatures.

CREATE OR REPLACE FUNCTION public.crm_account_commercial_snapshot(p_account_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_account public.crm_accounts%rowtype;
  v_settings public.crm_workflow_settings%rowtype;
  v_result jsonb;
begin
  select * into v_account from public.crm_accounts where id=p_account_id;
  if not found or not public.crm_row_visible(v_account.responsabile_id,v_account.reparto_id,public.crm_module_for_type(v_account.tipo)) then
    raise exception 'Cliente non trovato o non autorizzato';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Intervallo non valido'; end if;
  select * into v_settings from public.crm_workflow_settings where crm_tipo=v_account.tipo;
  with order_dates as (
    select o.id,o.data_ordine,o.totale_documento,
      lag(o.data_ordine) over(order by o.data_ordine) previous_date
    from public.crm_order_kpi_source o
    where o.codice_cliente=v_account.codice_cliente_mexal
  ), order_stats as (
    select count(*)::bigint total_count,coalesce(sum(totale_documento),0)::numeric total_value,
      count(*) filter(where data_ordine between p_from and p_to)::bigint period_count,
      coalesce(sum(totale_documento) filter(where data_ordine between p_from and p_to),0)::numeric period_value,
      min(data_ordine) first_date,max(data_ordine) last_date,
      avg(data_ordine-previous_date) filter(where previous_date is not null) average_days
    from order_dates
  ), invoice_stats as (
    select count(*)::bigint total_count,coalesce(sum(totale_documento),0)::numeric total_value,
      count(*) filter(where data_documento between p_from and p_to)::bigint period_count,
      coalesce(sum(totale_documento) filter(where data_documento between p_from and p_to),0)::numeric period_value,
      min(data_documento) first_date,max(data_documento) last_date
    from public.crm_sales_invoices where codice_cliente=v_account.codice_cliente_mexal
  ), opportunity_stats as (
    select count(*) filter(where not coalesce(s.finale,false))::bigint open_count,
      coalesce(sum(o.valore) filter(where not coalesce(s.finale,false)),0)::numeric pipeline_value,
      coalesce(sum(o.valore*coalesce(o.probabilita,0)/100.0) filter(where not coalesce(s.finale,false)),0)::numeric weighted_value,
      count(*) filter(where not coalesce(s.finale,false) and o.chiusura_prevista<current_date)::bigint overdue_count
    from public.crm_opportunities o left join public.crm_opportunity_stages s on s.id=o.stage_id
    where o.account_id=v_account.id
  ), activity_stats as (
    select max(completata_il) last_completed,
      min(data_attivita) filter(where stato<>'completata' and data_attivita>=now()) next_at,
      count(*) filter(where stato<>'completata' and data_attivita<now())::bigint overdue_count
    from public.crm_activities where account_id=v_account.id
  )
  select jsonb_build_object(
    'orders',jsonb_build_object('lifetime_count',o.total_count,'lifetime_value',o.total_value,'period_count',o.period_count,'period_value',o.period_value,'first_date',o.first_date,'last_date',o.last_date,'average_value',case when o.total_count>0 then o.total_value/o.total_count else 0 end,'average_days',round(o.average_days::numeric,1)),
    'invoices',jsonb_build_object('lifetime_count',i.total_count,'lifetime_value',i.total_value,'period_count',i.period_count,'period_value',i.period_value,'first_date',i.first_date,'last_date',i.last_date),
    'opportunities',jsonb_build_object('open_count',p.open_count,'pipeline_value',p.pipeline_value,'weighted_value',p.weighted_value,'overdue_count',p.overdue_count),
    'activities',jsonb_build_object('last_completed',a.last_completed,'next_at',a.next_at,'overdue_count',a.overdue_count),
    'b2b',case when v_account.tipo='b2b' then jsonb_build_object(
      'classification',case when o.total_count=0 then 'prospect' when o.total_count=1 then 'primo_ordine' when o.last_date>=current_date-coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default) then 'riordino' when o.last_date>=current_date-(coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default)*v_settings.rischio_moltiplicatore)::int then 'a_rischio' when o.last_date>=current_date-(coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default)*v_settings.dormiente_moltiplicatore)::int then 'dormiente' else 'perso' end,
      'expected_reorder_date',o.last_date+coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default),
      'days_since_last_order',case when o.last_date is null then null else current_date-o.last_date end,
      'new_customer',o.first_date>=current_date-v_settings.nuovi_clienti_giorni
    ) else null end
  ) into v_result from order_stats o cross join invoice_stats i cross join opportunity_stats p cross join activity_stats a;
  return v_result;
end;
$function$
;

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
  ), invoiced_orders as materialized (
 select distinct links.ordine_id from public.workspace_order_invoice_links(
  array(select o.id from public.crm_sales_orders o where o.codice_cliente in (select codice_cliente from customers) and o.data_ordine between p_from and p_to)
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
      from public.crm_sales_invoices document
      left join public.crm_sales_invoice_lines line on line.fattura_id = document.id
      where document.codice_cliente = customer.codice_cliente
    ) invoice on true
    left join lateral (
      select
        count(distinct customer_order.id) filter (where customer_order.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=customer_order.id))::bigint order_count,
        coalesce(sum(v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount) filter(where customer_order.data_ordine between p_from and p_to),0)::numeric order_total,
        min(customer_order.data_ordine) first_date,
        max(customer_order.data_ordine) last_date
      from public.crm_sales_orders customer_order
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
  ), invoiced_orders as materialized (
 select distinct links.ordine_id from public.workspace_order_invoice_links(
  array(select o.id from public.crm_sales_orders o where o.codice_cliente in (select codice_cliente from customers) and o.data_ordine between p_from and p_to)
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
      from public.crm_sales_invoices document
      left join public.crm_sales_invoice_lines line on line.fattura_id = document.id
      where document.codice_cliente = customer.codice_cliente
    ) invoice on true
    left join lateral (
      select
        count(distinct customer_order.id) filter (where customer_order.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=customer_order.id))::bigint order_count,
        coalesce(sum(v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount) filter(where customer_order.data_ordine between p_from and p_to),0)::numeric order_total,
        min(customer_order.data_ordine) first_date,
        max(customer_order.data_ordine) last_date
      from public.crm_sales_orders customer_order
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

CREATE OR REPLACE FUNCTION public.crm_b2b_order_customers(p_customer_group text, p_order_module text, p_from date, p_to date, p_agent text DEFAULT NULL::text)
 RETURNS TABLE(customer_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select c.codice_cliente
from public.crm_customer_classifications c
join public.ordini_clienti_cache cc using(codice_cliente)
where p_order_module in('ph','prof') and p_customer_group in('all','regular','mypharma')
and (p_customer_group='all' or (p_order_module='prof' and
 ((p_customer_group='mypharma' and c.codice_cliente='501.00288')
 or (p_customer_group='regular' and c.codice_cliente<>'501.00288'))))
and c.area_crm='b2b'
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and c.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and (
 exists(select 1 from public.crm_sales_orders o where o.codice_cliente=c.codice_cliente
  and o.modulo_ordini=p_order_module and o.data_ordine between p_from and p_to)
 or (p_order_module='prof' and exists(
  select 1 from public.crm_sales_invoices f where f.codice_cliente=c.codice_cliente
  and f.data_documento between p_from and p_to))
)
order by c.codice_cliente;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_dashboard_metrics(p_crm_type text, p_from date, p_to date, p_inactivity_days integer DEFAULT 90, p_agent text DEFAULT NULL::text, p_order_module text DEFAULT NULL::text)
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
    where p_crm_type='b2b' and x.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_order_module,p_from,p_to,p_agent)) and x.area_crm = p_crm_type and (nullif(p_agent,'') is null or c.codice_agente_mexal=p_agent)
      and (x.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and x.area_crm = any((select public.crm_visible_customer_areas())::text[]))
  ), verified_values as materialized (select v.* from public.crm_verified_open_order_values_v2() v join public.crm_sales_orders h on h.id=v.order_id where h.modulo_ordini=p_order_module), invoiced_orders as materialized (
 select distinct links.ordine_id from public.workspace_order_invoice_links(
  array(select o.id from public.crm_sales_orders o where o.codice_cliente in (select codice_cliente from visible_customers) and o.data_ordine between p_from and p_to)
 ) links
), invoice_by_customer as (
    select f.codice_cliente,
      count(*) filter (where f.data_documento between p_from and p_to)::bigint invoice_count,
      coalesce(sum(invoice_lines.net_amount) filter (where f.data_documento between p_from and p_to), 0)::numeric invoice_total,
      min(f.data_documento) first_invoice,
      max(f.data_documento) last_invoice
    from public.crm_sales_invoices f
    left join lateral(select sum(coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0)) net_amount from public.crm_sales_invoice_lines l where l.fattura_id=f.id) invoice_lines on true
    join visible_customers v using (codice_cliente)
    group by f.codice_cliente
  ), order_by_customer as (
    select o.codice_cliente,
      count(distinct o.id) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id))::bigint order_count,
      coalesce(sum((select v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount from verified_values v where v.order_id=o.id)) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)), 0)::numeric order_total,
      min(o.data_ordine) first_order,
      max(o.data_ordine) last_order
    from public.crm_sales_orders o
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
    'ph_order_count', (select count(*) from public.crm_sales_orders o join visible_customers v using(codice_cliente) where o.modulo_ordini='ph' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'pr_order_count', (select count(*) from public.crm_sales_orders o join visible_customers v using(codice_cliente) where o.modulo_ordini='prof' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'ph_order_total', (select coalesce(sum(v.ph_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'pr_order_total', (select coalesce(sum(v.pr_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'stralci_order_total', (select coalesce(sum(v.stralci_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'prenotazioni_order_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'ph_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='ph'),
    'pr_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='prof'),
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

CREATE OR REPLACE FUNCTION public.crm_b2b_order_dashboard_metrics(p_customer_group text, p_crm_type text, p_from date, p_to date, p_inactivity_days integer DEFAULT 90, p_agent text DEFAULT NULL::text, p_order_module text DEFAULT NULL::text)
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
  ), verified_values as materialized (select v.* from public.crm_verified_open_order_values_v2() v join public.crm_sales_orders h on h.id=v.order_id where h.modulo_ordini=p_order_module), invoiced_orders as materialized (
 select distinct links.ordine_id from public.workspace_order_invoice_links(
  array(select o.id from public.crm_sales_orders o where o.codice_cliente in (select codice_cliente from visible_customers) and o.data_ordine between p_from and p_to)
 ) links
), invoice_by_customer as (
    select f.codice_cliente,
      count(*) filter (where f.data_documento between p_from and p_to)::bigint invoice_count,
      coalesce(sum(invoice_lines.net_amount) filter (where f.data_documento between p_from and p_to), 0)::numeric invoice_total,
      min(f.data_documento) first_invoice,
      max(f.data_documento) last_invoice
    from public.crm_sales_invoices f
    left join lateral(select sum(coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0)) net_amount from public.crm_sales_invoice_lines l where l.fattura_id=f.id) invoice_lines on true
    join visible_customers v using (codice_cliente)
    group by f.codice_cliente
  ), order_by_customer as (
    select o.codice_cliente,
      count(distinct o.id) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id))::bigint order_count,
      coalesce(sum((select v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount from verified_values v where v.order_id=o.id)) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)), 0)::numeric order_total,
      min(o.data_ordine) first_order,
      max(o.data_ordine) last_order
    from public.crm_sales_orders o
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
    'ph_order_count', (select count(*) from public.crm_sales_orders o join visible_customers v using(codice_cliente) where o.modulo_ordini='ph' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'pr_order_count', (select count(*) from public.crm_sales_orders o join visible_customers v using(codice_cliente) where o.modulo_ordini='prof' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'ph_order_total', (select coalesce(sum(v.ph_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'pr_order_total', (select coalesce(sum(v.pr_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'stralci_order_total', (select coalesce(sum(v.stralci_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'prenotazioni_order_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'ph_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='ph'),
    'pr_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='prof'),
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

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_rows(p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_order_module text DEFAULT NULL::text)
 RETURNS TABLE(category text, line_id text, document_id text, document_number text, document_date date, document_status text, customer_code text, customer_name text, product_code text, description text, quantity numeric, unit text, net_amount numeric, line_position integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.crm_sales_orders o
 join public.crm_customer_classifications c on c.codice_cliente=o.codice_cliente
 join public.ordini_clienti_cache cc on cc.codice_cliente=o.codice_cliente
 where p_crm_type='b2b' and o.data_ordine between p_from and p_to and c.area_crm=p_crm_type
 and o.codice_cliente in(select public.crm_visible_canonical_customer_codes())
 and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
 and o.modulo_ordini=p_order_module and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
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
 from visible_orders o join public.crm_sales_order_lines r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.crm_sales_order_lines r on r.ordine_id=o.id
)
select a.category,r.id::text||':'||a.kind,o.id::text||':'||a.kind,
 a.kind||' '||coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text),
 o.data_ordine,case when a.kind='PH' then o.stato else 'APERTO' end,o.codice_cliente,o.customer_name,
 r.codice_articolo,coalesce(nullif(r.descrizione,''),r.codice_articolo),a.quantity,
 coalesce(nullif(btrim(r.unita_misura_oct),''),nullif(btrim(r.tipo_unita_misura_mexal),'')),
 case when a.kind='PH' then coalesce(r.imponibile_riga,a.quantity*r.prezzo_netto)
 else a.quantity*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0)) end,
 coalesce(r.mexal_posizione,0)
from allocations a join visible_orders o on o.id=a.id join public.crm_sales_order_lines r on r.id=a.row_id
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
from public.crm_sales_invoices f
join public.crm_sales_invoice_lines l on l.fattura_id=f.id
join public.crm_customer_classifications c on c.codice_cliente=f.codice_cliente
join public.ordini_clienti_cache cc on cc.codice_cliente=f.codice_cliente
where p_crm_type='b2b' and f.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_order_module,p_from,p_to,p_agent)) and f.data_documento between p_from and p_to and c.area_crm=p_crm_type
and f.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_rows(p_customer_group text, p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_order_module text DEFAULT NULL::text)
 RETURNS TABLE(category text, line_id text, document_id text, document_number text, document_date date, document_status text, customer_code text, customer_name text, product_code text, description text, quantity numeric, unit text, net_amount numeric, line_position integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.crm_sales_orders o
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
 from visible_orders o join public.crm_sales_order_lines r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.crm_sales_order_lines r on r.ordine_id=o.id
)
select a.category,r.id::text||':'||a.kind,o.id::text||':'||a.kind,
 a.kind||' '||coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text),
 o.data_ordine,case when a.kind='PH' then o.stato else 'APERTO' end,o.codice_cliente,o.customer_name,
 r.codice_articolo,coalesce(nullif(r.descrizione,''),r.codice_articolo),a.quantity,
 coalesce(nullif(btrim(r.unita_misura_oct),''),nullif(btrim(r.tipo_unita_misura_mexal),'')),
 case when a.kind='PH' then coalesce(r.imponibile_riga,a.quantity*r.prezzo_netto)
 else a.quantity*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0)) end,
 coalesce(r.mexal_posizione,0)
from allocations a join visible_orders o on o.id=a.id join public.crm_sales_order_lines r on r.id=a.row_id
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
from public.crm_sales_invoices f
join public.crm_sales_invoice_lines l on l.fattura_id=f.id
join public.crm_customer_classifications c on c.codice_cliente=f.codice_cliente
join public.ordini_clienti_cache cc on cc.codice_cliente=f.codice_cliente
where p_crm_type='b2b' and f.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent)) and f.data_documento between p_from and p_to and c.area_crm=p_crm_type
and f.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_summary(p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_order_module text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.crm_sales_orders o
 join public.crm_customer_classifications c on c.codice_cliente=o.codice_cliente
 join public.ordini_clienti_cache cc on cc.codice_cliente=o.codice_cliente
 where p_crm_type='b2b' and o.data_ordine between p_from and p_to and c.area_crm=p_crm_type
 and o.codice_cliente in(select public.crm_visible_canonical_customer_codes())
 and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
 and o.modulo_ordini=p_order_module and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
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
 from visible_orders o join public.crm_sales_order_lines r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.crm_sales_order_lines r on r.ordine_id=o.id
), product_codes as (
select a.category,r.codice_articolo product_code
from allocations a join public.crm_sales_order_lines r on r.id=a.row_id
where a.quantity>0 and nullif(btrim(r.codice_articolo),'') is not null
and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
union all
select 'purchased',l.codice_articolo from public.crm_sales_invoices f
join public.crm_sales_invoice_lines l on l.fattura_id=f.id
join public.crm_customer_classifications c on c.codice_cliente=f.codice_cliente
join public.ordini_clienti_cache cc on cc.codice_cliente=f.codice_cliente
where p_crm_type='b2b' and f.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_order_module,p_from,p_to,p_agent)) and f.data_documento between p_from and p_to and c.area_crm=p_crm_type
and f.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
)
select coalesce(jsonb_object_agg(category,products),'{}'::jsonb)
from(select category,count(distinct product_code) products from product_codes group by category)s;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_summary(p_customer_group text, p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_order_module text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.crm_sales_orders o
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
 from visible_orders o join public.crm_sales_order_lines r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.crm_sales_order_lines r on r.ordine_id=o.id
), product_codes as (
select a.category,r.codice_articolo product_code
from allocations a join public.crm_sales_order_lines r on r.id=a.row_id
where a.quantity>0 and nullif(btrim(r.codice_articolo),'') is not null
and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
union all
select 'purchased',l.codice_articolo from public.crm_sales_invoices f
join public.crm_sales_invoice_lines l on l.fattura_id=f.id
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
$function$
;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_scope_orders(p_order_module text, p_from date, p_to date, p_agent text DEFAULT NULL::text)
 RETURNS TABLE(order_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select o.id from public.crm_sales_orders o where o.modulo_ordini=p_order_module
and o.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_order_module,p_from,p_to,p_agent)) and o.data_ordine between p_from and p_to+greatest(coalesce((select beauty_post_evento_giorni from public.crm_workflow_settings where crm_tipo='b2b'),30),1) order by o.id;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_scope_orders(p_customer_group text, p_order_module text, p_from date, p_to date, p_agent text DEFAULT NULL::text)
 RETURNS TABLE(order_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select o.id from public.crm_sales_orders o where o.modulo_ordini=p_order_module
and o.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent)) and o.data_ordine between p_from and p_to+greatest(coalesce((select beauty_post_evento_giorni from public.crm_workflow_settings where crm_tipo='b2b'),30),1) order by o.id;
$function$
;

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
    from public.crm_sales_invoices invoice
    join customers customer using (codice_cliente)
    left join public.crm_sales_invoice_lines line on line.fattura_id = invoice.id
    group by invoice.id, invoice.codice_cliente, invoice.data_documento, invoice.totale_imponibile, invoice.totale_documento
  ), historical_order_values as materialized (
    select customer_order.id, customer_order.codice_cliente, customer_order.data_ordine document_date,
      coalesce(sum(coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0))
        filter (where not coalesce(line.riga_descrittiva, false) and coalesce(line.mexal_attiva, true)), customer_order.totale_imponibile, customer_order.totale_documento, 0)::numeric amount
    from public.crm_order_kpi_source customer_order
    join customers customer using (codice_cliente)
    left join public.crm_sales_order_lines line on line.ordine_id = customer_order.id
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
    from public.crm_sales_order_lines line
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
$function$
;

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
    ) dataset join public.crm_sales_orders header on header.id=dataset.order_id join public.crm_verified_open_order_values_v2() verified on verified.order_id=dataset.order_id
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
        (select min(invoice.data_documento) from public.crm_sales_invoices invoice
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
$function$
;

CREATE OR REPLACE FUNCTION public.crm_customer_cadence_details(p_crm_type text, p_to date)
 RETURNS TABLE(codice_cliente text, last_purchase date, average_gap_days numeric, expected_reorder_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with allowed_customers as (
    select classification.codice_cliente
    from public.crm_customer_classifications classification
    where classification.area_crm = p_crm_type
      and (classification.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and classification.area_crm = any((select public.crm_visible_customer_areas())::text[]))
  ), purchase_dates as (
    select distinct invoice.codice_cliente, invoice.data_documento purchase_date
    from public.crm_sales_invoices invoice
    join allowed_customers customer using (codice_cliente)
    where invoice.data_documento <= p_to
  ), intervals as (
    select purchase.codice_cliente, purchase.purchase_date,
      purchase.purchase_date - lag(purchase.purchase_date) over (
        partition by purchase.codice_cliente order by purchase.purchase_date
      ) gap_days
    from purchase_dates purchase
  ), cadence as (
    select customer.codice_cliente,
      max(intervals.purchase_date) last_purchase,
      round(avg(intervals.gap_days) filter (where intervals.gap_days > 0), 1) average_gap_days
    from allowed_customers customer
    left join intervals using (codice_cliente)
    group by customer.codice_cliente
  )
  select cadence.codice_cliente, cadence.last_purchase, cadence.average_gap_days,
    case when cadence.last_purchase is not null and cadence.average_gap_days is not null
      then cadence.last_purchase + ceil(cadence.average_gap_days)::integer
      else null
    end expected_reorder_date
  from cadence
  order by cadence.codice_cliente;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_customer_list(p_crm_type text, p_from date, p_to date, p_customer_status text DEFAULT 'active'::text, p_metric text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_owner uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(entity_kind text, entity_id text, customer_name text, customer_code text, agent_name text, crm_type text, crm_active boolean, last_order_at date, invoice_total numeric, order_total numeric, last_activity_at timestamp with time zone, next_activity_at timestamp with time zone, filtered_total bigint, dataset_total bigint, active_total bigint, inactive_total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with canonical as (
    select
      'canonical'::text as entity_kind,
      catalog.codice_cliente::text as entity_id,
      catalog.ragione_sociale::text as customer_name,
      catalog.codice_cliente::text as customer_code,
      catalog.agente_classificazione::text as agent_name,
      catalog.area_crm::text as crm_type,
      account.responsabile_id,
      catalog.crm_active,
      account.ultima_attivita_il as last_activity_at,
      account.prossima_attivita_il as next_activity_at
    from public.crm_customer_classification_catalog catalog
    left join lateral (
      select candidate.*
      from public.crm_accounts candidate
      where candidate.tipo = catalog.area_crm
        and candidate.codice_cliente_mexal = catalog.codice_cliente
        and public.crm_row_visible(
          candidate.responsabile_id,
          candidate.reparto_id,
          public.crm_module_for_type(candidate.tipo)
        )
      order by candidate.aggiornato_il desc
      limit 1
    ) account on true
    where catalog.area_crm = p_crm_type
  ), prospects as (
    select
      'prospect'::text as entity_kind,
      account.id::text as entity_id,
      account.nome::text as customer_name,
      null::text as customer_code,
      null::text as agent_name,
      account.tipo::text as crm_type,
      account.responsabile_id,
      coalesce(status.crm_active, true) as crm_active,
      account.ultima_attivita_il as last_activity_at,
      account.prossima_attivita_il as next_activity_at
    from public.crm_accounts account
    left join public.crm_customer_status status
      on status.customer_key = 'crm:' || account.id::text
    where account.tipo = p_crm_type
      and account.codice_cliente_mexal is null
      and public.crm_row_visible(
        account.responsabile_id,
        account.reparto_id,
        public.crm_module_for_type(account.tipo)
      )
  ), base as (
    select * from canonical
    union all
    select * from prospects
  ), measured as (
    select base.*,
      coalesce(invoice.invoice_total, 0)::numeric as invoice_total,
      invoice.first_invoice,
      coalesce(customer_order.order_total, 0)::numeric as order_total,
      customer_order.first_order,
      customer_order.last_order_at
    from base
    left join lateral (
      select
        coalesce(sum(document.totale_documento)
          filter (where document.data_documento between p_from and p_to), 0)::numeric as invoice_total,
        min(document.data_documento) as first_invoice
      from public.crm_sales_invoices document
      where base.entity_kind = 'canonical'
        and document.codice_cliente = base.customer_code
    ) invoice on true
    left join lateral (
      select
        coalesce(sum(document.totale_documento)
          filter (where document.data_ordine between p_from and p_to), 0)::numeric as order_total,
        min(document.data_ordine) as first_order,
        max(document.data_ordine) as last_order_at
      from public.crm_sales_orders document
      where base.entity_kind = 'canonical'
        and document.codice_cliente = base.customer_code
    ) customer_order on true
  ), totals as (
    select count(*)::bigint as dataset_total,
      count(*) filter (where crm_active)::bigint as active_total,
      count(*) filter (where not crm_active)::bigint as inactive_total
    from measured
  ), filtered as (
    select measured.*
    from measured
    where (coalesce(p_customer_status, 'active') = 'all'
        or (coalesce(p_customer_status, 'active') = 'active' and measured.crm_active)
        or (p_customer_status = 'inactive' and not measured.crm_active))
      and (nullif(btrim(p_search), '') is null
        or measured.customer_name ilike '%' || btrim(p_search) || '%'
        or coalesce(measured.customer_code, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(measured.agent_name, '') ilike '%' || btrim(p_search) || '%')
      and (nullif(btrim(p_agent), '') is null
        or coalesce(measured.agent_name, '') ilike '%' || btrim(p_agent) || '%')
      and (p_owner is null or measured.responsabile_id = p_owner)
      and (coalesce(p_metric, 'all') = 'all'
        or (p_metric = 'active' and (measured.invoice_total > 0 or measured.order_total > 0))
        or (p_metric = 'invoiced' and measured.invoice_total > 0)
        or (p_metric = 'ordered' and measured.order_total > 0)
        or (p_metric = 'inactive' and measured.invoice_total = 0 and measured.order_total = 0)
        or (p_metric = 'new' and coalesce(
          least(measured.first_invoice, measured.first_order),
          measured.first_invoice,
          measured.first_order
        ) between p_from and p_to))
  )
  select filtered.entity_kind, filtered.entity_id, filtered.customer_name,
    filtered.customer_code, filtered.agent_name, filtered.crm_type,
    filtered.crm_active, filtered.last_order_at, filtered.invoice_total,
    filtered.order_total, filtered.last_activity_at, filtered.next_activity_at,
    count(*) over()::bigint as filtered_total, totals.dataset_total,
    totals.active_total, totals.inactive_total
  from filtered
  cross join totals
  where public.crm_has_module_level(public.crm_module_for_type(p_crm_type), 'lettura')
  order by filtered.customer_name
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$function$
;

CREATE OR REPLACE FUNCTION public.crm_customer_list_v2(p_crm_type text, p_from date, p_to date, p_customer_status text DEFAULT 'active'::text, p_metric text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_owner uuid DEFAULT NULL::uuid, p_code text DEFAULT NULL::text, p_last_order_from date DEFAULT NULL::date, p_invoice_min numeric DEFAULT NULL::numeric, p_order_min numeric DEFAULT NULL::numeric, p_last_activity_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_next_activity_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_sort text DEFAULT 'customer_asc'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(entity_kind text, entity_id text, customer_name text, customer_code text, agent_name text, crm_type text, crm_active boolean, last_order_at date, invoice_total numeric, order_total numeric, last_activity_at timestamp with time zone, next_activity_at timestamp with time zone, filtered_total bigint, dataset_total bigint, active_total bigint, inactive_total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with canonical as (
    select
      'canonical'::text as entity_kind,
      catalog.codice_cliente::text as entity_id,
      catalog.ragione_sociale::text as customer_name,
      catalog.codice_cliente::text as customer_code,
      catalog.agente_classificazione::text as agent_name,
      catalog.area_crm::text as crm_type,
      account.responsabile_id,
      catalog.crm_active,
      account.ultima_attivita_il as last_activity_at,
      account.prossima_attivita_il as next_activity_at
    from public.crm_customer_classification_catalog catalog
    left join lateral (
      select candidate.*
      from public.crm_accounts candidate
      where candidate.tipo = catalog.area_crm
        and candidate.codice_cliente_mexal = catalog.codice_cliente
        and public.crm_row_visible(
          candidate.responsabile_id,
          candidate.reparto_id,
          public.crm_module_for_type(candidate.tipo)
        )
      order by candidate.aggiornato_il desc
      limit 1
    ) account on true
    where catalog.area_crm = p_crm_type
  ), prospects as (
    select
      'prospect'::text as entity_kind,
      account.id::text as entity_id,
      account.nome::text as customer_name,
      null::text as customer_code,
      null::text as agent_name,
      account.tipo::text as crm_type,
      account.responsabile_id,
      coalesce(status.crm_active, true) as crm_active,
      account.ultima_attivita_il as last_activity_at,
      account.prossima_attivita_il as next_activity_at
    from public.crm_accounts account
    left join public.crm_customer_status status
      on status.customer_key = 'crm:' || account.id::text
    where account.tipo = p_crm_type
      and account.codice_cliente_mexal is null
      and public.crm_row_visible(
        account.responsabile_id,
        account.reparto_id,
        public.crm_module_for_type(account.tipo)
      )
  ), base as (
    select * from canonical
    union all
    select * from prospects
  ), measured as (
    select base.*,
      coalesce(invoice.invoice_total, 0)::numeric as invoice_total,
      invoice.first_invoice,
      coalesce(customer_order.order_total, 0)::numeric as order_total,
      customer_order.first_order,
      customer_order.last_order_at
    from base
    left join lateral (
      select
        coalesce(sum(document.totale_documento)
          filter (where document.data_documento between p_from and p_to), 0)::numeric as invoice_total,
        min(document.data_documento) as first_invoice
      from public.crm_sales_invoices document
      where base.entity_kind = 'canonical'
        and document.codice_cliente = base.customer_code
    ) invoice on true
    left join lateral (
      select
        coalesce(sum(document.totale_documento)
          filter (where document.data_ordine between p_from and p_to), 0)::numeric as order_total,
        min(document.data_ordine) as first_order,
        max(document.data_ordine) as last_order_at
      from public.crm_sales_orders document
      where base.entity_kind = 'canonical'
        and document.codice_cliente = base.customer_code
    ) customer_order on true
  ), totals as (
    select count(*)::bigint as dataset_total,
      count(*) filter (where crm_active)::bigint as active_total,
      count(*) filter (where not crm_active)::bigint as inactive_total
    from measured
  ), filtered as (
    select measured.*
    from measured
    where (coalesce(p_customer_status, 'active') = 'all'
        or (coalesce(p_customer_status, 'active') = 'active' and measured.crm_active)
        or (p_customer_status = 'inactive' and not measured.crm_active))
      and (nullif(btrim(p_search), '') is null
        or measured.customer_name ilike '%' || btrim(p_search) || '%'
        or coalesce(measured.customer_code, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(measured.agent_name, '') ilike '%' || btrim(p_search) || '%')
      and (nullif(btrim(p_agent), '') is null
        or coalesce(measured.agent_name, '') ilike '%' || btrim(p_agent) || '%')
      and (p_owner is null or measured.responsabile_id = p_owner)
      and (nullif(btrim(p_code), '') is null or coalesce(measured.customer_code, '') ilike '%' || btrim(p_code) || '%')
      and (p_last_order_from is null or measured.last_order_at >= p_last_order_from)
      and (p_invoice_min is null or measured.invoice_total >= p_invoice_min)
      and (p_order_min is null or measured.order_total >= p_order_min)
      and (p_last_activity_from is null or measured.last_activity_at >= p_last_activity_from)
      and (p_next_activity_to is null or measured.next_activity_at <= p_next_activity_to)
      and (coalesce(p_metric, 'all') = 'all'
        or (p_metric = 'active' and (measured.invoice_total > 0 or measured.order_total > 0))
        or (p_metric = 'invoiced' and measured.invoice_total > 0)
        or (p_metric = 'ordered' and measured.order_total > 0)
        or (p_metric = 'inactive' and measured.invoice_total = 0 and measured.order_total = 0)
        or (p_metric = 'new' and coalesce(
          least(measured.first_invoice, measured.first_order),
          measured.first_invoice,
          measured.first_order
        ) between p_from and p_to))
  )
  select filtered.entity_kind, filtered.entity_id, filtered.customer_name,
    filtered.customer_code, filtered.agent_name, filtered.crm_type,
    filtered.crm_active, filtered.last_order_at, filtered.invoice_total,
    filtered.order_total, filtered.last_activity_at, filtered.next_activity_at,
    count(*) over()::bigint as filtered_total, totals.dataset_total,
    totals.active_total, totals.inactive_total
  from filtered
  cross join totals
  where public.crm_has_module_level(public.crm_module_for_type(p_crm_type), 'lettura')
  order by
    case when p_sort = 'customer_asc' then filtered.customer_name end asc,
    case when p_sort = 'customer_desc' then filtered.customer_name end desc,
    case when p_sort = 'code_asc' then filtered.customer_code end asc nulls last,
    case when p_sort = 'code_desc' then filtered.customer_code end desc nulls last,
    case when p_sort = 'agent_asc' then filtered.agent_name end asc nulls last,
    case when p_sort = 'agent_desc' then filtered.agent_name end desc nulls last,
    case when p_sort = 'area_asc' then filtered.crm_type end asc,
    case when p_sort = 'area_desc' then filtered.crm_type end desc,
    case when p_sort = 'status_asc' then filtered.crm_active end desc,
    case when p_sort = 'status_desc' then filtered.crm_active end asc,
    case when p_sort = 'last_order_asc' then filtered.last_order_at end asc nulls last,
    case when p_sort = 'last_order_desc' then filtered.last_order_at end desc nulls last,
    case when p_sort = 'invoice_asc' then filtered.invoice_total end asc,
    case when p_sort = 'invoice_desc' then filtered.invoice_total end desc,
    case when p_sort = 'order_asc' then filtered.order_total end asc,
    case when p_sort = 'order_desc' then filtered.order_total end desc,
    case when p_sort = 'last_activity_asc' then filtered.last_activity_at end asc nulls last,
    case when p_sort = 'last_activity_desc' then filtered.last_activity_at end desc nulls last,
    case when p_sort = 'next_activity_asc' then filtered.next_activity_at end asc nulls last,
    case when p_sort = 'next_activity_desc' then filtered.next_activity_at end desc nulls last,
    filtered.customer_name
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$function$
;

CREATE OR REPLACE FUNCTION public.crm_customer_metric_details(p_crm_type text, p_from date, p_to date, p_metric text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(codice_cliente text, ragione_sociale text, agente_classificazione text, origine_classificazione text, modalita text, attivo_mexal boolean, crm_account_id uuid, stato_crm text, ultima_attivita_il timestamp with time zone, prossima_attivita_il timestamp with time zone, opportunita_count bigint, invoice_count bigint, invoice_total numeric, order_count bigint, order_total numeric, ultimo_ordine_il date, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with customers as (
    select c.codice_cliente, c.ragione_sociale, x.agente_classificazione,
      x.origine_classificazione,
      case when x.area_override is null then 'automatico' else 'manuale' end modalita,
      c.attivo_mexal
    from public.crm_customer_classifications x
    join public.ordini_clienti_cache c using (codice_cliente)
    where x.area_crm = p_crm_type
      and (x.codice_cliente in (select public.crm_visible_canonical_customer_codes()) and x.area_crm = any((select public.crm_visible_customer_areas())::text[]))
      and (nullif(btrim(p_search), '') is null
        or c.codice_cliente ilike '%' || btrim(p_search) || '%'
        or c.ragione_sociale ilike '%' || btrim(p_search) || '%'
        or x.agente_classificazione ilike '%' || btrim(p_search) || '%')
  ), measured as (
    select c.*,
      account.id crm_account_id, account.stato stato_crm,
      account.ultima_attivita_il, account.prossima_attivita_il,
      coalesce(opportunities.opportunita_count, 0) opportunita_count,
      coalesce(inv.invoice_count, 0) invoice_count,
      coalesce(inv.invoice_total, 0) invoice_total,
      inv.first_date first_invoice,
      inv.last_date last_invoice,
      coalesce(ord.order_count, 0) order_count,
      coalesce(ord.order_total, 0) order_total,
      ord.first_date first_order,
      ord.last_date ultimo_ordine_il
    from customers c
    left join lateral (
      select a.* from public.crm_accounts a
      where a.tipo = p_crm_type and a.codice_cliente_mexal = c.codice_cliente
        and public.crm_row_visible(a.responsabile_id, a.reparto_id, public.crm_module_for_type(a.tipo))
      order by a.aggiornato_il desc limit 1
    ) account on true
    left join lateral (
      select count(*)::bigint opportunita_count from public.crm_opportunities o
      where o.account_id = account.id
    ) opportunities on true
    left join lateral (
      select
        count(*) filter (where f.data_documento between p_from and p_to)::bigint invoice_count,
        coalesce(sum(f.totale_documento) filter (where f.data_documento between p_from and p_to), 0)::numeric invoice_total,
        min(f.data_documento) first_date, max(f.data_documento) last_date
      from public.crm_sales_invoices f where f.codice_cliente = c.codice_cliente
    ) inv on true
    left join lateral (
      select
        count(*) filter (where o.data_ordine between p_from and p_to)::bigint order_count,
        coalesce(sum(o.totale_documento) filter (where o.data_ordine between p_from and p_to), 0)::numeric order_total,
        min(o.data_ordine) first_date, max(o.data_ordine) last_date
      from public.crm_sales_orders o where o.codice_cliente = c.codice_cliente
    ) ord on true
  ), filtered as (
    select * from measured m
    where coalesce(p_metric, '') in ('', 'all')
      or (p_metric = 'active' and (m.invoice_count > 0 or m.order_count > 0))
      or (p_metric = 'invoiced' and m.invoice_count > 0)
      or (p_metric = 'ordered' and m.order_count > 0)
      or (p_metric = 'new' and least(m.first_invoice, m.first_order) between p_from and p_to)
      or (p_metric = 'inactive' and (greatest(m.last_invoice, m.ultimo_ordine_il) is null or greatest(m.last_invoice, m.ultimo_ordine_il) < p_to - 90))
  )
  select f.codice_cliente, f.ragione_sociale, f.agente_classificazione,
    f.origine_classificazione, f.modalita, f.attivo_mexal, f.crm_account_id,
    f.stato_crm, f.ultima_attivita_il, f.prossima_attivita_il,
    f.opportunita_count, f.invoice_count, f.invoice_total,
    f.order_count, f.order_total, f.ultimo_ordine_il,
    count(*) over()::bigint total_count
  from filtered f
  order by f.ragione_sociale
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
  ), invoiced_orders as materialized (
 select distinct links.ordine_id from public.workspace_order_invoice_links(
  array(select o.id from public.crm_sales_orders o where o.codice_cliente in (select codice_cliente from customers) and o.data_ordine between p_from and p_to)
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
      from public.crm_sales_invoices document
      left join public.crm_sales_invoice_lines line on line.fattura_id = document.id
      where document.codice_cliente = customer.codice_cliente
    ) invoice on true
    left join lateral (
      select
        count(distinct customer_order.id) filter (where customer_order.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=customer_order.id))::bigint order_count,
        coalesce(sum(v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount) filter(where customer_order.data_ordine between p_from and p_to),0)::numeric order_total,
        min(customer_order.data_ordine) first_date,
        max(customer_order.data_ordine) last_date
      from public.crm_sales_orders customer_order
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

CREATE OR REPLACE FUNCTION public.crm_customer_period_metrics(p_customer_code text, p_crm_type text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if not public.crm_customer_classification_visible(p_customer_code, p_crm_type) then
    raise exception 'Cliente non trovato o non autorizzato.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Intervallo CRM non valido.' using errcode = '22023';
  end if;

  with invoices as (
    select count(*)::bigint lifetime_count,
      coalesce(sum(totale_documento), 0)::numeric lifetime_total,
      count(*) filter (where data_documento between p_from and p_to)::bigint period_count,
      coalesce(sum(totale_documento) filter (where data_documento between p_from and p_to), 0)::numeric period_total,
      max(data_documento) last_date
    from public.crm_sales_invoices where codice_cliente = p_customer_code
  ), orders as (
    select count(*)::bigint lifetime_count,
      coalesce(sum(totale_documento), 0)::numeric lifetime_total,
      count(*) filter (where data_ordine between p_from and p_to)::bigint period_count,
      coalesce(sum(totale_documento) filter (where data_ordine between p_from and p_to), 0)::numeric period_total,
      max(data_ordine) last_date
    from public.crm_sales_orders where codice_cliente = p_customer_code
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'invoice_lifetime_count', i.lifetime_count,
    'invoice_lifetime_total', i.lifetime_total,
    'invoice_period_count', i.period_count,
    'invoice_period_total', i.period_total,
    'last_invoice_date', i.last_date,
    'order_lifetime_count', o.lifetime_count,
    'order_lifetime_total', o.lifetime_total,
    'order_period_count', o.period_count,
    'order_period_total', o.period_total,
    'last_order_date', o.last_date,
    'average_order_value', case when o.period_count > 0 then o.period_total / o.period_count else 0 end
  ) into result from invoices i cross join orders o;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_customer_product_lines(p_customer_key text, p_kind text, p_crm_type text DEFAULT NULL::text)
 RETURNS TABLE(line_id text, document_id uuid, document_number text, document_date date, document_type text, document_status text, customer_code text, customer_name text, product_code text, description text, quantity numeric, unit text, unit_price numeric, discount text, net_amount numeric, is_credit boolean, excluded_from_totals boolean, line_position integer, remaining_quantity numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if p_kind not in ('ordered','purchased') or p_kind is null then
    raise exception 'Tipo prodotti non valido' using errcode='22023';
  end if;
  if p_crm_type is not null and p_crm_type not in ('conto_terzi','b2b','online') then
    raise exception 'Contesto CRM non valido' using errcode='22023';
  end if;
  return query
  with customer as materialized (
    select c.codice_cliente,c.ragione_sociale from public.crm_classified_customers c
    where c.area_crm in ('conto_terzi','b2b','online') and (p_crm_type is null or c.area_crm=p_crm_type) and ('mexal:'||c.codice_cliente=p_customer_key or exists(
      select 1 from public.crm_accounts a where 'crm:'||a.id::text=p_customer_key
        and a.tipo=c.area_crm and a.codice_cliente_mexal=c.codice_cliente))
  ), lines as (
    select 'order:'||l.id::text line_id,o.id document_id,
      coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.id::text) document_number,
      o.data_ordine document_date,coalesce(o.mexal_sigla,'Ordine') document_type,
      o.stato document_status,c.codice_cliente customer_code,c.ragione_sociale customer_name,
      l.codice_articolo product_code,coalesce(nullif(l.descrizione,''),l.codice_articolo) description,
      l.quantita quantity,nullif(btrim(l.unita_misura_oct),'') unit,l.prezzo_listino unit_price,
      coalesce(nullif(concat_ws(' + ',nullif(l.sconto_commerciale,''),nullif(l.sconto_pagamento,'')),''),nullif(l.sconto_percentuale,0)::text) discount,
      l.imponibile_riga net_amount,false is_credit,
      lower(coalesce(o.stato,'')) in ('annullato','annullata','cancellato','cancellata') excluded_from_totals,
      coalesce(l.mexal_posizione,0) line_position,null::numeric remaining_quantity
    from customer c join public.crm_order_kpi_source o on o.codice_cliente=c.codice_cliente
    join public.crm_sales_order_lines l on l.ordine_id=o.id
    where p_kind='ordered' and not l.riga_descrittiva and l.mexal_attiva
      and nullif(btrim(l.codice_articolo),'') is not null
    union all
    select 'invoice:'||l.id::text,f.id,f.sigla||f.cod_modulo||' '||f.serie||'/'||f.numero,
      f.data_documento,f.sigla,'Documento sincronizzato',c.codice_cliente,c.ragione_sociale,
      l.codice_articolo,coalesce(nullif(l.descrizione,''),l.codice_articolo),
      case when upper(f.sigla)='NC' then -abs(l.quantita) else l.quantita end,
      coalesce(nullif(l.dati_mexal->>'unita_misura',''),nullif(l.dati_mexal->>'um','')),
      l.prezzo_unitario,l.sconto,
      case when upper(f.sigla)='NC' then -abs(l.valore_netto) else l.valore_netto end,
      upper(f.sigla)='NC' or f.totale_imponibile<0,false,l.posizione,null::numeric
    from customer c join public.crm_sales_invoices f on f.codice_cliente=c.codice_cliente
    join public.crm_sales_invoice_lines l on l.fattura_id=f.id
    where p_kind='purchased' and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
  ) select x.* from lines x order by x.document_date desc nulls last,x.document_id,x.line_position,x.line_id;
end $function$
;

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
  array(select o.id from public.crm_sales_orders o where o.codice_cliente in (select codice_cliente from visible_customers) and o.data_ordine between p_from and p_to)
 ) links
), invoice_by_customer as (
    select f.codice_cliente,
      count(*) filter (where f.data_documento between p_from and p_to)::bigint invoice_count,
      coalesce(sum(f.totale_documento) filter (where f.data_documento between p_from and p_to), 0)::numeric invoice_total,
      min(f.data_documento) first_invoice,
      max(f.data_documento) last_invoice
    from public.crm_sales_invoices f
    join visible_customers v using (codice_cliente)
    group by f.codice_cliente
  ), order_by_customer as (
    select o.codice_cliente,
      count(*) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id))::bigint order_count,
      coalesce(sum((select v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount from verified_values v where v.order_id=o.id)) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)), 0)::numeric order_total,
      min(o.data_ordine) first_order,
      max(o.data_ordine) last_order
    from public.crm_sales_orders o
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
    'ph_order_count', (select count(*) from public.crm_sales_orders o join visible_customers v using(codice_cliente) where o.modulo_ordini='ph' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'pr_order_count', (select count(*) from public.crm_sales_orders o join visible_customers v using(codice_cliente) where o.modulo_ordini='prof' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'ph_order_total', (select coalesce(sum(v.ph_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'pr_order_total', (select coalesce(sum(v.pr_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'stralci_order_total', (select coalesce(sum(v.stralci_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'prenotazioni_order_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'ph_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='ph'),
    'pr_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='prof'),
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
  array(select o.id from public.crm_sales_orders o where o.codice_cliente in (select codice_cliente from visible_customers) and o.data_ordine between p_from and p_to)
 ) links
), invoice_by_customer as (
    select f.codice_cliente,
      count(*) filter (where f.data_documento between p_from and p_to)::bigint invoice_count,
      coalesce(sum(f.totale_documento) filter (where f.data_documento between p_from and p_to), 0)::numeric invoice_total,
      min(f.data_documento) first_invoice,
      max(f.data_documento) last_invoice
    from public.crm_sales_invoices f
    join visible_customers v using (codice_cliente)
    group by f.codice_cliente
  ), order_by_customer as (
    select o.codice_cliente,
      count(distinct o.id) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id))::bigint order_count,
      coalesce(sum((select v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount from verified_values v where v.order_id=o.id)) filter (where o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)), 0)::numeric order_total,
      min(o.data_ordine) first_order,
      max(o.data_ordine) last_order
    from public.crm_sales_orders o
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
    'ph_order_count', (select count(*) from public.crm_sales_orders o join visible_customers v using(codice_cliente) where o.modulo_ordini='ph' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'pr_order_count', (select count(*) from public.crm_sales_orders o join visible_customers v using(codice_cliente) where o.modulo_ordini='prof' and o.data_ordine between p_from and p_to and exists(select 1 from verified_values v where v.order_id=o.id)),
    'ph_order_total', (select coalesce(sum(v.ph_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'pr_order_total', (select coalesce(sum(v.pr_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'stralci_order_total', (select coalesce(sum(v.stralci_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'prenotazioni_order_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to),
    'ph_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='ph'),
    'pr_prenotazioni_total', (select coalesce(sum(v.prenotazioni_amount),0) from verified_values v join public.crm_sales_orders o on o.id=v.order_id join visible_customers c using(codice_cliente) where o.data_ordine between p_from and p_to and o.modulo_ordini='prof'),
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

CREATE OR REPLACE FUNCTION public.crm_dashboard_product_lines(p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS TABLE(category text, line_id text, document_id text, document_number text, document_date date, document_status text, customer_code text, customer_name text, product_code text, description text, quantity numeric, unit text, net_amount numeric, line_position integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.crm_sales_orders o
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
 from visible_orders o join public.crm_sales_order_lines r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.crm_sales_order_lines r on r.ordine_id=o.id
)
select a.category,r.id::text||':'||a.kind,o.id::text||':'||a.kind,
 a.kind||' '||coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text),
 o.data_ordine,case when a.kind='PH' then o.stato else 'APERTO' end,o.codice_cliente,o.customer_name,
 r.codice_articolo,coalesce(nullif(r.descrizione,''),r.codice_articolo),a.quantity,
 coalesce(nullif(btrim(r.unita_misura_oct),''),nullif(btrim(r.tipo_unita_misura_mexal),'')),
 case when a.kind='PH' then coalesce(r.imponibile_riga,a.quantity*r.prezzo_netto)
 else a.quantity*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0)) end,
 coalesce(r.mexal_posizione,0)
from allocations a join visible_orders o on o.id=a.id join public.crm_sales_order_lines r on r.id=a.row_id
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
from public.crm_sales_invoices f
join public.crm_sales_invoice_lines l on l.fattura_id=f.id
join public.crm_customer_classifications c on c.codice_cliente=f.codice_cliente
join public.ordini_clienti_cache cc on cc.codice_cliente=f.codice_cliente
where f.data_documento between p_from and p_to and c.area_crm=p_crm_type
and f.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
order by 1,3,2
limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
$function$
;

CREATE OR REPLACE FUNCTION public.crm_dashboard_product_rows(p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text)
 RETURNS TABLE(category text, line_id text, document_id text, document_number text, document_date date, document_status text, customer_code text, customer_name text, product_code text, description text, quantity numeric, unit text, net_amount numeric, line_position integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.crm_sales_orders o
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
 from visible_orders o join public.crm_sales_order_lines r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.crm_sales_order_lines r on r.ordine_id=o.id
)
select a.category,r.id::text||':'||a.kind,o.id::text||':'||a.kind,
 a.kind||' '||coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text),
 o.data_ordine,case when a.kind='PH' then o.stato else 'APERTO' end,o.codice_cliente,o.customer_name,
 r.codice_articolo,coalesce(nullif(r.descrizione,''),r.codice_articolo),a.quantity,
 coalesce(nullif(btrim(r.unita_misura_oct),''),nullif(btrim(r.tipo_unita_misura_mexal),'')),
 case when a.kind='PH' then coalesce(r.imponibile_riga,a.quantity*r.prezzo_netto)
 else a.quantity*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0)) end,
 coalesce(r.mexal_posizione,0)
from allocations a join visible_orders o on o.id=a.id join public.crm_sales_order_lines r on r.id=a.row_id
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
from public.crm_sales_invoices f
join public.crm_sales_invoice_lines l on l.fattura_id=f.id
join public.crm_customer_classifications c on c.codice_cliente=f.codice_cliente
join public.ordini_clienti_cache cc on cc.codice_cliente=f.codice_cliente
where f.data_documento between p_from and p_to and c.area_crm=p_crm_type
and f.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_dashboard_product_summary(p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.crm_sales_orders o
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
 from visible_orders o join public.crm_sales_order_lines r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.crm_sales_order_lines r on r.ordine_id=o.id
), product_codes as (
select a.category,r.codice_articolo product_code
from allocations a join public.crm_sales_order_lines r on r.id=a.row_id
where a.quantity>0 and nullif(btrim(r.codice_articolo),'') is not null
and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
union all
select 'purchased',l.codice_articolo from public.crm_sales_invoices f
join public.crm_sales_invoice_lines l on l.fattura_id=f.id
join public.crm_customer_classifications c on c.codice_cliente=f.codice_cliente
join public.ordini_clienti_cache cc on cc.codice_cliente=f.codice_cliente
where f.data_documento between p_from and p_to and c.area_crm=p_crm_type
and f.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
)
select coalesce(jsonb_object_agg(category,products),'{}'::jsonb)
from(select category,count(distinct product_code) products from product_codes group by category)s;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_global_sales_distribution(p_from date, p_to date, p_macro text DEFAULT NULL::text, p_area text DEFAULT NULL::text, p_customer_status text DEFAULT 'all'::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    from public.crm_sales_invoices invoice
    join visible_customers customer using (codice_cliente)
    where invoice.data_documento between p_from and p_to
  ), order_documents as (
    select count(*)::bigint order_count,
      coalesce(sum(customer_order.totale_documento), 0)::numeric order_total
    from public.crm_sales_orders customer_order
    join visible_customers customer using (codice_cliente)
    where customer_order.data_ordine between p_from and p_to
  ), invoice_lines as (
    select
      coalesce(product.category, 'Senza categoria') as category,
      coalesce(product.subcategory, 'Senza sottocategoria') as subcategory,
      coalesce(line.valore_netto, line.valore_lordo, line.quantita * line.prezzo_unitario, 0)::numeric as amount,
      coalesce(line.quantita, 0)::numeric as pieces
    from public.crm_sales_invoices invoice
    join visible_customers customer using (codice_cliente)
    join public.crm_sales_invoice_lines line on line.fattura_id = invoice.id
    left join product_catalog product on product.codice_mexal = line.codice_articolo
    where invoice.data_documento between p_from and p_to
      and coalesce(btrim(line.codice_articolo), '') <> ''
  ), order_lines as (
    select
      coalesce(product.category, 'Senza categoria') as category,
      coalesce(product.subcategory, 'Senza sottocategoria') as subcategory,
      coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0)::numeric as amount,
      coalesce(line.quantita, 0)::numeric as pieces
    from public.crm_sales_orders customer_order
    join visible_customers customer using (codice_cliente)
    join public.crm_sales_order_lines line on line.ordine_id = customer_order.id
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
    from public.crm_sales_invoices invoice
    join visible_customers customer using (codice_cliente)
    left join public.crm_sales_invoice_lines line on line.fattura_id = invoice.id
    where invoice.data_documento between p_from and p_to
    group by invoice.codice_cliente
  ), order_customer_metrics as (
    select customer_order.codice_cliente,
      coalesce(sum(coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0))
        filter (where not coalesce(line.riga_descrittiva, false) and coalesce(line.mexal_attiva, true)), 0)::numeric order_net
    from public.crm_sales_orders customer_order
    join visible_customers customer using (codice_cliente)
    left join public.crm_sales_order_lines line on line.ordine_id = customer_order.id
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
$function$
;

CREATE OR REPLACE FUNCTION public.crm_open_order_category_details(p_scope text, p_from date, p_to date, p_category text, p_crm_type text DEFAULT NULL::text, p_business text DEFAULT NULL::text, p_market text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_customer text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS TABLE(order_id uuid, order_number text, customer_code text, customer_name text, document_date date, module_code text, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 with amounts as materialized(select * from public.crm_verified_open_order_values_v2()), rows as (
 select ds.order_id,coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text) order_number,
 ds.customer_code,ds.customer_name,ds.document_date,o.modulo_ordini module_code,
 case p_category when 'pr' then v.pr_amount when 'stralci' then v.stralci_amount
 when 'ph' then v.ph_amount when 'ph_reservations' then case when o.modulo_ordini='ph' then v.prenotazioni_amount else 0 end
 when 'pr_reservations' then case when o.modulo_ordini='prof' then v.prenotazioni_amount else 0 end end amount
 from public.crm_commercial_control_order_dataset(p_scope,p_from,p_to,p_business,p_market,p_country,p_agent,p_channel,p_customer) ds
 join public.crm_sales_orders o on o.id=ds.order_id join amounts v on v.order_id=ds.order_id
 where p_crm_type is null or exists(select 1 from public.crm_customer_classifications c where c.codice_cliente=ds.customer_code and c.area_crm=p_crm_type)
 ) select * from rows where amount <> 0 order by document_date desc,order_id
 limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
$function$
;

CREATE OR REPLACE FUNCTION public.crm_ordered_product_details(p_crm_type text, p_from date, p_to date, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS TABLE(category text, product_code text, description text, unit text, quantity numeric, ph_quantity numeric, pr_quantity numeric, stralci_quantity numeric, order_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with visible_orders as materialized (
 select o.* from public.crm_sales_orders o
 join public.crm_customer_classifications c on c.codice_cliente=o.codice_cliente
 where o.data_ordine between p_from and p_to and c.area_crm=p_crm_type
 and o.codice_cliente in(select public.crm_visible_canonical_customer_codes())
 and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
 and o.modulo_ordini in ('ph','prof')
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
), product_lines as (
 select o.id,case when o.tipo_ordine='prenotazione' then 'reserved' else 'ordered' end category,
 r.codice_articolo product_code,r.descrizione description,coalesce(nullif(r.tipo_unita_misura_mexal,''),'Non indicata') unit,
 r.quantita::numeric quantity,'ph' source
 from visible_orders o join public.crm_sales_order_lines r on r.ordine_id=o.id
 where o.modulo_ordini='ph' and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,
 r.codice_articolo,r.descrizione,coalesce(nullif(r.tipo_unita_misura_mexal,''),'Non indicata'),
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric,
 case when d.tipo_documento='OCX' then 'stralci' else 'pr' end
 from visible_orders o join open_documents d on d.id=o.id join public.crm_sales_order_lines r on r.ordine_id=o.id
 where not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
)
select category,product_code,max(description),unit,sum(quantity),coalesce(sum(quantity) filter(where source='ph'),0),
 coalesce(sum(quantity) filter(where source='pr'),0),coalesce(sum(quantity) filter(where source='stralci'),0),count(distinct id)
from product_lines where nullif(btrim(product_code),'') is not null and quantity>0
 group by category,product_code,unit order by category,product_code,unit
 limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
$function$
;

CREATE OR REPLACE FUNCTION public.crm_private_dashboard_details(p_metric text, p_from date, p_to date, p_market text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_agent text DEFAULT NULL::text, p_customer text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    from public.crm_sales_invoices invoice
    join customers customer using (codice_cliente)
    left join public.crm_sales_invoice_lines line on line.fattura_id = invoice.id
    group by invoice.id, invoice.codice_cliente, invoice.data_documento, invoice.totale_imponibile, invoice.totale_documento
  ), historical_order_values as materialized (
    select customer_order.id, customer_order.codice_cliente, customer_order.data_ordine document_date,
      coalesce(sum(coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0))
        filter (where not coalesce(line.riga_descrittiva, false) and coalesce(line.mexal_attiva, true)), customer_order.totale_imponibile, customer_order.totale_documento, 0)::numeric amount
    from public.crm_order_kpi_source customer_order
    join customers customer using (codice_cliente)
    left join public.crm_sales_order_lines line on line.ordine_id = customer_order.id
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
 from invoice_values v join public.crm_sales_invoices i on i.id=v.id join customers c on c.codice_cliente=v.codice_cliente
 where p_metric='invoices' and v.document_date between p_from and p_to
 union all
 select ds.order_id::text,'order',coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text),
 ds.customer_code,ds.customer_name,ds.document_date,v.oct_amount,null,null,'OCT aperto'
 from crm_commercial_control_order_dataset('private',p_from,p_to,'PRIVATE',p_market,p_country,p_agent,null,p_customer) ds
 join public.crm_sales_orders o on o.id=ds.order_id join crm_verified_open_order_values_v2() v on v.order_id=ds.order_id
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
end $function$
;

CREATE OR REPLACE FUNCTION public.crm_verified_open_order_values()
 RETURNS TABLE(order_id uuid, pr_amount numeric, stralci_amount numeric, ph_amount numeric, oct_amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
 select o.id,o.codice_cliente,'PH',null,null,null,
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
 select c.order_id,c.codice_cliente,c.kind,c.sigla,c.numero,c.anno,
 c.amount - coalesce(case c.kind when 'OCM' then x.ocm_amount when 'OCX' then x.ocx_amount when 'OCI' then x.oci_amount else x.net_amount end,0) as amount
 from candidates c left join public.crm_order_exclusions x on x.ordine_id=c.order_id
 where exists(select 1 from public.crm_sales_orders o where o.id=c.order_id) and c.amount is not null and not exists(
  select 1 from invoice_refs f where f.codice_cliente=c.codice_cliente and f.numero=c.numero and f.sigla=c.sigla and f.anno=c.anno::text)
)
select order_id,coalesce(sum(amount) filter(where kind in ('OCM','OCI')),0),
 coalesce(sum(amount) filter(where kind='OCX'),0),coalesce(sum(amount) filter(where kind='PH'),0),
 coalesce(sum(amount) filter(where kind='OCT'),0)
from eligible group by order_id;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_verified_open_order_values_v2()
 RETURNS TABLE(order_id uuid, pr_amount numeric, stralci_amount numeric, ph_amount numeric, oct_amount numeric, prenotazioni_amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
 select c.order_id,c.codice_cliente,c.kind,c.sigla,c.numero,c.anno,
 c.amount - coalesce(case c.kind when 'OCM' then x.ocm_amount when 'OCX' then x.ocx_amount when 'OCI' then x.oci_amount else x.net_amount end,0) as amount
 from candidates c left join public.crm_order_exclusions x on x.ordine_id=c.order_id
 where exists(select 1 from public.crm_sales_orders o where o.id=c.order_id) and c.amount is not null and not exists(
  select 1 from invoice_refs f where f.codice_cliente=c.codice_cliente and f.numero=c.numero and f.sigla=c.sigla and f.anno=c.anno::text)
)
select order_id,coalesce(sum(amount) filter(where kind='OCM'),0),
 coalesce(sum(amount) filter(where kind='OCX'),0),coalesce(sum(amount) filter(where kind='PH'),0),
 coalesce(sum(amount) filter(where kind='OCT'),0),coalesce(sum(amount) filter(where kind in ('OCI','PH_OCI')),0)
from eligible group by order_id;
$function$
;

create or replace view public.crm_order_kpi_source as
 SELECT order_header.id,
    order_header.creato_da,
    order_header.codice_agente_mexal,
    order_header.codice_cliente,
    order_header.ragione_sociale_cliente,
    order_header.data_ordine,
    order_header.mese_ordine,
    order_header.stato,
    order_header.numero_ordine,
    order_header.numero_ocm,
    order_header.numero_ocx,
    order_header.totale,
    order_header.note,
    order_header.errore_mexal,
    order_header.risposta_mexal,
    order_header.created_at,
    order_header.updated_at,
    order_header.codice_pagamento,
    order_header.descrizione_pagamento,
    order_header.codice_listino,
    order_header.indirizzo_spedizione,
    order_header.note_mexal,
    order_header.commenti,
    order_header.sincronizzato_mexal,
    order_header.sincronizzato_mexal_il,
    order_header.confermato_at,
    order_header.stato_sincronizzazione,
    order_header.errore_sincronizzazione,
    order_header.ultimo_tentativo_sync,
    order_header.numero_oci,
    order_header.arresto_sync_richiesto,
    order_header.arresto_sync_richiesto_il,
    order_header.arresto_sync_richiesto_da,
    order_header.sincronizzazione_iniziata_il,
    order_header.sincronizzazione_heartbeat_il,
    order_header.sync_token,
    order_header.totale_imponibile,
    order_header.totale_iva,
    order_header.totale_documento,
    order_header.totali_mexal_verificati,
    order_header.differenza_iva_mexal,
    order_header.differenza_totale_mexal,
    order_header.totali_mexal_verificati_at,
    order_header.partita_iva,
    order_header.numero_progressivo,
    order_header.anno_progressivo,
    order_header.numero_ordine_visualizzato,
    order_header.codice_pagamento_mexal,
    order_header.descrizione_pagamento_mexal,
    order_header.trasporto_mexal,
    order_header.destinazione_mexal,
    order_header.modulo_ordini,
    order_header.agente_nome,
    order_header.tipo_ordine,
    order_header.origine,
    order_header.mexal_sigla,
    order_header.mexal_cod_modulo,
    order_header.mexal_serie,
    order_header.mexal_numero,
    order_header.mexal_anno,
    order_header.mexal_chiave,
    order_header.mexal_cod_conto,
    order_header.mexal_sincronizzato_il,
    order_header.cliente_mexal_risolto,
    order_header.data_consegna,
    order_header.numero_oct,
    COALESCE(document_lineage.document_types, '{}'::text[]) AS mexal_document_types,
        CASE
            WHEN (order_header.origine = 'mexal_oct'::text) THEN 'mexal_oct'::text
            WHEN (cardinality(COALESCE(document_lineage.document_types, '{}'::text[])) > 0) THEN 'mexal_documents'::text
            ELSE 'workspace'::text
        END AS crm_order_source
   FROM (public.crm_sales_orders order_header
     LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT document.tipo_documento ORDER BY document.tipo_documento) AS document_types
           FROM ordini_documenti_mexal document
          WHERE ((document.ordine_id = order_header.id) AND (document.tipo_documento = ANY (ARRAY['OCT'::text, 'OCM'::text, 'OCI'::text, 'OCX'::text])) AND COALESCE(document.presente_in_mexal, true))) document_lineage ON (true));

create or replace view public.crm_classified_customers as
 SELECT customer.codice_cliente,
    customer.ragione_sociale,
    customer.codice_agente_mexal,
    classification.agente_classificazione,
    classification.area_automatica,
    classification.area_override,
    classification.area_crm,
    classification.origine_classificazione,
        CASE
            WHEN (classification.area_override IS NULL) THEN 'automatico'::text
            ELSE 'manuale'::text
        END AS modalita,
    classification.classificata_il,
    classification.override_da,
    classification.override_il,
    classification.override_note,
    customer.attivo_mexal,
    customer.ultimo_sync_mexal,
    customer.partita_iva,
    customer.codice_fiscale,
    customer.indirizzo,
    customer.cap,
    customer.localita,
    customer.provincia,
    customer.telefono,
    customer.email,
    account.id AS crm_account_id,
    account.stato AS stato_crm,
    account.stato_relazione,
    account.valore_cliente,
    account.ultima_attivita_il,
    account.prossima_attivita_il,
    COALESCE(opportunities.opportunita_count, (0)::bigint) AS opportunita_count,
    customer_order.ultimo_ordine_il,
    invoice.fatturato,
    COALESCE(status.crm_active, true) AS crm_active,
    status.changed_at AS crm_status_changed_at,
    status.changed_by AS crm_status_changed_by,
    status.reason AS crm_status_reason
   FROM ((((((ordini_clienti_cache customer
     JOIN crm_customer_classifications classification ON ((classification.codice_cliente = customer.codice_cliente)))
     LEFT JOIN crm_customer_status status ON ((status.customer_key = ('mexal:'::text || customer.codice_cliente))))
     LEFT JOIN LATERAL ( SELECT candidate.id,
            candidate.tipo,
            candidate.nome,
            candidate.stato,
            candidate.stato_relazione,
            candidate.valore_cliente,
            candidate.responsabile_id,
            candidate.reparto_id,
            candidate.codice_cliente_mexal,
            candidate.fonte,
            candidate.partita_iva,
            candidate.codice_fiscale,
            candidate.email,
            candidate.telefono,
            candidate.indirizzo,
            candidate.citta,
            candidate.provincia,
            candidate.cap,
            candidate.paese,
            candidate.agente_id,
            candidate.segmenti,
            candidate.consensi,
            candidate.metadati,
            candidate.ultima_attivita_il,
            candidate.prossima_attivita_il,
            candidate.creato_da,
            candidate.creato_il,
            candidate.aggiornato_il
           FROM crm_accounts candidate
          WHERE ((candidate.tipo = classification.area_crm) AND (candidate.codice_cliente_mexal = customer.codice_cliente) AND crm_row_visible(candidate.responsabile_id, candidate.reparto_id, crm_module_for_type(candidate.tipo)))
          ORDER BY candidate.aggiornato_il DESC
         LIMIT 1) account ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS opportunita_count
           FROM crm_opportunities opportunity
          WHERE ((opportunity.account_id = account.id) AND crm_row_visible(COALESCE(opportunity.responsabile_id, account.responsabile_id), COALESCE(opportunity.reparto_id, account.reparto_id), crm_module_for_type(classification.area_crm)))) opportunities ON (true))
     LEFT JOIN LATERAL ( SELECT max(document.data_ordine) AS ultimo_ordine_il
           FROM public.crm_sales_orders document
          WHERE (document.codice_cliente = customer.codice_cliente)) customer_order ON (true))
     LEFT JOIN LATERAL ( SELECT (COALESCE(sum(document.totale_documento), (0)::numeric))::numeric(16,2) AS fatturato
           FROM public.crm_sales_invoices document
          WHERE (document.codice_cliente = customer.codice_cliente)) invoice ON (true))
  WHERE ((classification.codice_cliente IN ( SELECT crm_visible_canonical_customer_codes() AS crm_visible_canonical_customer_codes)) AND (classification.area_crm = ANY (( SELECT crm_visible_customer_areas() AS crm_visible_customer_areas)::text[])));

create or replace view public.crm_customer_admin_catalog as
 SELECT catalog.codice_cliente,
    catalog.ragione_sociale,
    catalog.codice_agente_mexal,
    catalog.agente_classificazione,
    catalog.area_automatica,
    catalog.area_override,
    catalog.area_crm,
    catalog.origine_classificazione,
    catalog.modalita,
    catalog.classificata_il,
    catalog.override_il,
    catalog.override_note,
    catalog.attivo_mexal,
    catalog.crm_active,
    catalog.crm_status_changed_at,
    catalog.crm_status_changed_by,
    catalog.crm_status_reason,
    COALESCE(revenue.invoice_total_lifetime, (0)::numeric) AS invoice_total_lifetime
   FROM (crm_customer_classification_catalog catalog
     LEFT JOIN ( SELECT invoice.codice_cliente,
            COALESCE(sum(invoice.totale_documento), (0)::numeric) AS invoice_total_lifetime
           FROM public.crm_sales_invoices invoice
          GROUP BY invoice.codice_cliente) revenue USING (codice_cliente));
