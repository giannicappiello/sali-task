-- The source key is the stable Mexal unique code; retaining it makes retries idempotent.
alter table public.ordini_serie_documenti
  add column if not exists codice_univoco text,
  add column if not exists tipo_documento text;

update public.ordini_serie_documenti
set codice_univoco = source_key
where codice_univoco is null;

create unique index if not exists ordini_serie_documenti_codice_univoco_key
  on public.ordini_serie_documenti(codice_univoco)
  where codice_univoco is not null;
