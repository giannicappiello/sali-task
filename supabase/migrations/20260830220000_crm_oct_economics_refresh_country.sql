begin;

create or replace function public.crm_country_json_scalar(p_value jsonb)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, public
as $$
declare
  value_type text := jsonb_typeof(p_value);
  value_length integer;
begin
  if value_type in ('string', 'number') then
    return nullif(btrim(p_value #>> '{}'), '');
  end if;
  if value_type = 'array' then
    value_length := jsonb_array_length(p_value);
    if value_length = 0 then return null; end if;
    return public.crm_country_json_scalar(p_value -> (value_length - 1));
  end if;
  return null;
end;
$$;

create or replace function public.crm_normalize_country_code(p_country text, p_payload jsonb default '{}'::jsonb)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
declare
  raw_country text;
begin
  raw_country := upper(coalesce(
    nullif(btrim(p_country), ''),
    public.crm_country_json_scalar(p_payload -> 'cod_paese'),
    public.crm_country_json_scalar(p_payload -> 'codice_paese'),
    public.crm_country_json_scalar(p_payload -> 'paese'),
    public.crm_country_json_scalar(p_payload -> 'cod_nazione'),
    public.crm_country_json_scalar(p_payload -> 'codice_nazione'),
    public.crm_country_json_scalar(p_payload -> 'nazione'),
    public.crm_country_json_scalar(p_payload -> 'sigla_nazione'),
    public.crm_country_json_scalar(p_payload -> 'codice_iso'),
    public.crm_country_json_scalar(p_payload -> 'cod_iso'),
    public.crm_country_json_scalar(p_payload -> 'iso_paese'),
    public.crm_country_json_scalar(p_payload -> 'country_code'),
    public.crm_country_json_scalar(p_payload #> '{anagrafica,cod_paese}'),
    public.crm_country_json_scalar(p_payload #> '{anagrafica,codice_nazione}'),
    public.crm_country_json_scalar(p_payload #> '{anagrafica,nazione}'),
    public.crm_country_json_scalar(p_payload #> '{dati_anagrafici,cod_paese}'),
    public.crm_country_json_scalar(p_payload #> '{dati_anagrafici,codice_nazione}'),
    public.crm_country_json_scalar(p_payload #> '{dati_fiscali,cod_paese}'),
    public.crm_country_json_scalar(p_payload #> '{dati_fiscali,codice_nazione}'),
    public.crm_country_json_scalar(p_payload #> '{sede,cod_paese}'),
    public.crm_country_json_scalar(p_payload #> '{sede,codice_nazione}')
  ));
  if raw_country in ('IT', 'ITA', 'ITALIA', 'ITALY', '380') then return 'IT'; end if;
  return nullif(raw_country, '');
end;
$$;

revoke all on function public.crm_country_json_scalar(jsonb) from public, anon, authenticated;
revoke all on function public.crm_normalize_country_code(text, jsonb) from public, anon, authenticated;
grant execute on function public.crm_country_json_scalar(jsonb) to service_role;
grant execute on function public.crm_normalize_country_code(text, jsonb) to service_role;

update public.ordini_clienti_cache customer
set paese = public.crm_normalize_country_code(customer.paese, coalesce(customer.json_mexal, customer.dati_mexal))
where customer.paese is distinct from public.crm_normalize_country_code(
  customer.paese,
  coalesce(customer.json_mexal, customer.dati_mexal)
);

-- Il ciclo OCT segue quello Ordini anche per i backfill: l'upsert per chiave Mexal
-- aggiorna testate e righe esistenti senza duplicare OC/OCM/OCI/OCX.
update public.mexal_sync_schedules oct_schedule
set enabled = orders_schedule.enabled,
    updated_at = now()
from public.mexal_sync_schedules orders_schedule
where oct_schedule.sync_type = 'oct_orders'
  and orders_schedule.sync_type = 'orders'
  and oct_schedule.enabled is distinct from orders_schedule.enabled;

create or replace view public.crm_order_kpi_source
with (security_invoker = true)
as
select
  order_header.*,
  coalesce(document_lineage.document_types, '{}'::text[]) as mexal_document_types,
  case
    when order_header.origine = 'mexal_oct' then 'mexal_oct'
    when cardinality(coalesce(document_lineage.document_types, '{}'::text[])) > 0 then 'mexal_documents'
    else 'workspace'
  end as crm_order_source
from public.ordini_testate order_header
left join lateral (
  select array_agg(distinct document.tipo_documento order by document.tipo_documento) as document_types
  from public.ordini_documenti_mexal document
  where document.ordine_id = order_header.id
    and document.tipo_documento in ('OCT', 'OCM', 'OCI', 'OCX')
    and coalesce(document.presente_in_mexal, true)
) document_lineage on true;

grant select on public.crm_order_kpi_source to authenticated, service_role;

do $migration$
declare
  function_oid regprocedure := 'public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text)'::regprocedure;
  definition text;
begin
  select pg_get_functiondef(function_oid) into definition;

  definition := replace(
    definition,
    $$upper(coalesce(nullif(btrim(customer.paese), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'cod_paese'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'codice_paese'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'paese'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'cod_nazione'), ''), nullif(btrim(coalesce(customer.json_mexal, customer.dati_mexal) ->> 'nazione'), ''), 'ND')) country_code$$,
    $$coalesce(public.crm_normalize_country_code(customer.paese, coalesce(customer.json_mexal, customer.dati_mexal)), 'ND') country_code$$
  );
  definition := replace(
    definition,
    $$upper(coalesce(nullif(btrim(paese), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_paese'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'codice_paese'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'paese'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'cod_nazione'), ''), nullif(btrim(coalesce(json_mexal, dati_mexal) ->> 'nazione'), ''), 'ND')) country_code$$,
    $$coalesce(public.crm_normalize_country_code(paese, coalesce(json_mexal, dati_mexal)), 'ND') country_code$$
  );
  definition := replace(
    definition,
    'from public.crm_order_kpi_source customer_order' || chr(10) || '    join customers customer using (codice_cliente)',
    'from public.crm_order_kpi_source customer_order' || chr(10) || '    join customers customer on customer.codice_cliente = btrim(customer_order.codice_cliente)'
  );
  definition := replace(
    definition,
    $$coalesce(sum(coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0))
        filter (where not coalesce(line.riga_descrittiva, false) and coalesce(line.mexal_attiva, true)), customer_order.totale_imponibile, customer_order.totale_documento, 0)::numeric amount$$,
    $$case
        when customer_order.origine = 'mexal_oct' and customer_order.totale_imponibile is not null
          then customer_order.totale_imponibile
        else coalesce(sum(coalesce(line.totale_riga, line.imponibile_riga, line.quantita * line.prezzo_netto, 0))
          filter (where not coalesce(line.riga_descrittiva, false) and coalesce(line.mexal_attiva, true)), customer_order.totale_imponibile, customer_order.totale_documento, 0)
      end::numeric amount$$
  );

  if definition not like '%public.crm_order_kpi_source customer_order%'
    or definition not like '%crm_normalize_country_code(customer.paese%'
    or definition not like '%btrim(customer_order.codice_cliente)%'
    or definition not like $assert$%customer_order.origine = 'mexal_oct'%$assert$ then
    raise exception 'Definizione CRM Overview non riconosciuta: correzioni OCT/Paese annullate.';
  end if;

  execute definition;
end;
$migration$;

comment on view public.crm_order_kpi_source is
  'Sorgente KPI ordine deduplicata: testate Workspace e OCT inbound; OCM/OCI/OCX restano lineage della stessa testata.';
comment on function public.crm_normalize_country_code(text, jsonb) is
  'Normalizza il Paese cliente dai campi e dalle matrici effettivamente restituite dalle varianti Mexal.';
comment on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) is
  'CRM Overview stabile con OCT economici deduplicati e Paese cliente normalizzato.';

commit;
