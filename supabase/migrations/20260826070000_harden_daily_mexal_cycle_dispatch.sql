begin;

alter table public.mexal_worker_heartbeat
  add column if not exists last_source text,
  add column if not exists last_business_date date,
  add column if not exists last_cycle_id bigint,
  add column if not exists last_jobs_created integer not null default 0;

create or replace function public.create_daily_mexal_sync_cycle(
  p_scheduled_for timestamptz,
  p_trigger_source text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_timezone constant text := 'Europe/Rome';
  v_local_timestamp timestamp := p_scheduled_for at time zone v_timezone;
  -- Il giorno diventa eleggibile alle 23:00 italiane. Dopo mezzanotte e
  -- durante il giorno si continua quindi a recuperare il giorno precedente.
  v_business_date date := v_local_timestamp::date
    - case when v_local_timestamp::time < time '23:00' then 1 else 0 end;
  v_cycle_key text := 'daily-2300:' || v_business_date::text || ':Europe/Rome';
  v_source text := case pg_catalog.lower(pg_catalog.btrim(coalesce(p_trigger_source, '')))
    when 'aruba' then 'aruba_cron'
    when 'aruba_cron' then 'aruba_cron'
    when 'vercel-cron' then 'vercel_cron'
    when 'vercel_cron' then 'vercel_cron'
    when 'supabase-cron' then 'supabase_cron'
    when 'supabase_cron' then 'supabase_cron'
    else 'worker_api'
  end;
  v_cycle public.mexal_sync_cycles%rowtype;
  v_created boolean := false;
  v_jobs_created integer := 0;
  v_total_jobs integer := 0;
  v_active_jobs integer := 0;
  v_enabled integer := 0;
  v_next_run timestamptz :=
    ((v_business_date + 1)::timestamp + time '23:00') at time zone v_timezone;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_cycle_key, 0));

  insert into public.mexal_sync_cycles (
    cycle_key, scheduled_date, scheduled_for, timezone, source, status, metadata
  )
  values (
    v_cycle_key, v_business_date, p_scheduled_for, v_timezone,
    v_source, 'queued', pg_catalog.jsonb_build_object(
      'producer', 'daily_2300_scheduler',
      'firstTriggerSource', v_source,
      'lastTriggerSource', v_source,
      'businessDate', v_business_date,
      'scheduleSource', 'mexal_sync_schedules'
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
        when v_active_jobs > 0 then case when status = 'running' then 'running' else 'queued' end
        when v_total_jobs = 0 then 'completed'
        else status
      end,
      completed_at = case when v_active_jobs > 0 then null else completed_at end,
      updated_at = p_scheduled_for,
      metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'enabledSchedules', v_enabled,
        'lastProducerCall', p_scheduled_for,
        'lastTriggerSource', v_source,
        'businessDate', v_business_date,
        'scheduleSource', 'mexal_sync_schedules'
      )
  where id = v_cycle.id
  returning * into v_cycle;

  return pg_catalog.jsonb_build_object(
    'cycleId', v_cycle.id,
    'cycleKey', v_cycle_key,
    'businessDate', v_business_date,
    'triggerSource', v_source,
    'created', v_created,
    'jobsCreated', v_jobs_created,
    'existingJobs', v_total_jobs - v_jobs_created,
    'enabledSchedules', v_enabled,
    'status', v_cycle.status,
    'nextRunAt', v_next_run
  );
end;
$$;

-- Compatibilità per eventuali caller storici. I dispatcher correnti usano
-- esplicitamente la variante a due argomenti e registrano l'origine reale.
create or replace function public.create_daily_mexal_sync_cycle(
  p_scheduled_for timestamptz default now()
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select public.create_daily_mexal_sync_cycle(p_scheduled_for, 'worker_api');
$$;

revoke all on function public.create_daily_mexal_sync_cycle(timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.create_daily_mexal_sync_cycle(timestamptz, text)
  to service_role;

revoke all on function public.create_daily_mexal_sync_cycle(timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_daily_mexal_sync_cycle(timestamptz)
  to service_role;

commit;
