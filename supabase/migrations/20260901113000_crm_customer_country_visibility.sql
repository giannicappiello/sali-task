begin;

-- Restituisce il Paese già normalizzato del singolo cliente canonico senza
-- esporre direttamente l'anagrafica Mexal e senza modificare le RLS esistenti.
create or replace function public.crm_customer_country(
  p_customer_code text,
  p_crm_type text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(upper(btrim(customer.paese)), '')
  from public.ordini_clienti_cache customer
  join public.crm_customer_classifications classification
    on classification.codice_cliente = customer.codice_cliente
  where customer.codice_cliente = p_customer_code
    and classification.area_crm = p_crm_type
    and public.crm_customer_classification_visible(
      classification.codice_cliente,
      classification.area_crm
    )
  limit 1;
$$;

revoke all on function public.crm_customer_country(text, text) from public, anon;
grant execute on function public.crm_customer_country(text, text) to authenticated, service_role;

comment on function public.crm_customer_country(text, text) is
  'Paese normalizzato del cliente canonico, limitato al perimetro CRM autorizzato.';

commit;
