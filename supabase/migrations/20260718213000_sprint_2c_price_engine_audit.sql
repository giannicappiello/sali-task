begin;

alter table public.ordini_righe
  add column if not exists regola_prezzo_id bigint,
  add column if not exists regola_sconto_id bigint,
  add column if not exists regola_pagamento_id bigint,
  add column if not exists dettaglio_calcolo jsonb not null default '{}'::jsonb;

create index if not exists idx_ordini_righe_regola_prezzo
  on public.ordini_righe (regola_prezzo_id)
  where regola_prezzo_id is not null;

create index if not exists idx_ordini_righe_regola_sconto
  on public.ordini_righe (regola_sconto_id)
  where regola_sconto_id is not null;

create index if not exists idx_ordini_righe_regola_pagamento
  on public.ordini_righe (regola_pagamento_id)
  where regola_pagamento_id is not null;

create or replace view public.v_ordini_righe_calcolo_commerciale as
select
  r.id,
  r.ordine_id,
  r.codice_articolo,
  r.descrizione,
  r.quantita,
  r.prezzo_listino,
  r.sconto_commerciale,
  r.sconto_pagamento,
  r.sconto_percentuale,
  r.prezzo_netto,
  r.totale_riga,
  r.origine_prezzo,
  r.origine_sconto,
  r.regola_prezzo_id,
  r.regola_sconto_id,
  r.regola_pagamento_id,
  r.dettaglio_calcolo
from public.ordini_righe r;

comment on column public.ordini_righe.dettaglio_calcolo is
  'Snapshot dei dati e delle regole usate dal motore prezzi al momento del salvataggio.';

commit;
