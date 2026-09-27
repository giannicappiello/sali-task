begin;
create or replace function public.crm_ordered_product_details(p_crm_type text,p_from date,p_to date,p_limit integer default 200,p_offset integer default 0)
returns table(category text,product_code text,description text,unit text,quantity numeric,ph_quantity numeric,pr_quantity numeric,stralci_quantity numeric,order_count bigint)
language sql stable security definer set search_path=public as $$
with visible_orders as materialized (
 select o.* from public.ordini_testate o
 join public.crm_customer_classifications c on c.codice_cliente=o.codice_cliente
 where o.data_ordine between p_from and p_to and c.area_crm=p_crm_type
 and o.codice_cliente in(select public.crm_visible_canonical_customer_codes())
 and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
 and o.modulo_ordini in ('ph','prof')
), invoice_refs as materialized (
 select f.codice_cliente,n->>1 numero,s->>1 sigla,left(dt->>1,4) anno
 from public.mexal_fatture_vendita f
 cross join lateral jsonb_array_elements(coalesce(f.dati_mexal->'numero_ordine','[]'::jsonb)) n
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'sigla_ordine','[]'::jsonb)) s on s->>0=n->>0
 join lateral jsonb_array_elements(coalesce(f.dati_mexal->'data_ordine','[]'::jsonb)) dt on dt->>0=n->>0
 where f.sigla='FT'
), open_documents as materialized (
 select distinct o.id,d.tipo_documento from visible_orders o join public.ordini_documenti_mexal d on d.ordine_id=o.id
 where o.modulo_ordini='prof' and d.tipo_documento in ('OCM','OCX','OCI') and d.stato_operativo='APERTO'
 and d.presente_in_mexal is true and d.ultimo_sync_mexal is not null and d.numero is not null and d.anno is not null
 and not exists(select 1 from invoice_refs f where f.codice_cliente=o.codice_cliente and f.numero=d.numero
 and f.sigla=coalesce(nullif(d.sigla,''),'OC') and f.anno=coalesce(nullif(d.anno,0),extract(year from o.data_ordine)::integer)::text)
), product_lines as (
 select o.id,case when o.tipo_ordine='prenotazione' then 'reserved' else 'ordered' end category,
 r.codice_articolo product_code,r.descrizione description,coalesce(nullif(r.tipo_unita_misura_mexal,''),'Non indicata') unit,
 r.quantita::numeric quantity,'ph' source
 from visible_orders o join public.ordini_righe r on r.ordine_id=o.id
 where o.modulo_ordini='ph' and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,
 r.codice_articolo,r.descrizione,coalesce(nullif(r.tipo_unita_misura_mexal,''),'Non indicata'),
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric,
 case when d.tipo_documento='OCX' then 'stralci' else 'pr' end
 from visible_orders o join open_documents d on d.id=o.id join public.ordini_righe r on r.ordine_id=o.id
 where not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
)
select category,product_code,max(description),unit,sum(quantity),coalesce(sum(quantity) filter(where source='ph'),0),
 coalesce(sum(quantity) filter(where source='pr'),0),coalesce(sum(quantity) filter(where source='stralci'),0),count(distinct id)
from product_lines where nullif(btrim(product_code),'') is not null and quantity>0
 group by category,product_code,unit order by category,product_code,unit
 limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
$$;
revoke all on function public.crm_ordered_product_details(text,date,date,integer,integer) from public,anon;
grant execute on function public.crm_ordered_product_details(text,date,date,integer,integer) to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
