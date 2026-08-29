begin;

-- Ordini commerciali e OCT restano due run distinti per audit, ma condividono
-- l'abilitazione del ciclo automatico esposto dalla card "Ordini e OCT".
update public.mexal_sync_schedules as oct_schedule
set enabled = orders_schedule.enabled,
    updated_at = now()
from public.mexal_sync_schedules as orders_schedule
where oct_schedule.sync_type = 'oct_orders'
  and orders_schedule.sync_type = 'orders'
  and oct_schedule.enabled is distinct from orders_schedule.enabled;

-- Il wrapper conserva lock, idempotenza, lease e retry dell'RPC esistente,
-- correggendo il lineage: il refresh nasce ora soltanto dal pulsante Aggiorna.
create or replace function public.enqueue_manual_workbench_oct_refresh(
  p_requested_by uuid default null,
  p_requested_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
  v_cycle_id public.mexal_sync_cycles.id%type;
  v_job_id public.mexal_sync_jobs.id%type;
begin
  v_result := public.enqueue_workbench_oct_refresh(p_requested_by, p_requested_at);
  select id into strict v_cycle_id
  from public.mexal_sync_cycles
  where id::text = (v_result ->> 'cycleId');

  select id into strict v_job_id
  from public.mexal_sync_jobs
  where id::text = (v_result ->> 'jobId');

  -- Se esiste già un job automatico attivo, il Workbench lo segue senza
  -- riscriverne l'origine. Aggiorniamo il lineage soltanto per il nuovo job.
  if coalesce((v_result ->> 'queued')::boolean, false) then
    update public.mexal_sync_cycles
    set metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'producer', 'workbench_manual_refresh',
      'requestedBy', p_requested_by,
      'requestedAt', p_requested_at,
      'syncType', 'oct_orders'
    )
    where id = v_cycle_id;

    update public.mexal_sync_jobs
    set payload = coalesce(payload, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'trigger', 'workbench_manual_refresh',
      'requested_by', p_requested_by
    )
    where id = v_job_id
      and sync_type = 'oct_orders';
  end if;

  return v_result;
end;
$$;

revoke all on function public.enqueue_manual_workbench_oct_refresh(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.enqueue_manual_workbench_oct_refresh(uuid, timestamptz)
  to service_role;

comment on function public.enqueue_manual_workbench_oct_refresh(uuid, timestamptz) is
  'Accoda idempotentemente oct_orders dal pulsante Aggiorna del Workbench.';

commit;
