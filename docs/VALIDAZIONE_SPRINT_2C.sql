-- 1. Controllo disponibilità regole
select
  (select count(*) from public.ordini_sconti_listini where is_active = true) as matrice_attiva,
  (select count(*) from public.ordini_particolarita where is_active = true) as particolarita_attive,
  (select count(*) from public.ordini_regole_pagamento where is_active = true) as pagamenti_attivi;

-- 2. Caso reale noto: cliente categoria 2 + articolo categoria 9 = 50+35
select cod_cat_cli, cod_cat_art, sconto, sconto_esteso
from public.ordini_sconti_listini
where cod_cat_cli = 2 and cod_cat_art = 9 and is_active = true;

-- 3. Controllo righe ordine calcolate dopo il primo ordine di prova
select *
from public.v_ordini_righe_calcolo_commerciale
order by id desc
limit 20;
