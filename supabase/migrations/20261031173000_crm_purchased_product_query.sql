begin;
set local lock_timeout='5s';

-- Purchased-only reads must not compute the unrelated orders/allocations branch.
create or replace function public.crm_dashboard_purchased_product_rows(p_crm_type text,p_from date,p_to date,p_agent text default null,p_product text default null)
returns table(category text,line_id text,document_id text,document_number text,document_date date,document_status text,customer_code text,customer_name text,product_code text,description text,quantity numeric,unit text,net_amount numeric,line_position integer)
language sql stable security definer set search_path=public as $function$
with visible_customers as materialized (
 select cc.codice_cliente,cc.ragione_sociale
 from public.ordini_clienti_cache cc
 join public.crm_customer_classifications c on c.codice_cliente=cc.codice_cliente
 where c.area_crm=p_crm_type
 and cc.codice_cliente in(select public.crm_visible_canonical_customer_codes())
 and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
 and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
)
select 'purchased'::text,'invoice:'||l.id::text,f.id::text,
 f.sigla||f.cod_modulo||' '||f.serie||'/'||f.numero,
 f.data_documento,'Documento sincronizzato'::text,f.codice_cliente,cc.ragione_sociale,
 l.codice_articolo,coalesce(nullif(l.descrizione,''),l.codice_articolo),
 case when upper(f.sigla)='NC' then -abs(l.quantita) else l.quantita end,
 coalesce(nullif(l.dati_mexal->>'unita_misura',''),nullif(l.dati_mexal->>'um','')),
 case when upper(f.sigla)='NC' then -abs(l.valore_netto) else l.valore_netto end,
 coalesce(l.posizione,0)
from public.crm_sales_invoices f
join public.crm_sales_invoice_lines l on l.fattura_id=f.id
join visible_customers cc on cc.codice_cliente=f.codice_cliente
where f.data_documento between p_from and p_to
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
and (p_product is null or l.codice_articolo=p_product)
;
$function$;

create or replace function public.crm_dashboard_product_groups(p_crm_type text,p_from date,p_to date,p_agent text default null,p_category text default null,p_limit integer default 500,p_offset integer default 0)
returns table(code text,description text,quantity numeric,documents bigint,net_amount numeric,unknown_amounts bigint)
language plpgsql stable security definer set search_path=public as $function$
begin
 if p_category='purchased' then
  return query
select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null)
 from public.crm_dashboard_purchased_product_rows(p_crm_type,p_from,p_to,p_agent,null) x where x.category=p_category
 group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
 limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
  return;
 end if;
 return query
select x.product_code,(array_agg(x.description order by x.document_date desc,x.line_id))[1],sum(x.quantity),count(distinct x.document_id),
 coalesce(sum(x.net_amount),0),count(*) filter(where x.net_amount is null)
 from public.crm_dashboard_product_rows(p_crm_type,p_from,p_to,p_agent) x where x.category=p_category
 group by x.product_code order by coalesce(sum(x.net_amount),0) desc,x.product_code
 limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
end;
$function$;

create or replace function public.crm_dashboard_product_detail_lines(p_crm_type text,p_from date,p_to date,p_agent text default null,p_category text default null,p_product text default null,p_limit integer default 500,p_offset integer default 0)
returns table(category text,line_id text,document_id text,document_number text,document_date date,document_status text,customer_code text,customer_name text,product_code text,description text,quantity numeric,unit text,net_amount numeric,line_position integer)
language plpgsql stable security definer set search_path=public as $function$
begin
 if p_category='purchased' then
  return query select x.* from public.crm_dashboard_purchased_product_rows(p_crm_type,p_from,p_to,p_agent,p_product) x
   where x.category=p_category and x.product_code=p_product
   order by x.document_date desc,x.document_id,x.line_id
   limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
  return;
 end if;
 return query select x.* from public.crm_dashboard_product_rows(p_crm_type,p_from,p_to,p_agent) x
  where x.category=p_category and x.product_code=p_product
  order by x.document_date desc,x.document_id,x.line_id
  limit greatest(1,least(coalesce(p_limit,500),1000)) offset greatest(coalesce(p_offset,0),0);
end;
$function$;
revoke all on function public.crm_dashboard_purchased_product_rows(text,date,date,text,text) from public,anon;
grant execute on function public.crm_dashboard_purchased_product_rows(text,date,date,text,text) to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
