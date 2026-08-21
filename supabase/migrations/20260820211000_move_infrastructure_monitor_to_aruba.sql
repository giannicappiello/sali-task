begin;

-- Il controllo viene eseguito dal cron Aruba già attivo ogni 10 minuti,
-- tramite /api/mexal/queue-worker. Evita un secondo pianificatore Supabase.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'infrastructure-health-monitor-every-5-minutes';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

commit;
