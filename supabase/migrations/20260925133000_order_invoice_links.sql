begin;
set local lock_timeout='5s';
-- Invoker rights preserve the existing order and invoice row-level permissions.
create or replace function public.workspace_order_invoice_links(p_order_ids uuid[])
returns table(ordine_id uuid, invoice jsonb, expected_lines jsonb)
language sql stable security invoker set search_path=pg_catalog,public as $$
with target as (
 select o.* from public.ordini_testate o where o.id=any(p_order_ids) and o.modulo_ordini<>'ph'
), candidates as (
 select d.ordine_id,d.id document_id,f.id invoice_id,f.sigla,f.serie,f.numero,f.data_documento,f.dati_mexal,
  count(*) over(partition by f.id,n.value->>0) matches
 from public.mexal_fatture_vendita f
 cross join lateral jsonb_array_elements(case when jsonb_typeof(f.dati_mexal->'numero_ordine')='array' then f.dati_mexal->'numero_ordine' else '[]'::jsonb end) n(value)
 join public.ordini_testate o on o.codice_cliente=f.codice_cliente
 join public.ordini_documenti_mexal d on d.ordine_id=o.id and d.numero=n.value->>1
 where f.sigla='FT' and exists(select 1 from target t where t.codice_cliente=f.codice_cliente)
 and o.modulo_ordini<>'ph'
 and exists(select 1 from jsonb_array_elements(coalesce(f.dati_mexal->'sigla_ordine','[]'::jsonb)) s where s->>0=n.value->>0 and s->>1=coalesce(nullif(d.sigla,''),'OC'))
 and exists(select 1 from jsonb_array_elements(coalesce(f.dati_mexal->'data_ordine','[]'::jsonb)) dt where dt->>0=n.value->>0 and left(dt->>1,4)=d.anno::text)
), linked as (
 select distinct c.ordine_id,c.invoice_id,c.sigla,c.serie,c.numero,c.data_documento,c.dati_mexal
 from candidates c join target t on t.id=c.ordine_id where c.matches=1
)
select l.ordine_id,
 jsonb_build_object('id',l.invoice_id,'sigla',l.sigla,'serie',l.serie,'numero',l.numero,'data_documento',l.data_documento,
 'single_order',jsonb_array_length(l.dati_mexal->'numero_ordine')=1,
 'articles',l.dati_mexal->'codice_articolo','quantities',l.dati_mexal->'quantita','units',l.dati_mexal->'tp_um_articolo'),
 (select coalesce(jsonb_agg(jsonb_build_object('code',r.codice_articolo,'quantity',r.quantita,'unit',r.tipo_unita_misura_mexal)),'[]'::jsonb)
 from public.ordini_righe r where r.ordine_id=l.ordine_id and coalesce(r.riga_descrittiva,false)=false and r.codice_articolo is not null)
from linked l;
$$;
revoke all on function public.workspace_order_invoice_links(uuid[]) from public,anon;
grant execute on function public.workspace_order_invoice_links(uuid[]) to authenticated,service_role;
commit;
