begin;
create or replace function public.crm_open_order_category_details(
 p_scope text,p_from date,p_to date,p_category text,p_crm_type text default null,
 p_business text default null,p_market text default null,p_country text default null,
 p_agent text default null,p_channel text default null,p_customer text default null,
 p_limit integer default 200,p_offset integer default 0)
returns table(order_id uuid,order_number text,customer_code text,customer_name text,document_date date,module_code text,amount numeric)
language sql stable security definer set search_path=public as $$
 with amounts as materialized(select * from public.crm_verified_open_order_values_v2()), rows as (
 select ds.order_id,coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text) order_number,
 ds.customer_code,ds.customer_name,ds.document_date,o.modulo_ordini module_code,
 case p_category when 'pr' then v.pr_amount when 'stralci' then v.stralci_amount
 when 'ph' then v.ph_amount when 'ph_reservations' then case when o.modulo_ordini='ph' then v.prenotazioni_amount else 0 end
 when 'pr_reservations' then case when o.modulo_ordini='prof' then v.prenotazioni_amount else 0 end end amount
 from public.crm_commercial_control_order_dataset(p_scope,p_from,p_to,p_business,p_market,p_country,p_agent,p_channel,p_customer) ds
 join public.ordini_testate o on o.id=ds.order_id join amounts v on v.order_id=ds.order_id
 where p_crm_type is null or exists(select 1 from public.crm_customer_classifications c where c.codice_cliente=ds.customer_code and c.area_crm=p_crm_type)
 ) select * from rows where amount <> 0 order by document_date desc,order_id
 limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
$$;
revoke all on function public.crm_open_order_category_details(text,date,date,text,text,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.crm_open_order_category_details(text,date,date,text,text,text,text,text,text,text,text,integer,integer) to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
