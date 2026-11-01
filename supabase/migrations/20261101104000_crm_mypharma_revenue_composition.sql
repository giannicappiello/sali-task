create or replace function public.crm_commercial_direct_revenue_composition(p_from date,p_to date,p_scope text default 'global',p_business text default null,p_market text default null,p_country text default null,p_agent text default null,p_channel text default null,p_customer text default null)
returns table(label text,amount numeric,mypharma_amount numeric) language sql stable security definer set search_path=public as $pie$
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
      invoice.net_amount::numeric amount
    from public.crm_invoice_financials invoice
    join customers customer using (codice_cliente)
  )
select case when c.market='Estero' then 'Estero'
 when lower(btrim(c.ragione_sociale)) in ('cliente amazon','amazon') or c.channel_code='AMAZON' then 'Amazon'
 when c.crm_area='online' or c.channel='BtoC' then 'Online'
 when c.crm_area='b2b' or c.channel='BtoB' then 'BtoB'
 else 'Altro DIRECT' end label,
 coalesce(sum(i.amount),0)::numeric amount,coalesce(sum(i.amount)filter(where c.codice_cliente='501.00288'),0)::numeric mypharma_amount
from invoice_values i join customers c using(codice_cliente)
where c.business='DIRECT' and i.document_date between p_from and p_to
group by 1 order by 2 desc,1;
$pie$;
revoke all on function public.crm_commercial_direct_revenue_composition(date,date,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.crm_commercial_direct_revenue_composition(date,date,text,text,text,text,text,text,text) to authenticated,service_role;
notify pgrst,'reload schema';
