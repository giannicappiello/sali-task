-- Include ogni schedule giornaliero attivo nel ciclo Mexal e consente un backfill mirato.
-- Non modifica claim/retry e non crea alcun job finché la migration non viene applicata
-- e una delle funzioni viene invocata esplicitamente.

create or replace function public.create_daily_mexal_sync_cycle(
  p_scheduled_for timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_timezone constant text := 'Europe/Rome';
  v_local_timestamp timestamp := p_scheduled_for at time zone 'Europe/Rome';
  v_scheduled_date date := v_local_timestamp::date;
  v_cycle_key text := 'daily-2300:' || v_scheduled_date::text || ':Europe/Rome';
  v_cycle public.mexal_sync_cycles%rowtype;
  v_created boolean := false;
  v_jobs_created integer := 0;
  v_total_jobs integer := 0;
  v_active_jobs integer := 0;
  v_enabled integer := 0;
  v_next_run timestamptz :=
    ((v_scheduled_date + 1)::timestamp + time '23:00') at time zone 'Europe/Rome';
begin
  if v_local_timestamp::time < time '23:00' then
    return pg_catalog.jsonb_build_object(
      'status', 'waiting',
      'reason', 'before_2300',
      'nextRunAt', (v_scheduled_date::timestamp + time '23:00') at time zone 'Europe/Rome',
      'jobsCreated', 0
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_cycle_key, 0));

  insert into public.mexal_sync_cycles (
    cycle_key, scheduled_date, scheduled_for, timezone, source, status, metadata
  )
  values (
    v_cycle_key, v_scheduled_date, p_scheduled_for, v_timezone,
    'aruba_cron', 'queued', '{"producer":"daily_2300_scheduler","scheduleSource":"mexal_sync_schedules"}'::jsonb
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

  select count(*)::integer into v_enabled
  from public.mexal_sync_schedules
  where enabled = true
    and schedule_mode = 'daily_vercel_hobby';

  with eligible_schedules as (
    select s.id, s.sync_type, s.execution_order, s.batch_size, s.schedule_mode
    from public.mexal_sync_schedules s
    where s.enabled = true
      and s.schedule_mode = 'daily_vercel_hobby'
    order by s.execution_order, s.sync_type, s.id
    for update
  ),
  inserted as (
    insert into public.mexal_sync_jobs (
      cycle_id, schedule_id, sync_type, execution_order, batch_size,
      status, "offset", attempts, max_attempts, available_at, payload
    )
    select
      v_cycle.id, s.id, s.sync_type, s.execution_order, s.batch_size,
      'queued', 0, 0, 5, p_scheduled_for,
      pg_catalog.jsonb_build_object(
        'origin', 'worker',
        'schedule_mode', s.schedule_mode,
        'configuration',
          case when s.sync_type = 'commercial_conditions'
            then '{"mode":"incremental","syncPayments":true}'::jsonb
            else '{}'::jsonb end
      )
    from eligible_schedules s
    where not exists (
      select 1
      from public.mexal_sync_jobs active_job
      where active_job.schedule_id = s.id
        and active_job.status in ('queued','leased','running','retry')
        and active_job.cycle_id <> v_cycle.id
    )
    on conflict (cycle_id, schedule_id) do nothing
    returning schedule_id
  ),
  schedules_updated as (
    update public.mexal_sync_schedules s
    set last_status = 'queued',
        last_error = null,
        next_run_at = v_next_run,
        hour = 23,
        minute = 0,
        frequency_minutes = null,
        updated_at = p_scheduled_for
    from inserted
    where s.id = inserted.schedule_id
    returning s.id
  )
  select count(*)::integer into v_jobs_created from inserted;

  select
    count(*)::integer,
    count(*) filter (where status in ('queued','leased','running','retry'))::integer
  into v_total_jobs, v_active_jobs
  from public.mexal_sync_jobs
  where cycle_id = v_cycle.id;

  update public.mexal_sync_cycles
  set total_jobs = v_total_jobs,
      status = case
        when v_active_jobs > 0 then 'queued'
        when v_total_jobs = 0 then 'completed'
        else status
      end,
      completed_at = case when v_active_jobs > 0 then null else completed_at end,
      updated_at = p_scheduled_for,
      metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'enabledSchedules', v_enabled,
        'lastProducerCall', p_scheduled_for,
        'scheduleSource', 'mexal_sync_schedules'
      )
  where id = v_cycle.id
  returning * into v_cycle;

  return pg_catalog.jsonb_build_object(
    'cycleId', v_cycle.id,
    'cycleKey', v_cycle_key,
    'created', v_created,
    'jobsCreated', v_jobs_created,
    'existingJobs', v_total_jobs - v_jobs_created,
    'enabledSchedules', v_enabled,
    'status', v_cycle.status,
    'nextRunAt', v_next_run
  );
