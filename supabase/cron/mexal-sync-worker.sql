-- Copia operativa della configurazione inclusa nella migration 20260725190000.
-- Secret Vault richiesti prima dell'attivazione:
-- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SECRET.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'mexal-sync-worker-every-minute';
