begin;

-- PR is the B2B commercial perimeter excluding PH orders, not only customers
-- who happen to have a PR header within the selected period. Invoices remain
-- visible even when the customer has no PR order (or only PH orders).
create or replace function public.crm_b2b_order_customers(
 p_customer_group text,p_order_module text,p_from date,p_to date,p_agent text default null)
returns table(customer_code text) language sql stable security definer set search_path=public as $$
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
 exists(select 1 from public.ordini_testate o where o.codice_cliente=c.codice_cliente
  and o.modulo_ordini=p_order_module and o.data_ordine between p_from and p_to)
 or (p_order_module='prof' and exists(
  select 1 from public.mexal_fatture_vendita f where f.codice_cliente=c.codice_cliente
  and f.data_documento between p_from and p_to))
)
order by c.codice_cliente;
$$;

-- Keep callers without customer segmentation consistent with the same perimeter.
create or replace function public.crm_b2b_order_customers(
 p_order_module text,p_from date,p_to date,p_agent text default null)
returns table(customer_code text) language sql stable security definer set search_path=public as $$
select * from public.crm_b2b_order_customers('all'::text,p_order_module,p_from,p_to,p_agent);
$$;

revoke all on function public.crm_b2b_order_customers(text,text,date,date,text) from public,anon;
revoke all on function public.crm_b2b_order_customers(text,date,date,text) from public,anon;
grant execute on function public.crm_b2b_order_customers(text,text,date,date,text) to authenticated,service_role;
grant execute on function public.crm_b2b_order_customers(text,date,date,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
