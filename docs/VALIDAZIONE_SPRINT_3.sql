-- 1. Colonne Sprint 3
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'ordini_testate'
  and column_name in (
    'stato_sincronizzazione','errore_sincronizzazione','ultimo_tentativo_sync',
    'sincronizzato_mexal_il','numero_ocm','numero_ocx'
  )
order by column_name;

-- 2. Tabella log
select to_regclass('public.ordini_sync_mexal_log') as tabella_log;

-- 3. Ultimi ordini e stato invio
select id, data_ordine, codice_cliente, stato, stato_sincronizzazione,
       numero_ocm, numero_ocx, errore_sincronizzazione
from public.ordini_testate
order by created_at desc nulls last
limit 20;

-- 4. Ultimi tentativi Mexal
select ordine_id, tipo_documento, stato, errore, iniziato_il, completato_il
from public.ordini_sync_mexal_log
order by iniziato_il desc
limit 30;
