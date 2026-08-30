begin;

alter table public.ordini_clienti_cache
  add column if not exists paese text;

update public.ordini_clienti_cache
set paese = case upper(coalesce(
  nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_paese'), ''),
  nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'codice_paese'), ''),
  nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'paese'), ''),
  nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_nazione'), ''),
  nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'codice_nazione'), ''),
  nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'nazione'), ''),
  nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'sigla_nazione'), '')
)) when 'ITA' then 'IT' when 'ITALIA' then 'IT' when 'ITALY' then 'IT' when '380' then 'IT'
  else upper(coalesce(
    nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_paese'), ''),
    nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'codice_paese'), ''),
    nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'paese'), ''),
    nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_nazione'), ''),
    nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'codice_nazione'), ''),
    nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'nazione'), ''),
    nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'sigla_nazione'), '')
  )) end
where nullif(btrim(coalesce(paese, '')), '') is null;

do $migration$
declare
  function_oid regprocedure := 'public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text)'::regprocedure;
  definition text;
  original_definition text;
  trend_start integer;
  business_start integer;
begin
  select pg_get_functiondef(function_oid) into definition;
  original_definition := definition;

  definition := replace(
    definition,
    $$upper(coalesce(nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'cod_paese'), ''), 'ND')) country_code$$,
    $$upper(coalesce(nullif(btrim(customer.paese), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'cod_paese'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'codice_paese'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'paese'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'cod_nazione'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'nazione'), ''), 'ND')) country_code$$
  );
  definition := replace(
    definition,
    $$upper(coalesce(nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_paese'), ''), 'ND')) country_code$$,
    $$upper(coalesce(nullif(btrim(paese), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_paese'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'codice_paese'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'paese'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_nazione'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'nazione'), ''), 'ND')) country_code$$
  );

  -- Tutti i KPI ordine usano la sorgente canonica: testate Workspace, OCT inbound
  -- e lineage OCM/OCI/OCX, senza moltiplicare una testata per i documenti figli.
  definition := replace(definition, 'public.ordini_testate customer_order', 'public.crm_order_kpi_source customer_order');

  -- La serie temporale mostra la composizione del fatturato e non più l'ordinato.
  trend_start := strpos(definition, 'trend_source as (');
  business_start := strpos(definition, 'business_performance as (');
  if trend_start = 0 or business_start <= trend_start then
    raise exception 'Definizione dashboard non riconosciuta: andamento non aggiornato.';
  end if;
  definition := left(definition, trend_start - 1)
    || $trend$trend as (
    select date_trunc(p_granularity, invoice.document_date)::date bucket,
      sum(invoice.amount)::numeric invoice_total,
      coalesce(sum(invoice.amount) filter (where customer.business = 'PRIVATE'), 0)::numeric private_invoice_total,
      coalesce(sum(invoice.amount) filter (where customer.business = 'DIRECT'), 0)::numeric direct_invoice_total
    from invoice_values invoice
    join customers customer using (codice_cliente)
    where invoice.document_date between p_from and p_to
    group by 1
  ), $trend$
    || substring(definition from business_start);

  definition := replace(
    definition,
    '), agent_performance as (',
    $detail$), direct_breakdown as (
    select
      coalesce(sum(invoice_total) filter (where business = 'DIRECT' and channel = 'BtoB'), 0)::numeric btob_invoice_total,
      coalesce(sum(invoice_total) filter (where business = 'DIRECT' and channel = 'BtoC'), 0)::numeric btoc_invoice_total,
      coalesce(sum(invoice_total) filter (where business = 'DIRECT' and country_code not in ('IT', 'ND')), 0)::numeric foreign_invoice_total
    from health
  ), agent_performance as ($detail$
  );
  definition := replace(
    definition,
    $$'business', coalesce((select jsonb_agg(to_jsonb(row) order by row.business) from business_performance row), '[]'::jsonb),$$,
    $$'business', coalesce((select jsonb_agg(to_jsonb(row) order by row.business) from business_performance row), '[]'::jsonb),
    'direct_breakdown', coalesce((select to_jsonb(row) from direct_breakdown row), '{}'::jsonb),$$
  );

  if definition = original_definition
    or definition not like '%crm_order_kpi_source%'
    or definition not like '%btrim(customer.paese)%'
    or definition not like '%private_invoice_total%'
    or definition not like $assert$%'direct_breakdown', coalesce%$assert$ then
    raise exception 'Definizione dashboard non riconosciuta: modifiche CRM Overview non applicate.';
  end if;

  execute definition;
end;
$migration$;

comment on column public.ordini_clienti_cache.paese is
  'Codice Paese normalizzato dall’anagrafica Mexal; supporta le varianti reali del payload clienti.';

comment on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) is
  'CRM Overview stabile: KPI ordini Workspace/Mexal inclusi OCT, Paese normalizzato, dettaglio DIRECT e composizione fatturato PRIVATE/DIRECT.';

commit;
