-- Fase 1C-A: produttore transazionale e lifecycle della coda Mexal.
-- Presuppone le tabelle e claim_next_mexal_sync_job() introdotte dalla Fase 1A.

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
  v_scheduled_date date := (p_scheduled_for at time zone 'Europe/Rome')::date;
  v_cycle_key text := 'daily:' || v_scheduled_date::text || ':Europe/Rome';
  v_cycle public.mexal_sync_cycles%rowtype;
  v_created boolean := false;
  v_due_count integer := 0;
  v_skipped_active integer := 0;
  v_jobs_created integer := 0;
  v_total_jobs integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_cycle_key, 0));

  insert into public.mexal_sync_cycles (
    cycle_key, scheduled_date, scheduled_for, timezone, source, status, metadata
  )
  values (
    v_cycle_key, v_scheduled_date, p_scheduled_for, v_timezone,
    'vercel_cron', 'queued', '{"producer":"create_daily_mexal_sync_cycle"}'::jsonb
  )
  on conflict (cycle_key) do nothing
  returning * into v_cycle;

  if found then
    v_created := true;
  else
    select *
      into strict v_cycle
      from public.mexal_sync_cycles
     where cycle_key = v_cycle_key
     for update;
  end if;

  if v_cycle.status in ('completed', 'completed_with_errors', 'failed', 'cancelled') then
    select count(*)::integer
      into v_total_jobs
      from public.mexal_sync_jobs
     where cycle_id = v_cycle.id;

    return pg_catalog.jsonb_build_object(
      'cycleId', v_cycle.id,
      'cycleKey', v_cycle_key,
      'created', v_created,
      'jobsCreated', 0,
      'existingJobs', v_total_jobs,
      'skippedActive', 0,
      'waiting', false,
      'status', v_cycle.status
    );
  end if;

  perform s.id
    from public.mexal_sync_schedules s
   where s.enabled = true
     and s.schedule_mode = 'daily_vercel_hobby'
     and (s.next_run_at is null or s.next_run_at <= p_scheduled_for)
   order by s.execution_order, s.sync_type, s.id
   for update;

  create temporary table pg_temp.mexal_due_schedules
  on commit drop
  as
  select s.id, s.sync_type, s.execution_order, s.batch_size, s.schedule_mode
    from public.mexal_sync_schedules s
   where s.enabled = true
     and s.schedule_mode = 'daily_vercel_hobby'
     and (s.next_run_at is null or s.next_run_at <= p_scheduled_for)
   order by s.execution_order, s.sync_type, s.id;

  select count(*)::integer into v_due_count from pg_temp.mexal_due_schedules;

  select count(*)::integer
    into v_skipped_active
    from pg_temp.mexal_due_schedules s
   where not exists (
           select 1
             from public.mexal_sync_jobs current_cycle_job
            where current_cycle_job.cycle_id = v_cycle.id
              and current_cycle_job.schedule_id = s.id
         )
     and exists (
           select 1
             from public.mexal_sync_jobs active_job
            where active_job.schedule_id = s.id
              and active_job.status in ('queued', 'leased', 'running', 'retry')
         );

  with inserted as (
    insert into public.mexal_sync_jobs (
      cycle_id, schedule_id, sync_type, execution_order, batch_size,
      status, "offset", attempts, max_attempts, available_at, payload
    )
    select
      v_cycle.id,
      s.id,
      s.sync_type,
      s.execution_order,
      s.batch_size,
      'queued',
      0,
      0,
      5,
      p_scheduled_for,
      pg_catalog.jsonb_build_object(
        'origin', 'worker',
        'schedule_mode', s.schedule_mode,
        'configuration',
          case
            when s.sync_type = 'commercial_conditions'
              then '{"mode":"incremental","syncPayments":true}'::jsonb
            else '{}'::jsonb
          end
      )
      from pg_temp.mexal_due_schedules s
     where not exists (
             select 1
               from public.mexal_sync_jobs active_job
              where active_job.schedule_id = s.id
                and active_job.status in ('queued', 'leased', 'running', 'retry')
                and active_job.cycle_id <> v_cycle.id
           )
    on conflict (cycle_id, schedule_id) do nothing
    returning schedule_id
  ),
  schedules_updated as (
    update public.mexal_sync_schedules schedule
       set last_status = 'queued',
           last_error = null,
           updated_at = p_scheduled_for
      from inserted
     where schedule.id = inserted.schedule_id
    returning schedule.id
  )
  select count(*)::integer into v_jobs_created from inserted;

  select count(*)::integer
    into v_total_jobs
    from public.mexal_sync_jobs
   where cycle_id = v_cycle.id;

  if v_created then
    update public.mexal_sync_cycles
       set total_jobs = v_total_jobs,
           status = case
             when v_total_jobs = 0 and v_skipped_active = 0 then 'completed'
             else 'queued'
           end,
           completed_at = case
             when v_total_jobs = 0 and v_skipped_active = 0 then p_scheduled_for
             else null
           end,
           updated_at = p_scheduled_for
     where id = v_cycle.id
     returning * into v_cycle;
  else
    update public.mexal_sync_cycles
       set total_jobs = v_total_jobs,
           updated_at = p_scheduled_for
     where id = v_cycle.id
     returning * into v_cycle;
  end if;

  return pg_catalog.jsonb_build_object(
    'cycleId', v_cycle.id,
    'cycleKey', v_cycle_key,
    'created', v_created,
    'jobsCreated', v_jobs_created,
    'existingJobs', v_total_jobs - v_jobs_created,
    'skippedActive', v_skipped_active,
    'dueSchedules', v_due_count,
    'waiting', v_total_jobs = 0 and v_skipped_active > 0,
    'status', v_cycle.status
  );
