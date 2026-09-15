begin;
set local lock_timeout = '5s';

-- Immutable input catalog for NEW runs only; no existing progress is rewritten.
create table if not exists public.mexal_sync_run_inputs (
  sync_run_id bigint primary key references public.mexal_sync_runs(id),
  inputs jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.mexal_sync_run_inputs enable row level security;
revoke all on public.mexal_sync_run_inputs from public, anon, authenticated;
grant select, insert on public.mexal_sync_run_inputs to service_role;

-- Keep the historical cycle key: changing it would duplicate today's cycle.
-- Change only the producer for future calls, never existing jobs or runs.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.create_daily_mexal_sync_cycle(timestamptz,text)'::regprocedure) into definition;
  if position('time ''23:00''' in definition) = 0 then raise exception 'Unexpected daily scheduler definition'; end if;
  definition := replace(definition, 'time ''23:00''', 'time ''21:30''');
  definition := replace(definition, 'hour = 23,', 'hour = 21,');
  definition := replace(definition, 'minute = 0,', 'minute = 30,');
  definition := replace(definition, '''origin'', ''worker'',', '''optimization_version'', 2, ''origin'', ''worker'',');
  execute definition;
end $$;

-- Schedule configuration only. Existing jobs keep their payload and checkpoints.
update public.mexal_sync_schedules
set hour = 21, minute = 30,
    next_run_at = (((now() at time zone 'Europe/Rome')::date
      + case when (now() at time zone 'Europe/Rome')::time < time '21:30' then 0 else 1 end)::timestamp
      + time '21:30') at time zone 'Europe/Rome'
where schedule_mode = 'daily_vercel_hobby';

-- Retain the proven scheduled queue implementation (expiry, retries, lineage).
alter function public.claim_next_mexal_sync_job(text,integer) rename to claim_scheduled_mexal_sync_job_v1;
-- The fallback must not bypass the dedicated OCT ownership check.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.claim_scheduled_mexal_sync_job_v1(text,integer)'::regprocedure) into definition;
  if position('and j.available_at <= now()' in definition) = 0 then raise exception 'Unexpected scheduled claim definition'; end if;
  definition := replace(definition, 'and j.available_at <= now()',
    'and j.available_at <= now() and coalesce(j.payload->>''lane'','''') <> ''manual_priority''');
  execute definition;
end $$;

create function public.claim_priority_mexal_sync_job(p_worker_id text, p_lease_seconds integer default 300, p_manual_job_id bigint default null)
returns setof public.mexal_sync_jobs language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_job public.mexal_sync_jobs%rowtype;
begin
  if nullif(btrim(p_worker_id),'') is null or p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'Invalid worker lease';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mexal-worker-dispatch-v2',0));
  -- Never interrupt an active block, including one started by the old worker.
  if exists(select 1 from public.mexal_sync_jobs where status in ('leased','running') and lease_expires_at >= now()) then return; end if;
  select j.* into v_job from public.mexal_sync_jobs j
  join public.mexal_sync_cycles c on c.id = j.cycle_id
  where j.payload->>'lane' = 'manual_priority' and j.sync_type = 'oct_orders'
    and (p_manual_job_id is null or j.id = p_manual_job_id)
    and j.status in ('queued','retry') and j.available_at <= now() and j.attempts < j.max_attempts
    and c.status in ('queued','running')
    and not exists(select 1 from public.mexal_sync_runs r where r.sync_type = 'oct_orders' and r.status = 'running')
  order by j.created_at,j.id limit 1 for update of j skip locked;
  if found then
    update public.mexal_sync_jobs set status='leased', attempts=attempts+1,
      leased_at=now(), lease_expires_at=now()+make_interval(secs=>p_lease_seconds), heartbeat_at=now(),
      worker_id=p_worker_id, lock_token=gen_random_uuid(), started_at=coalesce(started_at,now()),
      completed_at=null,last_error=null,updated_at=now()
    where id=v_job.id returning * into v_job;
    update public.mexal_sync_cycles set status='running',started_at=coalesce(started_at,now()),updated_at=now() where id=v_job.cycle_id;
    return next v_job;
  elsif p_manual_job_id is null then
    return query select * from public.claim_scheduled_mexal_sync_job_v1(p_worker_id,p_lease_seconds);
  end if;
end $$;

create function public.claim_next_mexal_sync_job(p_worker_id text, p_lease_seconds integer default 300)
returns setof public.mexal_sync_jobs language sql security definer
set search_path = pg_catalog, public, pg_temp as $$
  select * from public.claim_priority_mexal_sync_job(p_worker_id,p_lease_seconds,null);
$$;
revoke all on function public.claim_priority_mexal_sync_job(text,integer,bigint) from public,anon,authenticated;
revoke all on function public.claim_next_mexal_sync_job(text,integer) from public,anon,authenticated;
grant execute on function public.claim_priority_mexal_sync_job(text,integer,bigint) to service_role;
grant execute on function public.claim_next_mexal_sync_job(text,integer) to service_role;

create or replace function public.enqueue_manual_workbench_oct_refresh(p_requested_by uuid default null,p_requested_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = pg_catalog,public,pg_temp as $$
declare v_schedule public.mexal_sync_schedules%rowtype; v_job public.mexal_sync_jobs%rowtype; v_cycle_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('workbench-oct-refresh',0));
  select * into v_schedule from public.mexal_sync_schedules where sync_type='oct_orders' and enabled and schedule_mode='daily_vercel_hobby' for update;
  if not found then raise exception 'OCT_SYNC_NOT_ENABLED'; end if;
  -- Attach to an OCT actually executing or an existing manual request, NOT to
  -- an automatic OCT waiting behind a whole night of stock synchronization.
  select * into v_job from public.mexal_sync_jobs where sync_type='oct_orders'
    and (status in ('leased','running') or (payload->>'lane'='manual_priority' and status in ('queued','retry')))
    order by id desc limit 1;
  if found then return jsonb_build_object('jobId',v_job.id,'cycleId',v_job.cycle_id,'status',v_job.status,'duplicate',true); end if;
  insert into public.mexal_sync_cycles(cycle_key,scheduled_date,scheduled_for,timezone,source,status,total_jobs,metadata)
    values('manual-oct-v2:'||gen_random_uuid()::text,(p_requested_at at time zone 'Europe/Rome')::date,p_requested_at,'Europe/Rome','worker_api','queued',1,
    jsonb_build_object('producer','workbench_manual_refresh','requestedBy',p_requested_by)) returning id into v_cycle_id;
  insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,batch_size,status,"offset",attempts,max_attempts,available_at,payload)
    values(v_cycle_id,v_schedule.id,'oct_orders',v_schedule.execution_order,v_schedule.batch_size,'queued',0,0,5,p_requested_at,
    jsonb_build_object('lane','manual_priority','optimization_version',2,'trigger','workbench_manual_refresh','requested_by',p_requested_by)) returning * into v_job;
  return jsonb_build_object('jobId',v_job.id,'cycleId',v_cycle_id,'status',v_job.status,'queued',true);
end $$;
revoke all on function public.enqueue_manual_workbench_oct_refresh(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_manual_workbench_oct_refresh(uuid,timestamptz) to service_role;

commit;
