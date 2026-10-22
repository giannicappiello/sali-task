begin;
set local lock_timeout='5s';
create or replace function public.resume_blocked_mexal_sync_cycles()
returns integer language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare cid bigint; repaired integer:=0;
begin
  -- Preserve failed statuses/errors. Reopen only cycles with actual pending
  -- work; explicitly cancelled cycles and standalone manual stock runs stay put.
  for cid in select c.id from public.mexal_sync_cycles c
    where c.status in ('failed','completed','completed_with_errors')
      and coalesce(c.metadata->>'producer','')<>'workspace_manual_stocks'
      and exists(select 1 from public.mexal_sync_jobs j where j.cycle_id=c.id and j.status in ('queued','retry','leased','running'))
    order by c.id for update of c skip locked
  loop
    perform public.refresh_mexal_sync_cycle_state(cid);
    repaired:=repaired+1;
  end loop;
  return repaired;
end;$$;
revoke all on function public.resume_blocked_mexal_sync_cycles() from public,anon,authenticated;
grant execute on function public.resume_blocked_mexal_sync_cycles() to service_role;

CREATE OR REPLACE FUNCTION public.claim_scheduled_mexal_sync_job_v1(p_worker_id text, p_lease_seconds integer DEFAULT 300)
 RETURNS SETOF mexal_sync_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_job_id bigint;
  v_job public.mexal_sync_jobs%rowtype;
  v_worker_id text;
