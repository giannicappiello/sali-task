begin;

-- Add invoiced products to the existing paginated dashboard dataset.
create or replace function public.crm_dashboard_product_lines(p_crm_type text,p_from date,p_to date,p_agent text default null,p_limit integer default 200,p_offset integer default 0)
returns table(category text,line_id text,document_id text,document_number text,document_date date,document_status text,
customer_code text,customer_name text,product_code text,description text,quantity numeric,unit text,net_amount numeric,line_position integer)
language sql stable security definer set search_path=public as $$
with visible_orders as materialized (
 select o.*,cc.ragione_sociale customer_name from public.ordini_testate o
 join public.crm_customer_classifications c on c.codice_cliente=o.codice_cliente
 join public.ordini_clienti_cache cc on cc.codice_cliente=o.codice_cliente
 where o.data_ordine between p_from and p_to and c.area_crm=p_crm_type
 and o.codice_cliente in(select public.crm_visible_canonical_customer_codes())
 and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
 and o.modulo_ordini in ('ph','prof') and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
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

), allocations as (
 select o.id,case when o.tipo_ordine='prenotazione' then 'reserved' else 'ordered' end category,
 r.id row_id,'PH'::text kind,r.quantita::numeric quantity
 from visible_orders o join public.ordini_righe r on r.ordine_id=o.id where o.modulo_ordini='ph'
 union all
 select o.id,case when d.tipo_documento='OCI' then 'reserved' else 'ordered' end,r.id,d.tipo_documento,
 (case d.tipo_documento when 'OCM' then r.quantita_ocm when 'OCX' then r.quantita_ocx when 'OCI' then r.quantita_oci end)::numeric
 from visible_orders o join open_documents d on d.id=o.id join public.ordini_righe r on r.ordine_id=o.id
)
select a.category,r.id::text||':'||a.kind,o.id::text||':'||a.kind,
 a.kind||' '||coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.numero_progressivo::text,o.id::text),
 o.data_ordine,case when a.kind='PH' then o.stato else 'APERTO' end,o.codice_cliente,o.customer_name,
 r.codice_articolo,coalesce(nullif(r.descrizione,''),r.codice_articolo),a.quantity,
 coalesce(nullif(btrim(r.unita_misura_oct),''),nullif(btrim(r.tipo_unita_misura_mexal),'')),
 case when a.kind='PH' then coalesce(r.imponibile_riga,a.quantity*r.prezzo_netto)
 else a.quantity*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0)) end,
 coalesce(r.mexal_posizione,0)
from allocations a join visible_orders o on o.id=a.id join public.ordini_righe r on r.id=a.row_id
where a.quantity>0 and nullif(btrim(r.codice_articolo),'') is not null
and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
union all
select 'purchased','invoice:'||l.id::text,f.id::text,
 f.sigla||f.cod_modulo||' '||f.serie||'/'||f.numero,
 f.data_documento,'Documento sincronizzato',f.codice_cliente,cc.ragione_sociale,
 l.codice_articolo,coalesce(nullif(l.descrizione,''),l.codice_articolo),
 case when upper(f.sigla)='NC' then -abs(l.quantita) else l.quantita end,
 coalesce(nullif(l.dati_mexal->>'unita_misura',''),nullif(l.dati_mexal->>'um','')),
 case when upper(f.sigla)='NC' then -abs(l.valore_netto) else l.valore_netto end,
 coalesce(l.posizione,0)
from public.mexal_fatture_vendita f
join public.mexal_fatture_vendita_righe l on l.fattura_id=f.id
join public.crm_customer_classifications c on c.codice_cliente=f.codice_cliente
join public.ordini_clienti_cache cc on cc.codice_cliente=f.codice_cliente
where f.data_documento between p_from and p_to and c.area_crm=p_crm_type
and f.codice_cliente in(select public.crm_visible_canonical_customer_codes())
and c.area_crm=any((select public.crm_visible_customer_areas())::text[])
and (nullif(p_agent,'') is null or cc.codice_agente_mexal=p_agent)
and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
order by 1,3,2
limit greatest(1,least(coalesce(p_limit,200),1000)) offset greatest(coalesce(p_offset,0),0);
$$;

notify pgrst,'reload schema';
commit;
