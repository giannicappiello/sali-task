-- Isolated scratch database only; never run against production.
-- psql -v ON_ERROR_STOP=1 -f test/crm-order-purchased-product-query.fixture.sql
\ir crm-purchased-product-query.fixture.sql
create table crm_sales_orders(codice_cliente text,modulo_ordini text,data_ordine date);
CREATE OR REPLACE FUNCTION public.crm_b2b_order_customers(p_customer_group text, p_order_module text, p_from date, p_to date, p_agent text DEFAULT NULL::text)
 RETURNS TABLE(customer_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 exists(select 1 from public.crm_sales_orders o where o.codice_cliente=c.codice_cliente
  and o.modulo_ordini=p_order_module and o.data_ordine between p_from and p_to)
 or (p_order_module='prof' and exists(
  select 1 from public.crm_sales_invoices f where f.codice_cliente=c.codice_cliente
  and f.data_documento between p_from and p_to))
)
order by c.codice_cliente;
$function$
;
CREATE OR REPLACE FUNCTION public.crm_b2b_order_customers(p_order_module text, p_from date, p_to date, p_agent text DEFAULT NULL::text)
 RETURNS TABLE(customer_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select * from public.crm_b2b_order_customers('all'::text,p_order_module,p_from,p_to,p_agent);
$function$
;
create function crm_b2b_order_product_rows(text,date,date,text,text) returns table(category text,line_id text,document_id text,document_number text,document_date date,document_status text,customer_code text,customer_name text,product_code text,description text,quantity numeric,unit text,net_amount numeric,line_position integer) language sql as $$select * from crm_dashboard_product_rows(null,null,null,null)$$;
create function crm_b2b_order_product_rows(text,text,date,date,text,text) returns table(category text,line_id text,document_id text,document_number text,document_date date,document_status text,customer_code text,customer_name text,product_code text,description text,quantity numeric,unit text,net_amount numeric,line_position integer) language sql as $$select * from crm_dashboard_product_rows(null,null,null,null)$$;

insert into ordini_clienti_cache values('501.00288','MyPharma','AG1',true),('C2','PH customer','AG1',true);
insert into crm_customer_classifications values('501.00288','b2b'),('C2','b2b');
insert into crm_sales_orders values('C2','ph','2026-03-01'),('C1','ph','2025-03-01');
insert into crm_sales_invoices values(8,'FT','E','1','8','2026-05-01','501.00288'),(9,'FT','E','1','9','2026-05-01','C2');
insert into crm_sales_invoice_lines values(18,8,'M','MyPharma item',3,'{}',300,1),(19,9,'PH','PH item',5,'{}',50,1);
\ir ../supabase/migrations/20261031180000_crm_order_purchased_product_query.sql

do $$ declare g record; n integer; begin
 select count(*) into n from crm_b2b_order_product_groups('b2b',date '2026-01-01',date '2026-10-31',null,'purchased',500,0,'prof');
 if n<>4 then raise exception 'PR customers with invoices must be included';end if;
 select * into strict g from crm_b2b_order_product_groups('b2b',date '2026-01-01',date '2026-10-31',null,'purchased',500,0,'prof') where code='A';
 if g.quantity<>9 or g.net_amount<>80 or g.documents<>3 or g.unknown_amounts<>1 then raise exception 'PR credits/totals/unknowns changed';end if;
 select * into strict g from crm_b2b_order_product_groups('b2b',date '2026-01-01',date '2026-10-31',null,'purchased',500,0,'ph');
 if g.code<>'PH' or g.net_amount<>50 then raise exception 'PH membership widened';end if;
 select * into strict g from crm_b2b_order_product_groups('mypharma','b2b',date '2026-01-01',date '2026-10-31',null,'purchased',500,0,'prof');
 if g.code<>'M' or g.net_amount<>300 then raise exception 'MyPharma scope changed';end if;
 select count(*) into n from crm_b2b_order_product_groups('regular','b2b',date '2026-01-01',date '2026-10-31',null,'purchased',500,0,'prof');
 if n<>3 then raise exception 'Regular group scope changed';end if;
 if exists(select 1 from crm_b2b_order_product_groups('b2b',date '2026-01-01',date '2026-10-31','AG2','purchased',500,0,'prof')) then raise exception 'Agent scope changed';end if;
 if exists(select 1 from crm_b2b_order_product_groups('online',date '2026-01-01',date '2026-10-31',null,'purchased',500,0,'prof')) then raise exception 'Area scope changed';end if;
 if exists(select 1 from crm_b2b_order_product_groups('b2b',date '2026-01-01',date '2026-10-31',null,'purchased',500,0,'invalid')) then raise exception 'Invalid module scope widened';end if;
 if exists(select 1 from crm_b2b_order_product_groups('mypharma','b2b',date '2026-01-01',date '2026-10-31',null,'purchased',500,0,'ph')) then raise exception 'Invalid group/module combination widened';end if;
 select * into strict g from crm_b2b_order_product_groups('b2b',date '2026-01-01',date '2026-10-31',null,'purchased',1,1,'prof');
 if g.code<>'A' then raise exception 'Product pagination changed';end if;
 select count(*) into n from crm_b2b_order_product_detail_lines('b2b',date '2026-01-01',date '2026-10-31',null,'purchased','A',500,0,'prof');
 if n<>3 then raise exception 'Missing PR detail lines';end if;
 if not exists(select 1 from crm_b2b_order_product_detail_lines('regular','b2b',date '2026-01-01',date '2026-10-31',null,'purchased','A',1,1,'prof') where quantity=-2 and net_amount=-20) then raise exception 'Grouped detail pagination or credit changed';end if;
 if exists(select 1 from crm_b2b_order_product_detail_lines('b2b',date '2026-01-01',date '2026-10-31',null,'purchased','A',500,0,'ph')) then raise exception 'PH detail scope widened';end if;
 if exists(select 1 from crm_b2b_order_product_detail_lines('regular','b2b',date '2026-01-01',date '2026-10-31',null,'purchased','M',500,0,'prof')) then raise exception 'Grouped detail scope widened';end if;
 if exists(select 1 from crm_b2b_order_product_detail_lines('b2b',date '2026-01-01',date '2026-10-31',null,'purchased',null,500,0,'prof')) then raise exception 'Null product widened';end if;
 if not exists(select 1 from crm_b2b_order_product_groups('b2b',date '2026-01-01',date '2026-10-31',null,'ordered',500,0,'prof') where code='ORDERED') then raise exception 'Order fallback changed';end if;
 if not exists(select 1 from crm_b2b_order_product_detail_lines('regular','b2b',date '2026-01-01',date '2026-10-31',null,'ordered','ORDERED',500,0,'prof')) then raise exception 'Grouped detail fallback changed';end if;
end $$;
