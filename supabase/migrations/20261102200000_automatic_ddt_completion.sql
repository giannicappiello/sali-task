begin;
create table public.warehouse_completion_jobs(
 preparation_id uuid primary key references public.warehouse_order_preparations(id),export_token uuid not null,
 status text not null default 'queued' check(status in('queued','processing','completed','blocked')),
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,
 last_error text,updated_at timestamptz not null default now()
);
alter table public.warehouse_completion_jobs enable row level security;
revoke all on public.warehouse_completion_jobs from public,anon,authenticated,service_role;
grant select on public.warehouse_completion_jobs to service_role;
create function public.warehouse_schedule_completion() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.status='exporting' and new.export_token is not null and (old.export_token is distinct from new.export_token or old.status is distinct from 'exporting') then
  insert into public.warehouse_completion_jobs(preparation_id,export_token,next_attempt_at) values(new.id,new.export_token,now()+interval '45 seconds')
  on conflict(preparation_id) do update set export_token=excluded.export_token,status='queued',attempts=0,next_attempt_at=excluded.next_attempt_at,lease_token=null,lease_until=null,last_error=null,updated_at=now();
 end if;return new;
end;$$;
create trigger warehouse_schedule_completion after update of status,export_token on public.warehouse_order_preparations for each row execute function public.warehouse_schedule_completion();
create function public.warehouse_completion_claim() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.warehouse_completion_jobs;begin
 select * into j from public.warehouse_completion_jobs where status in('queued','processing') and next_attempt_at<=now() and (lease_until is null or lease_until<=now()) order by next_attempt_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.warehouse_completion_jobs set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where preparation_id=j.preparation_id returning * into j;
 return to_jsonb(j);
end;$$;
create function public.warehouse_completion_result(p_id uuid,p_token uuid,p_done boolean,p_error text,p_blocked boolean default false) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.warehouse_completion_jobs;r public.warehouse_order_preparations;begin
 select * into strict j from public.warehouse_completion_jobs where preparation_id=p_id for update;
 if j.lease_token is distinct from p_token or j.status<>'processing' then raise exception 'Completamento già acquisito da un altro processo';end if;
 select * into strict r from public.warehouse_order_preparations where id=p_id;
 update public.warehouse_completion_jobs set status=case when p_done then 'completed' when p_blocked or attempts>=12 then 'blocked' else 'queued' end,
 next_attempt_at=now()+make_interval(secs=>least(900,30*power(2,least(attempts,5)))::integer),last_error=left(p_error,2000),lease_token=null,lease_until=null,updated_at=now() where preparation_id=p_id returning * into j;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(p_id,gen_random_uuid(),case when p_done then 'automatic_completion_finished' else 'automatic_completion_retry' end,r.updated_by,jsonb_build_object('attempt',j.attempts,'status',j.status,'error',j.last_error,'exportToken',j.export_token));
 return to_jsonb(j);
end;$$;
create function public.warehouse_tick_completion() returns bigint language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare worker_token text;request_id bigint;begin
 if not exists(select 1 from public.warehouse_completion_jobs where status in('queued','processing') and next_attempt_at<=now() and (lease_until is null or lease_until<=now())) then return null;end if;
 select encode(extensions.hmac('warehouse-ddt-completion',decrypted_secret,'sha256'),'hex') into worker_token from vault.decrypted_secrets where name='SUPABASE_SERVICE_ROLE_KEY' limit 1;
 if worker_token is null then raise exception 'Credenziale completamento non disponibile';end if;
 select net.http_post(url:='https://workspace.progre.it/api/mexal/automation?route=order-preparation-completion',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_token),body:='{}'::jsonb,timeout_milliseconds:=180000) into request_id;
 return request_id;
end;$$;
revoke all on function public.warehouse_completion_claim(),public.warehouse_completion_result(uuid,uuid,boolean,text,boolean),public.warehouse_tick_completion(),public.warehouse_schedule_completion() from public,anon,authenticated;
grant execute on function public.warehouse_completion_claim(),public.warehouse_completion_result(uuid,uuid,boolean,text,boolean) to service_role;
select cron.schedule('warehouse-ddt-completion','* * * * *','select public.warehouse_tick_completion();');
notify pgrst,'reload schema';
commit;
