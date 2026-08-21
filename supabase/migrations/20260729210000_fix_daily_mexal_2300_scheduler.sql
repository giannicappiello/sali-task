begin;

create table if not exists public.mexal_worker_heartbeat (
  id smallint primary key default 1 check (id = 1),
  last_called_at timestamptz,
  last_completed_at timestamptz,
  last_status text,
  last_error text,
  last_duration_ms integer,
  last_jobs_processed integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.mexal_worker_heartbeat(id, last_status)
values (1, 'never')
on conflict (id) do nothing;

alter table public.mexal_worker_heartbeat enable row level security;

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
  -- Prima delle 23:00 italiane il cron registra il passaggio, ma non crea
  -- alcun ciclo. In questo modo una chiamata mattutina non può bloccare la sera.
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
    'aruba_cron', 'queued', '{"producer":"daily_2300_scheduler"}'::jsonb
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
  where enabled = true and schedule_mode = 'daily_vercel_hobby';

  with inserted as (
    insert into public.mexal_sync_jobs (
      cycle_id, schedule_id, sync_type, execution_order, batch_size,
      status, "offset", attempts, max_attempts, available_at, payload
    )
    select
      v_cycle.id, s.id, s.sync_type, s.execution_order, s.batch_size,
      'queued', 0, 0, 5, p_scheduled_for,
      pg_catalog.jsonb_build_object(
        'origin', 'worker',
        'schedule_mode', 'daily_2300',
        'configuration',
          case when s.sync_type = 'commercial_conditions'
            then '{"mode":"incremental","syncPayments":true}'::jsonb
            else '{}'::jsonb end
      )
    from public.mexal_sync_schedules s
    where s.enabled = true
      and s.schedule_mode = 'daily_vercel_hobby'
      and not exists (
        select 1 from public.mexal_sync_jobs active_job
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
        'lastProducerCall', p_scheduled_for
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

create or replace function public.complete_mexal_sync_job(
  p_job_id bigint,
  p_worker_id text,
  p_lock_token uuid,
  p_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.mexal_sync_jobs%rowtype;
  v_tomorrow date := ((now() at time zone 'Europe/Rome')::date + 1);
begin
  update public.mexal_sync_jobs
  set status = 'completed', completed_at = now(), heartbeat_at = now(),
      last_progress_at = now(), last_result = coalesce(p_result, '{}'::jsonb),
      last_error = null, leased_at = null, lease_expires_at = null,
      worker_id = null, lock_token = null, updated_at = now()
  where id = p_job_id
    and worker_id = p_worker_id
    and lock_token = p_lock_token
    and status in ('leased','running')
    and lease_expires_at > now()
  returning * into v_job;

  if not found then
    raise exception using errcode = 'P0001', message = 'Mexal job lease non valida o scaduta';
  end if;

  update public.mexal_sync_schedules
  set last_run_at = now(), last_status = 'completed', last_error = null,
      next_run_at = (v_tomorrow::timestamp + time '23:00') at time zone 'Europe/Rome',
      hour = 23, minute = 0, frequency_minutes = null, updated_at = now()
  where id = v_job.schedule_id;

  perform public.refresh_mexal_sync_cycle_state(v_job.cycle_id);
  return pg_catalog.to_jsonb(v_job);
end;
$$;

update public.mexal_sync_schedules
set hour = 23,
    minute = 0,
    frequency_minutes = null,
    next_run_at = case
      when enabled then
        (((now() at time zone 'Europe/Rome')::date +
          case when (now() at time zone 'Europe/Rome')::time < time '23:00' then 0 else 1 end
        )::timestamp + time '23:00') at time zone 'Europe/Rome'
      else next_run_at
    end,
    updated_at = now();

revoke all on function public.create_daily_mexal_sync_cycle(timestamptz) from public, anon, authenticated;
grant execute on function public.create_daily_mexal_sync_cycle(timestamptz) to service_role;
revoke all on function public.complete_mexal_sync_job(bigint, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_mexal_sync_job(bigint, text, uuid, jsonb) to service_role;

commit;
