begin;

create or replace view public.crm_customer_classification_catalog
with (security_invoker = false, security_barrier = true)
as
select
  customer.codice_cliente,
  customer.ragione_sociale,
  customer.codice_agente_mexal,
  classification.agente_classificazione,
  classification.area_automatica,
  classification.area_override,
  classification.area_crm,
  classification.origine_classificazione,
  case when classification.area_override is null then 'automatico' else 'manuale' end as modalita,
  classification.classificata_il,
  classification.override_il,
  classification.override_note,
  customer.attivo_mexal
from public.ordini_clienti_cache customer
join public.crm_customer_classifications classification
  on classification.codice_cliente = customer.codice_cliente
where
  classification.area_crm::text = any (
    ((select public.crm_visible_customer_areas()))::text[]
  )
  and classification.codice_cliente::text = any (
    (
      select coalesce(array_agg(visible.customer_code), '{}'::text[])
      from public.crm_visible_canonical_customer_codes() visible(customer_code)
    )::text[]
  );

revoke all on public.crm_customer_classification_catalog from public, anon;
grant select on public.crm_customer_classification_catalog to authenticated, service_role;

comment on view public.crm_customer_classification_catalog is
  'Catalogo leggero per amministrazione classificazioni CRM, filtrato per area e scope senza aggregati operativi.';

commit;
