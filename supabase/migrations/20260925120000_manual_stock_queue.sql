begin;
set local lock_timeout = '5s';

create or replace function public.enqueue_manual_stock_sync(p_requested_by uuid default null, p_resume_run_id bigint default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare j public.mexal_sync_jobs%rowtype; r public.mexal_sync_runs%rowtype; s public.mexal_sync_schedules%rowtype; cid bigint; ready timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended('mexal-worker-dispatch-v2',0));
  select * into j from public.mexal_sync_jobs where sync_type='stocks' and status in ('queued','retry','leased','running') order by id desc limit 1;
  if found then return jsonb_build_object('jobId',j.id,'sync_run_id',j.sync_run_id,'queued',true,'status',j.status,'duplicate',true,'manualPriority',coalesce(j.payload->>'lane','')='manual_priority'); end if;
  select * into s from public.mexal_sync_schedules where sync_type='stocks' order by id limit 1;
  if not found then raise exception 'Configurazione sincronizzazione giacenze mancante'; end if;
  if p_resume_run_id is not null then
    select * into r from public.mexal_sync_runs where id=p_resume_run_id and sync_type='stocks' for update;
    if not found or r.status not in ('running','failed') then raise exception 'Esecuzione non riprendibile'; end if;
    if r.status='failed' and not (coalesce((r.metadata#>>'{recovery,retryable}')::boolean,false) or coalesce(r.error_message,'') ~* 'statement timeout|lock timeout|network|timed out|fetch failed') then raise exception 'Errore non recuperabile automaticamente'; end if;
  else
    select * into r from public.mexal_sync_runs where sync_type='stocks' and status='running' order by id desc limit 1 for update;
  end if;
  if r.id is null then
    insert into public.mexal_sync_runs(sync_type,status,source,metadata)
    values('stocks','running','manual',jsonb_build_object('inputs_version',1,'stock_state_version',2,'batch_size',3,'next_offset',0,'checkpointed_at',now())) returning * into r;
  elsif r.status='running' then
    -- Let a legacy browser request finish before the worker takes ownership.
    ready := greatest(now(),coalesce((r.metadata->>'checkpointed_at')::timestamptz,r.started_at)+interval '6 minutes');
  else
    update public.mexal_sync_runs set status='running',completed_at=null,error_message=null,
      failed=coalesce((metadata#>>'{recovery,checkpoint_failed}')::integer,greatest(0,failed-1)) where id=r.id;
  end if;
  insert into public.mexal_sync_cycles(cycle_key,scheduled_date,scheduled_for,timezone,source,status,total_jobs,metadata)
  values('manual-stocks:'||gen_random_uuid(),(now() at time zone 'Europe/Rome')::date,now(),'Europe/Rome','worker_api','queued',1,
    jsonb_build_object('producer','workspace_manual_stocks','requestedBy',p_requested_by)) returning id into cid;
  insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,batch_size,status,"offset",sync_run_id,attempts,max_attempts,available_at,payload)
  values(cid,s.id,'stocks',s.execution_order,3,'queued',r.processed,r.id,0,5,ready,
    jsonb_build_object('lane','manual_priority','optimization_version',2,'requested_by',p_requested_by)) returning * into j;
  update public.mexal_sync_runs set metadata=metadata||jsonb_build_object('background_job_id',j.id,'batch_size',3) where id=r.id;
  return jsonb_build_object('jobId',j.id,'sync_run_id',r.id,'queued',true,'status','queued','available_at',ready,'manualPriority',true);
end $$;
revoke all on function public.enqueue_manual_stock_sync(uuid,bigint) from public,anon,authenticated;
grant execute on function public.enqueue_manual_stock_sync(uuid,bigint) to service_role;

-- Keep the existing global lease serialization, extend only its priority lane.
do $$ declare definition text; begin
  select pg_get_functiondef('public.claim_priority_mexal_sync_job(text,integer,bigint)'::regprocedure) into definition;
  if position('j.sync_type = ''oct_orders''' in definition)=0 then raise exception 'Unexpected priority claim definition'; end if;
  definition:=replace(definition,'j.sync_type = ''oct_orders''','j.sync_type in (''oct_orders'',''stocks'')');
  definition:=replace(definition,
    'and not exists(select 1 from public.mexal_sync_runs r where r.sync_type = ''oct_orders'' and r.status = ''running'')',
    'and (j.sync_type <> ''oct_orders'' or not exists(select 1 from public.mexal_sync_runs r where r.sync_type = ''oct_orders'' and r.status = ''running''))');
  execute definition;
end $$;

-- Expired leases at the retry limit must become visible failures, not remain
-- running forever. Other job types retain their existing recovery behavior.
create or replace function public.recover_expired_mexal_sync_jobs()
returns integer language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare recovered integer; cid bigint;
begin
  update public.mexal_sync_jobs set
    status=case when attempts>=max_attempts then 'failed' else 'retry' end,
    completed_at=case when attempts>=max_attempts then now() else null end,
    last_error=case when attempts>=max_attempts then 'Tentativi di recupero esauriti dopo interruzioni del worker.' else last_error end,
    available_at=now(),leased_at=null,lease_expires_at=null,heartbeat_at=null,worker_id=null,lock_token=null,updated_at=now()
  where status in ('leased','running') and lease_expires_at<=now() and (attempts<max_attempts or sync_type='stocks');
  get diagnostics recovered=row_count;
  for cid in select distinct cycle_id from public.mexal_sync_jobs where sync_type='stocks' and status='failed' loop
    perform public.refresh_mexal_sync_cycle_state(cid);
  end loop;
  return recovered;
end $$;
-- The existing stop operation closes both the run and its queued work atomically.
create or replace function public.cancel_stock_queue_on_run_stop()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare cid bigint;
begin
  if new.sync_type='stocks' and new.status='cancelled' and old.status <> new.status then
    for cid in
      update public.mexal_sync_jobs set status='cancelled', completed_at=now(), updated_at=now(),
        last_error='Arrestata manualmente', worker_id=null, lock_token=null, lease_expires_at=null, leased_at=null, heartbeat_at=null
      where sync_run_id=new.id and status in ('queued','retry','leased','running') returning cycle_id
    loop
      perform public.refresh_mexal_sync_cycle_state(cid);
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.cancel_stock_queue_on_run_stop() from public,anon,authenticated;
create trigger cancel_stock_queue_on_run_stop after update of status on public.mexal_sync_runs
for each row execute function public.cancel_stock_queue_on_run_stop();
commit;
