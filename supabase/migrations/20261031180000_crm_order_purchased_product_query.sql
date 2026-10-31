begin;
set local lock_timeout='5s';
-- PR/PH and customer-group variants must also avoid unrelated order allocations.

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_detail_lines(p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_product text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_module text DEFAULT NULL::text)
 RETURNS TABLE(category text, line_id text, document_id text, document_number text, document_date date, document_status text, customer_code text, customer_name text, product_code text, description text, quantity numeric, unit text, net_amount numeric, line_position integer)
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
  select x.*
from public.crm_dashboard_purchased_product_rows(p_crm_type,p_from,p_to,p_agent,p_product) x
where p_crm_type='b2b' and x.customer_code in(select c.customer_code from customers c) and x.category=p_category and x.product_code=p_product
order by x.document_date desc,x.document_id,x.line_id
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
  return;
 end if;
 return query
 select x.*
from public.crm_b2b_order_product_rows(p_crm_type,p_from,p_to,p_agent,p_order_module) x
where x.category=p_category and x.product_code=p_product
order by x.document_date desc,x.document_id,x.line_id
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_detail_lines(p_customer_group text, p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_product text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_module text DEFAULT NULL::text)
 RETURNS TABLE(category text, line_id text, document_id text, document_number text, document_date date, document_status text, customer_code text, customer_name text, product_code text, description text, quantity numeric, unit text, net_amount numeric, line_position integer)
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
  select x.*
from public.crm_dashboard_purchased_product_rows(p_crm_type,p_from,p_to,p_agent,p_product) x
where p_crm_type='b2b' and x.customer_code in(select c.customer_code from customers c) and x.category=p_category and x.product_code=p_product
order by x.document_date desc,x.document_id,x.line_id
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
  return;
 end if;
 return query
 select x.*
from public.crm_b2b_order_product_rows(p_customer_group,p_crm_type,p_from,p_to,p_agent,p_order_module) x
where x.category=p_category and x.product_code=p_product
order by x.document_date desc,x.document_id,x.line_id
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_groups(p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_module text DEFAULT NULL::text)
 RETURNS TABLE(code text, description text, quantity numeric, documents bigint, net_amount numeric, unknown_amounts bigint)
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
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null)
from public.crm_dashboard_purchased_product_rows(p_crm_type,p_from,p_to,p_agent,null) x
where p_crm_type='b2b' and x.customer_code in(select c.customer_code from customers c) and x.category=p_category
group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
  return;
 end if;
 return query
 select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null)
from public.crm_b2b_order_product_rows(p_crm_type,p_from,p_to,p_agent,p_order_module) x
where x.category=p_category
group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_b2b_order_product_groups(p_customer_group text, p_crm_type text, p_from date, p_to date, p_agent text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_order_module text DEFAULT NULL::text)
 RETURNS TABLE(code text, description text, quantity numeric, documents bigint, net_amount numeric, unknown_amounts bigint)
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
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null)
from public.crm_dashboard_purchased_product_rows(p_crm_type,p_from,p_to,p_agent,null) x
where p_crm_type='b2b' and x.customer_code in(select c.customer_code from customers c) and x.category=p_category
group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
  return;
 end if;
 return query
 select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null)
from public.crm_b2b_order_product_rows(p_customer_group,p_crm_type,p_from,p_to,p_agent,p_order_module) x
where x.category=p_category
group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
end;
$function$;

notify pgrst, 'reload schema';
commit;
