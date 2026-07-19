-- Sprint 2D - Motore commerciale definitivo
-- Non introduce margine o ricarico.
-- Garantisce lettura delle condizioni commerciali agli utenti autenticati
-- e aggiunge indici per velocizzare il calcolo in Nuovo ordine.

alter table if exists public.ordini_sconti_listini enable row level security;
alter table if exists public.ordini_particolarita enable row level security;
alter table if exists public.ordini_regole_pagamento enable row level security;

drop policy if exists "ordini_sconti_listini_select_authenticated" on public.ordini_sconti_listini;
create policy "ordini_sconti_listini_select_authenticated"
on public.ordini_sconti_listini
for select to authenticated
using (true);

drop policy if exists "ordini_particolarita_select_authenticated" on public.ordini_particolarita;
create policy "ordini_particolarita_select_authenticated"
on public.ordini_particolarita
for select to authenticated
using (true);

drop policy if exists "ordini_regole_pagamento_select_authenticated" on public.ordini_regole_pagamento;
create policy "ordini_regole_pagamento_select_authenticated"
on public.ordini_regole_pagamento
for select to authenticated
using (true);

create index if not exists idx_ordini_sconti_listini_lookup
  on public.ordini_sconti_listini (cod_cat_cli, cod_cat_art)
  where is_active = true;

create index if not exists idx_ordini_particolarita_active_type
  on public.ordini_particolarita (tipo_part, tp_dato_conto, tp_dato_art)
  where is_active = true;

create index if not exists idx_ordini_regole_pagamento_lookup
  on public.ordini_regole_pagamento (codice_pagamento)
  where is_active = true;
