begin;

-- Catalogo completo dei Paesi per tutti i clienti CRM visibili. La funzione
-- restituisce una sola riga per entità e non dipende dalla paginazione UI.
create or replace function public.crm_customer_country_catalog(p_crm_type text default null)
returns table (entity_key text, country_code text)
language sql
stable
security definer
set search_path = public
as $$
  select 'mexal:' || customer.codice_cliente,
    nullif(upper(btrim(customer.paese)), '')
  from public.ordini_clienti_cache customer
  join public.crm_customer_classifications classification
    on classification.codice_cliente = customer.codice_cliente
  where (p_crm_type is null or classification.area_crm = p_crm_type)
    and public.crm_customer_classification_visible(
      classification.codice_cliente,
      classification.area_crm
    )

  union all

  select 'crm:' || account.id::text,
    nullif(upper(btrim(account.paese)), '')
  from public.crm_accounts account
  where account.codice_cliente_mexal is null
    and (p_crm_type is null or account.tipo = p_crm_type)
    and public.crm_row_visible(
      account.responsabile_id,
      account.reparto_id,
      public.crm_module_for_type(account.tipo)
    );
$$;

revoke all on function public.crm_customer_country_catalog(text) from public, anon;
grant execute on function public.crm_customer_country_catalog(text) to authenticated, service_role;

comment on function public.crm_customer_country_catalog(text) is
  'Catalogo completo Paese/nazionalità per clienti canonici e prospect CRM-only nel perimetro autorizzato.';

commit;
