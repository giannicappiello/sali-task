begin;
create table if not exists public.workspace_product_import_exclusions (
  article_code text primary key,
  reason text not null,
  previous_flags jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.workspace_product_import_exclusions enable row level security;
revoke all on public.workspace_product_import_exclusions from public, anon, authenticated;
grant all on public.workspace_product_import_exclusions to service_role;
with excluded as (
 select coalesce(p.codice_mexal,c.codice_articolo) code,
 case when concat_ws(' ',p.brand_mexal,p.linea_mexal,p.categoria_mexal,p.sottocategoria_mexal) ilike '%fuori produzione%' then 'fuori_produzione' else 'non_attivo' end reason,
 jsonb_build_object('productId',p.id,'attivo',p.attivo,'attivo_mexal',p.attivo_mexal,'mostra_in_app',p.mostra_in_app,'stato',p.stato,'cache_visible',c.mostra_in_app) previous_flags
 from public.prodotti p full join public.ordini_prodotti_cache c on c.codice_articolo=p.codice_mexal
 where coalesce(p.codice_mexal,c.codice_articolo) ilike 'IT%'
 and (concat_ws(' ',p.brand_mexal,p.linea_mexal,p.categoria_mexal,p.sottocategoria_mexal) ilike '%fuori produzione%'
 or p.attivo_mexal is false
 or upper(btrim(coalesce(c.dati_mexal->>'gest_annullato',c.dati_mexal->>'annullato',c.dati_mexal->>'articolo_annullato','N'))) in ('S','Y','TRUE','1')
 or upper(btrim(coalesce(c.dati_mexal->>'gest_precanc',c.dati_mexal->>'precancellato',c.dati_mexal->>'articolo_precancellato','N'))) in ('S','Y','TRUE','1'))
)
insert into public.workspace_product_import_exclusions(article_code,reason,previous_flags)
select code,reason,previous_flags from excluded on conflict(article_code) do nothing;
update public.prodotti p set attivo=false,attivo_mexal=false,mostra_in_app=false,stato='Non attivo',updated_at=now()
from public.workspace_product_import_exclusions e where p.codice_mexal=e.article_code and p.sincronizzato_mexal=true;
update public.ordini_prodotti_cache c set mostra_in_app=false from public.workspace_product_import_exclusions e where c.codice_articolo=e.article_code;
commit;