end;
$$;

create or replace function public.backfill_mexal_sync_cycle_job(
  p_cycle_id bigint,
  p_sync_type text,
  p_available_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cycle public.mexal_sync_cycles%rowtype;
  v_schedule public.mexal_sync_schedules%rowtype;
  v_job public.mexal_sync_jobs%rowtype;
  v_inserted boolean := false;
begin
  if p_cycle_id is null or nullif(pg_catalog.btrim(p_sync_type), '') is null then
    raise exception using errcode = '22023', message = 'CYCLE_AND_SYNC_TYPE_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mexal-cycle:' || p_cycle_id::text, 0)
  );

  select * into strict v_cycle
  from public.mexal_sync_cycles
  where id = p_cycle_id
  for update;

  if v_cycle.status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'CYCLE_CANCELLED';
  end if;

  select * into v_schedule
  from public.mexal_sync_schedules
  where sync_type = pg_catalog.btrim(p_sync_type)
    and enabled = true
    and schedule_mode = 'daily_vercel_hobby'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'SCHEDULE_NOT_ENABLED_FOR_DAILY_CYCLE';
  end if;

  if exists (
    select 1
    from public.mexal_sync_jobs active_job
    where active_job.schedule_id = v_schedule.id
      and active_job.cycle_id <> v_cycle.id
      and active_job.status in ('queued','leased','running','retry')
  ) then
    return pg_catalog.jsonb_build_object(
      'cycleId', v_cycle.id,
      'syncType', v_schedule.sync_type,
      'inserted', false,
      'status', 'blocked_by_active_job'
    );
  end if;

  insert into public.mexal_sync_jobs (
    cycle_id, schedule_id, sync_type, execution_order, batch_size,
    status, "offset", attempts, max_attempts, available_at, payload
  )
  values (
    v_cycle.id, v_schedule.id, v_schedule.sync_type,
    v_schedule.execution_order, v_schedule.batch_size,
    'queued', 0, 0, 5, p_available_at,
    pg_catalog.jsonb_build_object(
      'origin', 'worker',
      'schedule_mode', v_schedule.schedule_mode,
      'configuration',
        case when v_schedule.sync_type = 'commercial_conditions'
          then '{"mode":"incremental","syncPayments":true}'::jsonb
          else '{}'::jsonb end,
      'backfill', true
    )
  )
  on conflict (cycle_id, schedule_id) do nothing
  returning * into v_job;

  if found then
    v_inserted := true;
    update public.mexal_sync_schedules
    set last_status = 'queued',
        last_error = null,
        updated_at = p_available_at
    where id = v_schedule.id;

    perform public.refresh_mexal_sync_cycle_state(v_cycle.id);
  else
    select * into strict v_job
    from public.mexal_sync_jobs
    where cycle_id = v_cycle.id
      and schedule_id = v_schedule.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'cycleId', v_cycle.id,
    'jobId', v_job.id,
    'syncType', v_job.sync_type,
    'executionOrder', v_job.execution_order,
    'inserted', v_inserted,
    'status', v_job.status
  );
end;
$$;

revoke all on function public.create_daily_mexal_sync_cycle(timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_daily_mexal_sync_cycle(timestamptz)
  to service_role;

revoke all on function public.backfill_mexal_sync_cycle_job(bigint, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.backfill_mexal_sync_cycle_job(bigint, text, timestamptz)
  to service_role;

comment on function public.backfill_mexal_sync_cycle_job(bigint, text, timestamptz) is
  'Inserisce idempotentemente un solo job mancante in un ciclo esistente; non modifica claim o retry.';
