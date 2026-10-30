-- Rollback-only production benchmark (no persistent data writes). Run with an administrative database connection.
-- Uses an existing active Workspace administrator, without creating users or changing grants.
-- Each RPC is timed as an independent statement at the previous 8s deadline.
begin;
create temporary table crm_timing(label text,rows bigint,elapsed_ms numeric);
grant insert,select on crm_timing to authenticated;
create function pg_temp.record_crm_timing(p_label text,p_call text) returns void language plpgsql as $body$
declare data jsonb; started timestamptz:=clock_timestamp(); begin
 execute 'select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from public.'||p_call||' r' into data;
 insert into crm_timing values(p_label,jsonb_array_length(data),extract(epoch from clock_timestamp()-started)*1000);
end;$body$;
grant execute on function pg_temp.record_crm_timing(text,text) to authenticated;
do $auth$ declare subject text;begin
 select u.auth_user_id::text into subject from public.utenti u join public.ruoli r on r.id=u.ruolo_id
 where u.attivo is not false and r.amministratore_workspace is true and u.auth_user_id is not null order by u.id limit 1;
 if subject is null then raise exception 'No active Workspace administrator for benchmark';end if;
 perform set_config('request.jwt.claim.sub',subject,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',subject)::text,true);
end;$auth$;
set local role authenticated;
set local statement_timeout='8s';
select pg_temp.record_crm_timing('b2b_october',$call$crm_customer_metric_details('b2b','2026-10-01','2026-10-30','invoiced',null,200,0,'active')$call$);
select pg_temp.record_crm_timing('b2b_all',$call$crm_customer_metric_details('b2b','2026-01-01','2026-10-30','all',null,200,0,'all')$call$);
select pg_temp.record_crm_timing('b2b_second_page',$call$crm_customer_metric_details('b2b','2026-01-01','2026-10-30','all',null,200,200,'all')$call$);
select pg_temp.record_crm_timing('online',$call$crm_customer_metric_details('online','2026-10-01','2026-10-30','invoiced',null,200,0,'all')$call$);
select pg_temp.record_crm_timing('private',$call$crm_customer_metric_details('conto_terzi','2026-10-01','2026-10-30','invoiced',null,200,0,'all')$call$);
select pg_temp.record_crm_timing('ph',$call$crm_b2b_order_customer_details('b2b','2026-01-01','2026-10-30','all',null,200,0,'all','ph',null)$call$);
select pg_temp.record_crm_timing('pr',$call$crm_b2b_order_customer_details('regular','b2b','2026-01-01','2026-10-30','all',null,200,0,'all','prof',null)$call$);
select pg_temp.record_crm_timing('pr_second_page',$call$crm_b2b_order_customer_details('regular','b2b','2026-01-01','2026-10-30','all',null,200,200,'all','prof',null)$call$);
select pg_temp.record_crm_timing('mypharma',$call$crm_b2b_order_customer_details('mypharma','b2b','2026-01-01','2026-10-30','all',null,200,0,'all','prof',null)$call$);
select jsonb_agg(to_jsonb(crm_timing)) results from crm_timing;
rollback;
