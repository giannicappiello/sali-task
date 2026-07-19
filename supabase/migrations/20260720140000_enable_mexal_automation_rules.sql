-- Automazioni configurabili dal Centro Mexal. Il cron Vercel esegue solo le
-- regole abilitate e la console permette avvii manuali controllati.
update public.mexal_sync_schedules
set enabled = true, updated_at = now()
where sync_type in ('clients', 'products', 'commercial_conditions', 'document_series', 'stocks');
