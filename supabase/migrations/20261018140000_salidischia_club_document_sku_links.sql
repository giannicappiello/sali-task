begin;
-- Existing NAS technical sheets use the exact Mexal SKU as their file name.
-- Preserve all explicit links; do not infer a product from a partial code or name.
with exact_skus as materialized (
 select upper(btrim(p.codice_mexal)) as code,min(p.id::text)::uuid as product_id,min(p.nome) as name
 from public.prodotti p where public.club_catalog_eligible(p)
 group by upper(btrim(p.codice_mexal)) having count(*)=1
)
update public.documenti_workspace d set prodotto_id=p.product_id,prodotto=p.name,aggiornato_il=clock_timestamp()
from exact_skus p,public.sezioni_documentali s
where d.sezione_id=s.id and lower(btrim(s.nome))='schede tecniche' and s.attiva and d.attivo and d.prodotto_id is null
and upper(btrim(regexp_replace(d.nome_file,'\.[^.]+$','')))=p.code;
notify pgrst,'reload schema';
commit;
