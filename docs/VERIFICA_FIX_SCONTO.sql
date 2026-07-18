-- A. Verifica il cliente dello screenshot.
select
  codice_cliente,
  ragione_sociale,
  categoria_sconti,
  categoria_sconto_cliente,
  codice_listino
from public.ordini_clienti_cache
where codice_cliente = '501.00844';

-- B. Verifica l'articolo dello screenshot.
select
  codice_articolo,
  descrizione,
  categoria_sconto,
  prezzo_listino,
  disponibilita,
  dati_mexal ->> 'id_cat_sconto' as json_id_cat_sconto
from public.ordini_prodotti_cache
where upper(codice_articolo) = 'IT0001';

-- C. Verifica la regola esatta cliente/articolo.
select
  cod_cat_cli,
  cod_cat_art,
  sconto,
  sconto_esteso,
  is_active
from public.ordini_sconti_listini
where cod_cat_cli = (
  select coalesce(nullif(categoria_sconto_cliente, 0), categoria_sconti)
  from public.ordini_clienti_cache
  where codice_cliente = '501.00844'
)
and cod_cat_art = (
  select categoria_sconto
  from public.ordini_prodotti_cache
  where upper(codice_articolo) = 'IT0001'
)
and is_active = true;

-- D. Verifica quantità di regole e policy.
select
  (select count(*) from public.ordini_sconti_listini where is_active = true) as matrice_attiva,
  (select count(*) from public.ordini_particolarita where is_active = true) as particolarita_attive,
  (select count(*) from public.ordini_regole_pagamento where is_active = true) as pagamenti_attivi;

select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'ordini_sconti_listini',
    'ordini_particolarita',
    'ordini_regole_pagamento'
  )
order by tablename, policyname;
