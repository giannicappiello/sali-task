-- 1. Conteggi dati attivi
select * from public.v_ordini_condizioni_commerciali_conteggi;

-- 2. Ultima esecuzione
select id, status, started_at, completed_at, duration_ms,
       records_read, records_updated, records_deactivated,
       warning_count, error_message, parameters, summary
from public.ordini_sync_runs
where sync_type = 'commercial_conditions'
order by started_at desc
limit 10;

-- 3. Dettagli ultima esecuzione
with ultima as (
  select id from public.ordini_sync_runs
  where sync_type = 'commercial_conditions'
  order by started_at desc limit 1
)
select d.*
from public.ordini_sync_run_details d
join ultima u on u.id = d.run_id
order by d.created_at;

-- 4. Caso reale certificato: cliente categoria 2 + articolo categoria 9
select cod_cat_cli, cod_cat_art, sconto, sconto_esteso,
       sconto_normalizzato, sconto_equivalente, is_active, last_seen_at
from public.ordini_sconti_listini
where cod_cat_cli = 2 and cod_cat_art = 9;

-- Atteso: sconto_esteso / sconto_normalizzato = 50+35

-- 5. Verifica che non esistano duplicati matrice
select cod_cat_cli, cod_cat_art, count(*)
from public.ordini_sconti_listini
group by cod_cat_cli, cod_cat_art
having count(*) > 1;

-- 6. Errori non risolti
select *
from public.ordini_sync_errors
where resolved_at is null
order by created_at desc;
