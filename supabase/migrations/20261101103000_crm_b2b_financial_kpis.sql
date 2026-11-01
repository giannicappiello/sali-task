
-- Shared net document basis for the B2B financial KPIs and their drilldowns.
create function public.crm_period_months(p_from date,p_to date) returns numeric
language sql immutable parallel safe as $months$
 select sum((least(p_to,(m+interval '1 month - 1 day')::date)-greatest(p_from,m::date)+1)::numeric/extract(day from m+interval '1 month - 1 day'))
 from generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_to::timestamp),interval '1 month') m
 where p_from<=p_to
$months$;
revoke all on function public.crm_period_months(date,date) from public,anon;
grant execute on function public.crm_period_months(date,date) to authenticated,service_role;

create function public.crm_b2b_financial_documents(p_from date,p_to date,p_agent text default null,p_order_module text default null,p_customer_group text default null)
returns table(id text,kind text,document_number text,document_date date,customer_code text,customer_name text,module_code text,net_amount numeric)
language plpgsql stable security definer set search_path=public as $docs$
declare codes text[];
begin
 if p_from is null or p_to is null or p_from>p_to then raise exception 'Periodo non valido';end if;
 if coalesce(p_order_module,'') not in ('','ph','prof') or coalesce(p_customer_group,'') not in ('','all','regular','mypharma') then raise exception 'Perimetro B2B non valido';end if;
 if not public.crm_has_module_level(public.crm_module_for_type('b2b'),'lettura') and auth.role()<>'service_role' then raise exception 'Accesso CRM B2B non autorizzato' using errcode='42501';end if;
 if p_order_module is not null then
  select coalesce(array_agg(c.customer_code),'{}'::text[]) into codes from public.crm_b2b_order_customers(coalesce(p_customer_group,'all'),p_order_module,p_from,p_to,p_agent)c;
 end if;
 return query
 with customers as materialized(
  select c.codice_cliente,c.ragione_sociale from public.crm_customer_classifications x
  join public.ordini_clienti_cache c using(codice_cliente)
  where x.area_crm='b2b' and x.area_crm=any((select public.crm_visible_customer_areas())::text[])
   and x.codice_cliente in(select public.crm_visible_canonical_customer_codes())
   and (nullif(p_agent,'') is null or c.codice_agente_mexal=p_agent)
   and (codes is null or c.codice_cliente=any(codes))
 ), verified as materialized(select * from public.crm_verified_open_order_values_v2())
 select 'invoice:'||f.id::text,'invoice'::text,concat_ws(' ',f.sigla,concat(f.serie,'/',f.numero)),f.data_documento,
 c.codice_cliente,c.ragione_sociale,null::text,f.net_amount
 from public.crm_invoice_financials f join customers c on c.codice_cliente=f.codice_cliente
 where f.data_documento between p_from and p_to
 union all
 select 'order:'||o.id::text,'order'::text,coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text),o.data_ordine,
 c.codice_cliente,c.ragione_sociale,o.modulo_ordini,(v.pr_amount+v.stralci_amount+v.ph_amount+v.oct_amount+v.prenotazioni_amount)::numeric
 from public.crm_sales_orders o join customers c on c.codice_cliente=o.codice_cliente join verified v on v.order_id=o.id
 where o.data_ordine between p_from and p_to and (p_order_module is null or o.modulo_ordini=p_order_module);
end $docs$;
revoke all on function public.crm_b2b_financial_documents(date,date,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_b2b_financial_documents(date,date,text,text,text) to service_role;

create function public.crm_b2b_financial_kpis(p_from date,p_to date,p_agent text default null,p_order_module text default null,p_customer_group text default null)
returns jsonb language sql stable security definer set search_path=public as $kpis$
 with docs as materialized(select * from public.crm_b2b_financial_documents(p_from,p_to,p_agent,p_order_module,p_customer_group)),
 totals as(
 select count(*)filter(where kind='invoice') invoice_count,
 count(*)filter(where kind='invoice' and net_amount is null) unknown_invoices,
 coalesce(sum(net_amount)filter(where kind='invoice'),0) invoice_total,
 count(*)filter(where kind='order') order_count,coalesce(sum(net_amount)filter(where kind='order'),0) order_total,
 count(*)filter(where kind='order' and module_code='ph') ph_order_count,
 coalesce(sum(net_amount)filter(where kind='order' and module_code='ph'),0) ph_order_total,
 count(*)filter(where kind='order' and module_code='ph' and net_amount is null) unknown_ph_orders,
 count(*)filter(where net_amount is null) unknown_documents,
 count(distinct customer_code)filter(where net_amount<>0) contributors,
 coalesce(sum(net_amount),0) combined_total from docs
 )
 select to_jsonb(t)||jsonb_build_object('months',public.crm_period_months(p_from,p_to),
 'average_ph_order',case when unknown_ph_orders=0 then ph_order_total/nullif(ph_order_count,0) end,
 'average_invoice',case when unknown_invoices=0 then invoice_total/nullif(invoice_count,0) end,
 'monthly_consumption',case when unknown_documents=0 then combined_total/nullif(contributors,0)/nullif(public.crm_period_months(p_from,p_to),0) end)
 from totals t
$kpis$;

create function public.crm_b2b_financial_details(p_metric text,p_from date,p_to date,p_agent text default null,p_order_module text default null,p_customer_group text default null,p_limit integer default 200,p_offset integer default 0)
returns setof jsonb language plpgsql stable security definer set search_path=public as $detail$
begin
 if p_metric not in('ph_average','invoice_average','monthly_consumption') or p_metric is null then raise exception 'Dettaglio finanziario non valido';end if;
 return query
 with docs as materialized(select * from public.crm_b2b_financial_documents(p_from,p_to,p_agent,p_order_module,p_customer_group)),
 clients as(
 select customer_code,max(customer_name) customer_name,
 count(*)filter(where kind='order') order_count,coalesce(sum(net_amount)filter(where kind='order'),0) order_total,
 count(*)filter(where kind='invoice') invoice_count,coalesce(sum(net_amount)filter(where kind='invoice'),0) invoice_total,
 sum(net_amount) combined_total, count(*)filter(where net_amount is null) unknown_documents,
 count(*)filter(where net_amount<>0) contributing_documents
 from docs group by customer_code
 ), result as(
 select d.id key,d.document_date sort_date,to_jsonb(d) row from docs d where (p_metric='ph_average' and d.kind='order' and d.module_code='ph')or(p_metric='invoice_average' and d.kind='invoice')
 union all
 select c.customer_code,null::date,to_jsonb(c)||jsonb_build_object('id',c.customer_code,'monthly_amount',c.combined_total/nullif(public.crm_period_months(p_from,p_to),0)) from clients c
 where p_metric='monthly_consumption' and (c.contributing_documents>0 or c.unknown_documents>0)
 )
 select r.row from result r order by r.sort_date desc nulls last,r.key
 limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
end $detail$;
revoke all on function public.crm_b2b_financial_kpis(date,date,text,text,text) from public,anon;
grant execute on function public.crm_b2b_financial_kpis(date,date,text,text,text) to authenticated,service_role;
revoke all on function public.crm_b2b_financial_details(text,date,date,text,text,text,integer,integer) from public,anon;
grant execute on function public.crm_b2b_financial_details(text,date,date,text,text,text,integer,integer) to authenticated,service_role;
notify pgrst,'reload schema';
