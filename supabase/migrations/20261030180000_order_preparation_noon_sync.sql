begin;
set local lock_timeout='5s';
create table public.warehouse_order_sync_cache(
 id boolean primary key default true check(id),orders jsonb not null default '[]' check(jsonb_typeof(orders)='array'),
 last_synced_at timestamptz,last_attempt_at timestamptz,last_error text,
 lease_token uuid,lease_until timestamptz,lease_source text,
 last_scheduled_date date,scheduler_enabled boolean not null default false,
 dispatch_date date,dispatch_attempts integer not null default 0,next_dispatch_at timestamptz,last_request_id bigint
);
insert into public.warehouse_order_sync_cache(id) values(true);
alter table public.warehouse_order_sync_cache enable row level security;
revoke all on public.warehouse_order_sync_cache from public,anon,authenticated;
grant all on public.warehouse_order_sync_cache to service_role;
create function public.warehouse_claim_order_index_sync(p_source text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.warehouse_order_sync_cache;begin
 if p_source is null or p_source not in('manual','bootstrap','scheduled') then raise exception 'Sorgente non valida';end if;
 select * into strict r from public.warehouse_order_sync_cache where id=true for update;
 if r.lease_until>now() then return null;end if;
 if p_source='scheduled' and r.last_scheduled_date=(now() at time zone 'Europe/Rome')::date then return null;end if;
 update public.warehouse_order_sync_cache set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',lease_source=p_source,last_attempt_at=now() where id=true returning * into r;
 return jsonb_build_object('token',r.lease_token);
end;$$;
create function public.warehouse_finish_order_index_sync(p_token uuid,p_orders jsonb,p_error text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.warehouse_order_sync_cache;begin
 select * into strict r from public.warehouse_order_sync_cache where id=true for update;
 if p_token is null or r.lease_token is null or r.lease_token<>p_token then raise exception 'Sincronizzazione sostituita da un altro processo';end if;
 if p_error is null then
  if jsonb_typeof(p_orders) is distinct from 'array' then raise exception 'Elenco OCM non valido';end if;
  r.orders:=p_orders;r.last_synced_at:=now();r.last_error:=null;
  if r.lease_source='scheduled' then r.last_scheduled_date:=(now() at time zone 'Europe/Rome')::date;end if;
 else r.last_error:=left(p_error,1000);end if;
 update public.warehouse_order_sync_cache set orders=r.orders,last_synced_at=r.last_synced_at,last_error=r.last_error,last_scheduled_date=r.last_scheduled_date,lease_token=null,lease_until=null,lease_source=null where id=true returning * into r;
 return to_jsonb(r);
end;$$;
create function public.warehouse_tick_order_index_sync(p_now timestamptz default now()) returns bigint
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare r public.warehouse_order_sync_cache;local_now timestamp:=p_now at time zone 'Europe/Rome';worker_token text;request_id bigint;attempts integer;begin
 select * into strict r from public.warehouse_order_sync_cache where id=true for update;
 if not r.scheduler_enabled or local_now::time<time '12:00' or r.last_scheduled_date=local_now::date or r.lease_until>p_now then return null;end if;
 attempts:=case when r.dispatch_date=local_now::date then r.dispatch_attempts else 0 end;
 if attempts>=5 or (r.dispatch_date=local_now::date and r.next_dispatch_at>p_now) then return null;end if;
 select encode(extensions.hmac('warehouse-order-index',decrypted_secret,'sha256'),'hex') into worker_token from vault.decrypted_secrets where name='SUPABASE_SERVICE_ROLE_KEY' limit 1;
 if worker_token is null then raise exception 'Credenziale scheduler non configurata';end if;
 select net.http_post(url:='https://workspace.progre.it/api/mexal/automation?route=order-preparation-sync',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_token),body:='{}'::jsonb,timeout_milliseconds:=180000) into request_id;
 update public.warehouse_order_sync_cache set dispatch_date=local_now::date,dispatch_attempts=attempts+1,next_dispatch_at=p_now+interval '5 minutes',last_request_id=request_id where id=true;
 return request_id;
end;$$;
revoke all on function public.warehouse_claim_order_index_sync(text) from public,anon,authenticated;
revoke all on function public.warehouse_finish_order_index_sync(uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.warehouse_tick_order_index_sync(timestamptz) from public,anon,authenticated;
grant execute on function public.warehouse_claim_order_index_sync(text),public.warehouse_finish_order_index_sync(uuid,jsonb,text) to service_role;
-- The minute tick wakes only at/after noon Rome time; it dispatches once per successful day.
-- Enable scheduler_enabled only after the matching API deployment is ready.
select cron.schedule('warehouse-orders-noon-rome','* * * * *','select public.warehouse_tick_order_index_sync();');
notify pgrst,'reload schema';
commit;
