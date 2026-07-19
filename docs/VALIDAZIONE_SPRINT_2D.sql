-- 1. Conteggio regole attive
select
  (select count(*) from public.ordini_sconti_listini where is_active = true) as matrice_attiva,
  (select count(*) from public.ordini_particolarita where is_active = true) as particolarita_attive,
  (select count(*) from public.ordini_regole_pagamento where is_active = true) as pagamenti_attivi;

-- 2. Verifica matrice per categoria cliente 2 e articolo 9
select cod_cat_cli, cod_cat_art, sconto, sconto_esteso
from public.ordini_sconti_listini
where cod_cat_cli = 2
  and cod_cat_art = 9
  and is_active = true;

-- 3. Verifica categorie cliente e articolo usate dal motore
select codice_cliente, ragione_sociale, categoria_sconti,
       categoria_sconto_cliente, codice_listino, codice_pagamento
from public.ordini_clienti_cache
where codice_cliente = '501.00844';

select codice_articolo, descrizione, categoria_sconto, prezzo_listino
from public.ordini_prodotti_cache
where upper(codice_articolo) = 'IT0001';

-- 4. Verifica policy SELECT
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'ordini_sconti_listini',
    'ordini_particolarita',
    'ordini_regole_pagamento'
  )
order by tablename, policyname;