end;
$$;

create or replace function public.refresh_mexal_sync_cycle_state(p_cycle_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_total integer;
  v_completed integer;
  v_failed integer;
  v_active integer;
begin
  select
    count(*)::integer,
    count(*) filter (where status = 'completed')::integer,
    count(*) filter (where status = 'failed')::integer,
    count(*) filter (where status in ('queued', 'leased', 'running', 'retry'))::integer
  into v_total, v_completed, v_failed, v_active
  from public.mexal_sync_jobs
  where cycle_id = p_cycle_id;

  update public.mexal_sync_cycles
     set total_jobs = v_total,
         completed_jobs = v_completed,
         failed_jobs = v_failed,
         status = case
           when v_active > 0 then
             case when status = 'running' then 'running' else 'queued' end
           when v_failed > 0 and v_completed > 0 then 'completed_with_errors'
           when v_failed > 0 then 'failed'
           else 'completed'
         end,
         started_at = case
           when v_total > 0 then coalesce(started_at, now())
           else started_at
         end,
         completed_at = case when v_active = 0 then now() else null end,
         updated_at = now()
   where id = p_cycle_id;
end;
$$;

create or replace function public.heartbeat_mexal_sync_job(
  p_job_id bigint,
  p_worker_id text,
  p_lock_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.mexal_sync_jobs%rowtype;
begin
  update public.mexal_sync_jobs
     set status = 'running',
         started_at = coalesce(started_at, now()),
         heartbeat_at = now(),
         last_progress_at = now(),
         lease_expires_at = now() + interval '10 minutes',
         updated_at = now()
   where id = p_job_id
     and worker_id = p_worker_id
     and lock_token = p_lock_token
     and status in ('leased', 'running')
     and lease_expires_at > now()
  returning * into v_job;

  if not found then
    raise exception using errcode = 'P0001', message = 'Mexal job lease non valida o scaduta';
  end if;

  update public.mexal_sync_cycles
     set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
   where id = v_job.cycle_id
     and status in ('queued', 'running');

  return pg_catalog.to_jsonb(v_job);
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
begin
  update public.mexal_sync_jobs
     set status = 'completed',
         completed_at = now(),
         heartbeat_at = now(),
         last_progress_at = now(),
         last_result = coalesce(p_result, '{}'::jsonb),
         last_error = null,
         leased_at = null,
         lease_expires_at = null,
         worker_id = null,
         lock_token = null,
         updated_at = now()
   where id = p_job_id
     and worker_id = p_worker_id
     and lock_token = p_lock_token
     and status in ('leased', 'running')
     and lease_expires_at > now()
  returning * into v_job;

  if not found then
    raise exception using errcode = 'P0001', message = 'Mexal job lease non valida o scaduta';
  end if;

  update public.mexal_sync_schedules
     set last_run_at = now(), last_status = 'completed', last_error = null, updated_at = now()
   where id = v_job.schedule_id;

  perform public.refresh_mexal_sync_cycle_state(v_job.cycle_id);
  return pg_catalog.to_jsonb(v_job);
end;
$$;

create or replace function public.retry_mexal_sync_job(
  p_job_id bigint,
  p_worker_id text,
  p_lock_token uuid,
  p_error text default null,
  p_offset integer default null,
  p_sync_run_id bigint default null,
  p_result jsonb default '{}'::jsonb,
  p_is_failure boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.mexal_sync_jobs%rowtype;
begin
  update public.mexal_sync_jobs
     set status = case when p_is_failure and attempts >= max_attempts then 'failed' else 'retry' end,
         available_at = case
           when p_is_failure and attempts >= max_attempts then available_at
           when p_is_failure then now() + pg_catalog.make_interval(secs => least(3600, 60 * greatest(1, attempts)))
           else now()
         end,
         completed_at = case when p_is_failure and attempts >= max_attempts then now() else null end,
         "offset" = coalesce(p_offset, "offset"),
         sync_run_id = coalesce(p_sync_run_id, sync_run_id),
         attempts = case when p_is_failure then attempts else 0 end,
         last_result = coalesce(p_result, '{}'::jsonb),
         last_progress_at = case when p_is_failure then last_progress_at else now() end,
         last_error = case
           when p_is_failure then left(coalesce(p_error, 'Retry richiesto dal worker'), 4000)
           else null
         end,
         leased_at = null,
         lease_expires_at = null,
         heartbeat_at = null,
         worker_id = null,
         lock_token = null,
         updated_at = now()
   where id = p_job_id
     and worker_id = p_worker_id
     and lock_token = p_lock_token
     and status in ('leased', 'running')
  returning * into v_job;

  if not found then
    raise exception using errcode = 'P0001', message = 'Mexal job lease non valida';
  end if;

  update public.mexal_sync_schedules
     set last_status = v_job.status, last_error = v_job.last_error, updated_at = now()
   where id = v_job.schedule_id;

  perform public.refresh_mexal_sync_cycle_state(v_job.cycle_id);
  return pg_catalog.to_jsonb(v_job);
end;
$$;

create or replace function public.fail_mexal_sync_job(
  p_job_id bigint,
  p_worker_id text,
  p_lock_token uuid,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.mexal_sync_jobs%rowtype;
begin
  update public.mexal_sync_jobs
     set status = 'failed',
         completed_at = now(),
         last_error = left(coalesce(p_error, 'Job fallito'), 4000),
         leased_at = null,
         lease_expires_at = null,
         worker_id = null,
         lock_token = null,
         updated_at = now()
   where id = p_job_id
     and worker_id = p_worker_id
     and lock_token = p_lock_token
     and status in ('leased', 'running')
  returning * into v_job;

  if not found then
    raise exception using errcode = 'P0001', message = 'Mexal job lease non valida';
  end if;

  update public.mexal_sync_schedules
     set last_status = 'failed', last_error = v_job.last_error, updated_at = now()
   where id = v_job.schedule_id;

  perform public.refresh_mexal_sync_cycle_state(v_job.cycle_id);
  return pg_catalog.to_jsonb(v_job);
end;
$$;

revoke all on function public.create_daily_mexal_sync_cycle(timestamptz) from public, anon, authenticated;
revoke all on function public.refresh_mexal_sync_cycle_state(bigint) from public, anon, authenticated;
revoke all on function public.heartbeat_mexal_sync_job(bigint, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_mexal_sync_job(bigint, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.retry_mexal_sync_job(bigint, text, uuid, text, integer, bigint, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.fail_mexal_sync_job(bigint, text, uuid, text) from public, anon, authenticated;

grant execute on function public.create_daily_mexal_sync_cycle(timestamptz) to service_role;
grant execute on function public.heartbeat_mexal_sync_job(bigint, text, uuid) to service_role;
grant execute on function public.complete_mexal_sync_job(bigint, text, uuid, jsonb) to service_role;
grant execute on function public.retry_mexal_sync_job(bigint, text, uuid, text, integer, bigint, jsonb, boolean) to service_role;
grant execute on function public.fail_mexal_sync_job(bigint, text, uuid, text) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'mexal-sync-worker-every-minute';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'mexal-sync-worker-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'SUPABASE_URL'
    ) || '/functions/v1/mexal-sync-worker',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'SUPABASE_SERVICE_ROLE_KEY'
      ),
      'x-mexal-worker-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'WORKER_SECRET'
      )
    ),
    body := '{"source":"supabase_cron"}'::jsonb
  );
  $cron$
);
