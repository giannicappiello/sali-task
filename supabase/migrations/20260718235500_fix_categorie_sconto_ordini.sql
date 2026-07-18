begin;

-- 1. Allinea la categoria sconto cliente usata dal modulo ordini.
update public.ordini_clienti_cache
set categoria_sconto_cliente = categoria_sconti
where coalesce(categoria_sconto_cliente, 0) <= 0
  and coalesce(categoria_sconti, 0) > 0;

-- 2. Recupera la categoria sconto articolo dal JSON Mexal quando la colonna è vuota.
update public.ordini_prodotti_cache
set categoria_sconto = coalesce(
  case
    when coalesce(dati_mexal ->> 'id_cat_sconto', '') ~ '^[0-9]+$'
      then (dati_mexal ->> 'id_cat_sconto')::integer
  end,
  case
    when coalesce(dati_mexal ->> 'categoria_sconto', '') ~ '^[0-9]+$'
      then (dati_mexal ->> 'categoria_sconto')::integer
  end,
  case
    when coalesce(dati_mexal ->> 'cod_cat_sconto', '') ~ '^[0-9]+$'
      then (dati_mexal ->> 'cod_cat_sconto')::integer
  end,
  categoria_sconto
)
where coalesce(categoria_sconto, 0) <= 0;

-- 3. Consente agli utenti autenticati di leggere le condizioni commerciali.
alter table public.ordini_sconti_listini enable row level security;
alter table public.ordini_particolarita enable row level security;
alter table public.ordini_regole_pagamento enable row level security;

drop policy if exists "ordini_sconti_listini_select_authenticated"
  on public.ordini_sconti_listini;
create policy "ordini_sconti_listini_select_authenticated"
  on public.ordini_sconti_listini
  for select
  to authenticated
  using (true);

drop policy if exists "ordini_particolarita_select_authenticated"
  on public.ordini_particolarita;
create policy "ordini_particolarita_select_authenticated"
  on public.ordini_particolarita
  for select
  to authenticated
  using (true);

drop policy if exists "ordini_regole_pagamento_select_authenticated"
  on public.ordini_regole_pagamento;
create policy "ordini_regole_pagamento_select_authenticated"
  on public.ordini_regole_pagamento
  for select
  to authenticated
  using (true);

grant select on public.ordini_sconti_listini to authenticated;
grant select on public.ordini_particolarita to authenticated;
grant select on public.ordini_regole_pagamento to authenticated;

commit;
