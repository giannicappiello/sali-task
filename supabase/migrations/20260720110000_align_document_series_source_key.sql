-- source_key is the single stable key used by the API upsert.
-- The base table already declares it NOT NULL; repeat defensively for older installs.
alter table public.ordini_serie_documenti
  alter column source_key set not null;

-- Keep one deterministic row if an older/manual database contains duplicate source keys.
with ranked as (
  select id, row_number() over (partition by source_key order by sincronizzata_il desc nulls last, id desc) as row_number
  from public.ordini_serie_documenti
)
delete from public.ordini_serie_documenti target
using ranked
where target.id = ranked.id and ranked.row_number > 1;

-- Remove the unused alternate uniqueness introduced by the previous migration.
drop index if exists public.ordini_serie_documenti_codice_univoco_key;
create unique index if not exists ordini_serie_documenti_source_key_unique
  on public.ordini_serie_documenti(source_key);
