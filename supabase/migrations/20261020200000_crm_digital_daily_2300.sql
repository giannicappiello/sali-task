begin;

create or replace function public.crm_digital_next_daily(p_now timestamptz default now())
returns timestamptz language sql stable set search_path=public as $$
  select ((p_now at time zone 'Europe/Rome')::date +
    case when (p_now at time zone 'Europe/Rome')::time < time '23:00' then 0 else 1 end + time '23:00') at time zone 'Europe/Rome';
$$;

create table public.crm_digital_daily_jobs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
  scheduled_date date not null, run_id uuid not null references public.crm_sync_runs(id),
  status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
  lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz not null default now(),
  error_attempts integer not null default 0, created_at timestamptz not null default now(),
  unique(connection_id,scheduled_date)
);
alter table public.crm_digital_daily_jobs enable row level security;
revoke all on public.crm_digital_daily_jobs from public,anon,authenticated;
grant all on public.crm_digital_daily_jobs to service_role;

create or replace function public.crm_claim_digital_daily_job_service()
returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.crm_digital_daily_jobs; token uuid := gen_random_uuid();
begin
  if auth.role()<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  select q.* into j from public.crm_digital_daily_jobs q
    join public.crm_external_connections c on c.id=q.connection_id
    where c.abilitata and c.sync_attivo and q.next_attempt_at<=now()
      and (q.status='queued' or (q.status='running' and q.lease_until<now()))
    order by q.next_attempt_at,q.created_at,q.id for update of q skip locked limit 1;
  if j.id is null then return null; end if;
  update public.crm_digital_daily_jobs set status='running',lease_token=token,lease_until=now()+interval '10 minutes' where id=j.id;
  update public.crm_sync_runs set status='running',started_at=coalesce(started_at,now()),heartbeat_at=now() where id=j.run_id;
  return jsonb_build_object('id',j.id,'run_id',j.run_id,'connection_id',j.connection_id,'lease_token',token);
end $$;

create or replace function public.crm_progress_digital_daily_job_service(
  p_job_id uuid,p_token uuid,p_status text,p_read integer,p_delay_seconds integer,p_error text,p_details jsonb,p_release boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.crm_digital_daily_jobs; next_status text; terminal boolean;
begin
  if auth.role()<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  select * into strict j from public.crm_digital_daily_jobs where id=p_job_id and lease_token=p_token and status='running' for update;
  if p_status not in ('queued','completed','failed','cancelled') then raise exception 'Stato non valido'; end if;
  next_status := case when p_status='failed' and j.error_attempts<2 then 'queued' else p_status end;
  terminal := next_status in ('completed','failed','cancelled');
  update public.crm_digital_daily_jobs set
    status=case when not p_release and not terminal then 'running' else next_status end,
    error_attempts=case when p_error is not null then error_attempts+1 else 0 end,
    next_attempt_at=now()+make_interval(secs=>greatest(0,least(coalesce(p_delay_seconds,0),3600))),
    lease_token=case when p_release or terminal then null else lease_token end,
    lease_until=case when p_release or terminal then null else now()+interval '10 minutes' end where id=j.id;
  update public.crm_sync_runs set
    status=case when terminal then next_status when p_release then 'partial' else 'running' end,
    completed_at=case when terminal then now() else null end,heartbeat_at=now(),
    records_read=records_read+greatest(coalesce(p_read,0),0),records_updated=records_updated+greatest(coalesce(p_read,0),0),
    records_failed=case when next_status='failed' then 1 else 0 end,
    duration_ms=(extract(epoch from(now()-coalesce(started_at,created_at)))*1000)::bigint,
    error_message=left(p_error,500),error_code=case when p_error is not null then 'scheduled_provider_error' else null end,
    details=details || coalesce(p_details,'{}') || jsonb_build_object('source','scheduled','local_time','23:00','timezone','Europe/Rome','hasMore',not terminal)
    where id=j.run_id;
  if terminal then
    update public.crm_external_connections set prossima_run_il=public.crm_digital_next_daily(),
      ultimo_errore=case when next_status='failed' then left(p_error,500) else null end where id=j.connection_id;
  end if;
  return jsonb_build_object('status',next_status);
end $$;

create or replace function public.crm_tick_digital_daily(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare connection_row record; local_now timestamp := p_now at time zone 'Europe/Rome'; run uuid; queued integer := 0; worker_token text;
begin
  -- A minute tick is only a wake-up. Business scheduling always uses Rome time.
  if local_now::time>=time '23:00' then
    for connection_row in select * from public.crm_external_connections c where c.abilitata and c.sync_attivo and c.sync_frequency='daily'
      and not exists(select 1 from public.crm_digital_daily_jobs j where j.connection_id=c.id and (j.scheduled_date=local_now::date or j.status in ('queued','running')))
      for update skip locked
    loop
      insert into public.crm_sync_runs(connection_id,sync_type,mode,status,idempotency_key,details)
      values(connection_row.id,'daily_full','full','queued','daily-2300:'||local_now::date,
        jsonb_build_object('source','scheduled','timezone','Europe/Rome','local_time','23:00','scheduled_date',local_now::date)) returning id into run;
      insert into public.crm_digital_daily_jobs(connection_id,scheduled_date,run_id) values(connection_row.id,local_now::date,run);
      queued := queued+1;
    end loop;
  end if;
  if exists(select 1 from public.crm_digital_daily_jobs where next_attempt_at<=now() and (status='queued' or (status='running' and lease_until<now()))) then
    select encode(extensions.hmac('crm-digital-daily',decrypted_secret,'sha256'),'hex') into worker_token
      from vault.decrypted_secrets where name='SUPABASE_SERVICE_ROLE_KEY' limit 1;
    if worker_token is null then raise exception 'Credenziale scheduler non configurata'; end if;
    perform net.http_post(url:='https://workspace.progre.it/api/crm/digital-connections',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_token),
      body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=240000);
  end if;
  return queued;
end $$;

revoke all on function public.crm_digital_next_daily(timestamptz) from public,anon;
grant execute on function public.crm_digital_next_daily(timestamptz) to authenticated,service_role;
revoke all on function public.crm_claim_digital_daily_job_service() from public,anon,authenticated;
revoke all on function public.crm_progress_digital_daily_job_service(uuid,uuid,text,integer,integer,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.crm_claim_digital_daily_job_service() to service_role;
grant execute on function public.crm_progress_digital_daily_job_service(uuid,uuid,text,integer,integer,text,jsonb,boolean) to service_role;
revoke all on function public.crm_tick_digital_daily(timestamptz) from public,anon,authenticated;

create or replace function public.crm_set_digital_next_daily() returns trigger language plpgsql set search_path=public as $$
begin
  if new.sync_attivo and new.sync_frequency='daily' then new.prossima_run_il := public.crm_digital_next_daily(); end if;
  return new;
end $$;
create trigger crm_digital_daily_next before insert or update on public.crm_external_connections
for each row execute function public.crm_set_digital_next_daily();

-- Enable the currently connected channels, preserving disabled connections.
update public.crm_external_connections set sync_attivo=true,sync_frequency='daily',prossima_run_il=public.crm_digital_next_daily() where abilitata;
select cron.schedule('crm-digital-daily-2300-rome','* * * * *','select public.crm_tick_digital_daily();');
notify pgrst,'reload schema';
commit;
