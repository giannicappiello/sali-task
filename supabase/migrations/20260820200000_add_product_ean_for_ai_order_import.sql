begin;

alter table if exists public.ordini_prodotti_cache
  add column if not exists ean text;

comment on column public.ordini_prodotti_cache.ean is
  'Codice EAN sincronizzato da Mexal e usato per il riconoscimento ordini da foto o PDF.';

commit;