begin
  v_worker_id := btrim(coalesce(p_worker_id, ''));

  if v_worker_id = '' then
    raise exception 'worker_id obbligatorio'
      using errcode = '22023';
  end if;

  if p_lease_seconds is null
     or p_lease_seconds < 30
     or p_lease_seconds > 3600 then
    raise exception 'lease_seconds deve essere compreso tra 30 e 3600'
      using errcode = '22023';
  end if;

  update public.mexal_sync_jobs
  set
    status = case
      when attempts >= max_attempts and sync_type<>'sales_invoices' then 'failed'
      else 'retry'
    end,
    available_at = case
      when attempts >= max_attempts and sync_type='sales_invoices' then now()+interval '15 minutes'
      when attempts >= max_attempts then available_at
      else now() + make_interval(
        secs => least(3600, greatest(60, attempts * attempts * 60))
      )
    end,
    attempts=case when sync_type='sales_invoices' and attempts>=max_attempts then 0 else attempts end,
    leased_at = null,
    lease_expires_at = null,
    heartbeat_at = null,
    worker_id = null,
    lock_token = null,
    completed_at = case
      when attempts >= max_attempts and sync_type<>'sales_invoices' then now()
      else null
    end,
    last_error = case
      when attempts >= max_attempts
        then coalesce(
          last_error,
          'Lease scaduto e numero massimo di tentativi raggiunto.'
        )
      else coalesce(
        last_error,
        'Lease scaduto; job reso nuovamente disponibile.'
      )
    end,
    updated_at = now()
  where status in ('leased', 'running')
    and lease_expires_at < now();

  -- Failed jobs are terminal for ordering, not a reason to abort siblings.
  perform public.resume_blocked_mexal_sync_cycles();

  select j.id
  into v_job_id
  from public.mexal_sync_jobs j
  join public.mexal_sync_cycles c
    on c.id = j.cycle_id
  where c.status in ('queued', 'running')
    and j.status in ('queued', 'retry')
    and j.available_at <= now() and (j.sync_type <> 'stocks' or public.mexal_stock_night_window(now())) and coalesce(j.payload->>'lane','') <> 'manual_priority'
    and j.attempts < j.max_attempts
    and not exists (
      select 1
      from public.mexal_sync_jobs previous_job
      where previous_job.cycle_id = j.cycle_id
        and (
          previous_job.execution_order < j.execution_order
          or (
            previous_job.execution_order = j.execution_order
            and previous_job.id < j.id
          )
        )
        and previous_job.status not in ('completed', 'skipped', 'failed', 'cancelled')
        and previous_job.sync_type <> 'stocks'
        and not (previous_job.status='retry' and previous_job.last_error is not null and previous_job.available_at>now())
    )
  order by
    c.scheduled_for asc,
    c.id asc,
    j.execution_order asc,
    j.available_at asc,
    j.id asc
  limit 1
  for update of j skip locked;

  if v_job_id is null then
    return;
  end if;

  update public.mexal_sync_jobs
  set
    status = 'leased',
    attempts = attempts + 1,
    leased_at = now(),
    lease_expires_at =
      now() + make_interval(secs => p_lease_seconds),
    heartbeat_at = now(),
    worker_id = v_worker_id,
    lock_token = gen_random_uuid(),
    started_at = coalesce(started_at, now()),
    completed_at = null,
    last_error = null,
    updated_at = now()
  where id = v_job_id
    and status in ('queued', 'retry')
  returning *
  into v_job;

  if not found then
    return;
  end if;

  update public.mexal_sync_cycles
  set
    status = 'running',
    current_execution_order = v_job.execution_order,
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = v_job.cycle_id
    and status in ('queued', 'running');

  return next v_job;
  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.retry_mexal_sync_job(p_job_id bigint, p_worker_id text, p_lock_token uuid, p_error text DEFAULT NULL::text, p_offset integer DEFAULT NULL::integer, p_sync_run_id bigint DEFAULT NULL::bigint, p_result jsonb DEFAULT '{}'::jsonb, p_is_failure boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_job public.mexal_sync_jobs%rowtype;
begin
  update public.mexal_sync_jobs
     set status = case when p_is_failure and attempts >= max_attempts and sync_type<>'sales_invoices' then 'failed' else 'retry' end,
         available_at = case
           when p_is_failure and attempts>=max_attempts and sync_type='sales_invoices' then now()+interval '15 minutes'
           when p_is_failure and attempts >= max_attempts then available_at
           when p_is_failure then now() + pg_catalog.make_interval(secs => least(3600, 60 * greatest(1, attempts)))
           else now()
         end,
         completed_at = case when p_is_failure and attempts >= max_attempts and sync_type<>'sales_invoices' then now() else null end,
         "offset" = coalesce(p_offset, "offset"),
         sync_run_id = coalesce(p_sync_run_id, sync_run_id),
         attempts = case when p_is_failure and sync_type='sales_invoices' and attempts>=max_attempts then 0 when p_is_failure then attempts else 0 end,
         payload=case when p_is_failure and sync_type='sales_invoices' and attempts>=max_attempts
           then coalesce(payload,'{}'::jsonb)||jsonb_build_object('invoice_retry_rounds',coalesce((payload->>'invoice_retry_rounds')::integer,0)+1)
           else payload end,
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
$function$;

CREATE OR REPLACE FUNCTION public.recover_expired_mexal_sync_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare recovered integer; cid bigint;
begin
  update public.mexal_sync_jobs set
    status=case when attempts>=max_attempts and sync_type<>'sales_invoices' then 'failed' else 'retry' end,
    completed_at=case when attempts>=max_attempts and sync_type<>'sales_invoices' then now() else null end,
    last_error=case when attempts>=max_attempts then 'Tentativi di recupero esauriti dopo interruzioni del worker.' else last_error end,
    available_at=case when sync_type='sales_invoices' and attempts>=max_attempts then now()+interval '15 minutes' else now() end,
    attempts=case when sync_type='sales_invoices' and attempts>=max_attempts then 0 else attempts end,leased_at=null,lease_expires_at=null,heartbeat_at=null,worker_id=null,lock_token=null,updated_at=now()
  where status in ('leased','running') and lease_expires_at<=now() and (attempts<max_attempts or sync_type in ('stocks','sales_invoices'));
  get diagnostics recovered=row_count;
  for cid in select distinct cycle_id from public.mexal_sync_jobs where sync_type='stocks' and status='failed' loop
    perform public.refresh_mexal_sync_cycle_state(cid);
  end loop;
  return recovered;
end $function$;

CREATE OR REPLACE FUNCTION public.create_daily_mexal_sync_cycle(p_scheduled_for timestamp with time zone, p_trigger_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_timezone constant text := 'Europe/Rome';
  v_local_timestamp timestamp := p_scheduled_for at time zone v_timezone;
  -- Il giorno diventa eleggibile alle 23:00 italiane. Dopo mezzanotte e
  -- durante il giorno si continua quindi a recuperare il giorno precedente.
  v_business_date date := v_local_timestamp::date
    - case when v_local_timestamp::time < time '21:30' then 1 else 0 end;
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
    ((v_business_date + 1)::timestamp + time '21:30') at time zone v_timezone;
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
        'optimization_version', 2, 'origin', 'worker',
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
      join public.mexal_sync_cycles active_cycle on active_cycle.id=active_job.cycle_id and active_cycle.status in ('queued','running')
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
        hour = 21,
        minute = 30,
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
$function$;

-- Recover already stranded invoice work without discarding its failed page.
update public.mexal_sync_jobs j set status='retry',attempts=0,available_at=now(),completed_at=null,
  worker_id=null,lock_token=null,leased_at=null,lease_expires_at=null,heartbeat_at=null,updated_at=now()
from public.mexal_sync_cycles c where c.id=j.cycle_id and c.status<>'cancelled'
  and j.sync_type='sales_invoices' and j.status='failed';
select public.resume_blocked_mexal_sync_cycles();
notify pgrst,'reload schema';
commit;
