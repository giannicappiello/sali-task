begin;
-- Explicit activity availability; does not reactivate historical order lines.
create or replace function public.workspace_activity_additional_products(p_customer_key text, p_crm_type text default null)
returns table(product_code text)
language sql stable security invoker set search_path=public as $$
  select codes.product_code
  from (values ('CO0023'),('CO0024'),('CO0025'),('CO0026')) codes(product_code)
  where exists (
    select 1 from public.crm_classified_customers c
    where c.codice_cliente='501.02281'
      and c.area_crm='conto_terzi'
      and (p_crm_type is null or p_crm_type=c.area_crm)
      and ('mexal:'||c.codice_cliente=p_customer_key or exists (
        select 1 from public.crm_accounts a
        where 'crm:'||a.id::text=p_customer_key
          and a.tipo=c.area_crm and a.codice_cliente_mexal=c.codice_cliente
      ))
  );
$$;
revoke all on function public.workspace_activity_additional_products(text,text) from public,anon;
grant execute on function public.workspace_activity_additional_products(text,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
