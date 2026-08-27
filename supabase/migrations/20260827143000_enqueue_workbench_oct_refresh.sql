begin;

-- Accoda una riconciliazione OCT richiesta dall'apertura del Workbench senza
-- eseguire l'importer nella request web. Il job viene reclamato dal normale
-- queue worker e conserva quindi lease, retry, telemetria e risultato.
create or replace function public.enqueue_workbench_oct_refresh(
  p_requested_by uuid default null,
  p_requested_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_timezone constant text := 'Europe/Rome';
  v_bucket timestamptz := pg_catalog.date_trunc('minute', p_requested_at);
  v_cycle_key text := 'workbench-oct:' || pg_catalog.to_char(v_bucket at time zone 'UTC', 'YYYYMMDDHH24MI');
  v_schedule public.mexal_sync_schedules%rowtype;
  v_cycle public.mexal_sync_cycles%rowtype;
  v_job public.mexal_sync_jobs%rowtype;
  v_created boolean := false;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workbench-oct-refresh', 0)
  );

  select * into v_schedule
  from public.mexal_sync_schedules
  where sync_type = 'oct_orders'
    and enabled = true
    and schedule_mode = 'daily_vercel_hobby'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'OCT_SYNC_NOT_ENABLED';
  end if;

  select * into v_job
  from public.mexal_sync_jobs
  where schedule_id = v_schedule.id
    and status in ('queued', 'leased', 'running', 'retry')
  order by created_at desc
  limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'queued', false,
      'duplicate', true,
      'cycleId', v_job.cycle_id,
      'jobId', v_job.id,
      'status', v_job.status
    );
  end if;

  insert into public.mexal_sync_cycles (
    cycle_key, scheduled_date, scheduled_for, timezone, source, status,
    total_jobs, metadata
  )
  values (
    v_cycle_key,
    (p_requested_at at time zone v_timezone)::date,
    p_requested_at,
    v_timezone,
    'worker_api',
    'queued',
    1,
    pg_catalog.jsonb_build_object(
      'producer', 'workbench_open',
      'requestedBy', p_requested_by,
      'requestedAt', p_requested_at,
      'syncType', 'oct_orders'
    )
  )
  on conflict (cycle_key) do nothing
  returning * into v_cycle;

  if found then
    v_created := true;
  else
    select * into strict v_cycle
    from public.mexal_sync_cycles
    where cycle_key = v_cycle_key
    for update;
  end if;

  insert into public.mexal_sync_jobs (
    cycle_id, schedule_id, sync_type, execution_order, batch_size,
    status, "offset", attempts, max_attempts, available_at, payload
  )
  values (
    v_cycle.id,
    v_schedule.id,
    'oct_orders',
    v_schedule.execution_order,
    v_schedule.batch_size,
    'queued',
    0,
    0,
    5,
    p_requested_at,
    pg_catalog.jsonb_build_object(
      'origin', 'worker',
      'schedule_mode', v_schedule.schedule_mode,
      'trigger', 'workbench_open',
      'requested_by', p_requested_by
    )
  )
  on conflict (cycle_id, schedule_id) do nothing
  returning * into v_job;

  if not found then
    select * into strict v_job
    from public.mexal_sync_jobs
    where cycle_id = v_cycle.id
      and schedule_id = v_schedule.id;
  end if;

  update public.mexal_sync_schedules
  set last_status = 'queued',
      last_error = null,
      updated_at = p_requested_at
  where id = v_schedule.id;

  return pg_catalog.jsonb_build_object(
    'queued', true,
    'duplicate', not v_created,
    'cycleId', v_cycle.id,
    'jobId', v_job.id,
    'status', v_job.status
  );
end;
$$;

revoke all on function public.enqueue_workbench_oct_refresh(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.enqueue_workbench_oct_refresh(uuid, timestamptz)
  to service_role;

comment on function public.enqueue_workbench_oct_refresh(uuid, timestamptz) is
  'Accoda idempotentemente oct_orders dal Workbench; il normale queue worker esegue il job.';

commit;
