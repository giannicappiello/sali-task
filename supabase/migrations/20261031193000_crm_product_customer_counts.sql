create or replace function public.crm_dashboard_product_groups_with_customers(p_crm_type text,p_from date,p_to date,p_agent text default null,p_category text default null,p_limit integer default 500,p_offset integer default 0)
returns table(code text,description text,quantity numeric,documents bigint,net_amount numeric,unknown_amounts bigint, customers bigint)
language plpgsql stable security definer set search_path=public as $function$
begin
 if p_category='purchased' then
  return query
select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null),count(distinct coalesce(nullif(x.customer_code,''),nullif(x.customer_name,'')))
 from public.crm_dashboard_purchased_product_rows(p_crm_type,p_from,p_to,p_agent,null) x where x.category=p_category
 group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
 limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
  return;
 end if;
 return query
select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null),count(distinct coalesce(nullif(x.customer_code,''),nullif(x.customer_name,'')))
 from public.crm_dashboard_product_rows(p_crm_type,p_from,p_to,p_agent) x where x.category=p_category
 group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
 limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_groups_with_customers(p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_module text DEFAULT NULL::text)
 RETURNS TABLE(code text, description text, quantity numeric, documents bigint, net_amount numeric, unknown_amounts bigint, customers bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if p_category='purchased' then
  return query
  with customers as materialized (
   select c.customer_code from public.crm_b2b_order_customers(p_order_module,p_from,p_to,p_agent) c
  )
  select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null),count(distinct coalesce(nullif(x.customer_code,''),nullif(x.customer_name,'')))
from public.crm_dashboard_purchased_product_rows(p_crm_type,p_from,p_to,p_agent,null) x
where p_crm_type='b2b' and x.customer_code in(select c.customer_code from customers c) and x.category=p_category
group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
  return;
 end if;
 return query
 select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null),count(distinct coalesce(nullif(x.customer_code,''),nullif(x.customer_name,'')))
from public.crm_b2b_order_product_rows(p_crm_type,p_from,p_to,p_agent,p_order_module) x
where x.category=p_category
group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_groups_with_customers(p_customer_group text, p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_module text DEFAULT NULL::text)
 RETURNS TABLE(code text, description text, quantity numeric, documents bigint, net_amount numeric, unknown_amounts bigint, customers bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if p_category='purchased' then
  return query
  with customers as materialized (
   select c.customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent) c
  )
  select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null),count(distinct coalesce(nullif(x.customer_code,''),nullif(x.customer_name,'')))
from public.crm_dashboard_purchased_product_rows(p_crm_type,p_from,p_to,p_agent,null) x
where p_crm_type='b2b' and x.customer_code in(select c.customer_code from customers c) and x.category=p_category
group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
  return;
 end if;
 return query
 select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null),count(distinct coalesce(nullif(x.customer_code,''),nullif(x.customer_name,'')))
from public.crm_b2b_order_product_rows(p_customer_group,p_crm_type,p_from,p_to,p_agent,p_order_module) x
where x.category=p_category
group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
end;
$function$;
revoke all on function public.crm_dashboard_product_groups_with_customers(text,date,date,text,text,integer,integer) from public,anon;
grant execute on function public.crm_dashboard_product_groups_with_customers(text,date,date,text,text,integer,integer) to authenticated,service_role;
revoke all on function public.crm_b2b_order_product_groups_with_customers(text,date,date,text,text,integer,integer,text) from public,anon;
grant execute on function public.crm_b2b_order_product_groups_with_customers(text,date,date,text,text,integer,integer,text) to authenticated,service_role;
revoke all on function public.crm_b2b_order_product_groups_with_customers(text,text,date,date,text,text,integer,integer,text) from public,anon;
grant execute on function public.crm_b2b_order_product_groups_with_customers(text,text,date,date,text,text,integer,integer,text) to authenticated,service_role;
notify pgrst, 'reload schema';
