begin;
set local lock_timeout='5s';

-- The night window controls new starts. A checkpointed running import can
-- continue at any hour, retaining the existing lease and cursor checks.
create or replace function public.mexal_stock_run_resumable(p_run_id bigint)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
 select exists(select 1 from public.mexal_sync_runs
   where id=p_run_id and sync_type='stocks' and status='running');
$$;
revoke all on function public.mexal_stock_run_resumable(bigint) from public,anon,authenticated;
grant execute on function public.mexal_stock_run_resumable(bigint) to service_role;

-- Infrastructure failures need another automatic retry round, rather than
-- permanent failure after five attempts. Invalid data and cancellation remain
-- terminal; errors and checkpoints are retained.
create or replace function public.mexal_stock_transient_error(p_error text)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(p_error,'') ~* '(HTTP[ :]+(402|408|429|5[0-9][0-9])|statement timeout|lock timeout|timed? out|fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|schema cache|PGRST00[123])';
$$;

do $$ declare d text; old_condition text; retry_condition text; begin
 select pg_get_functiondef('public.claim_scheduled_mexal_sync_job_v1(text,integer)'::regprocedure) into d;
 old_condition := '(j.sync_type <> ''stocks'' or public.mexal_stock_night_window(now()))';
 if position(old_condition in d)=0 then raise exception 'Unexpected scheduled claim definition'; end if;
 d:=replace(d,old_condition,'(j.sync_type <> ''stocks'' or public.mexal_stock_night_window(now()) or public.mexal_stock_run_resumable(j.sync_run_id))');
 -- Expired leases represent interrupted execution, not invalid source data.
 d:=replace(d,'sync_type<>''sales_invoices''','sync_type not in (''sales_invoices'',''stocks'')');
 d:=replace(d,'sync_type=''sales_invoices''','sync_type in (''sales_invoices'',''stocks'')');
 execute d;

 select pg_get_functiondef('public.retry_mexal_sync_job(bigint,text,uuid,text,integer,bigint,jsonb,boolean)'::regprocedure) into d;
 if position('sync_type<>''sales_invoices''' in d)=0 then raise exception 'Unexpected retry definition';end if;
 retry_condition:='(sync_type=''sales_invoices'' or (sync_type=''stocks'' and public.mexal_stock_transient_error(p_error)))';
 d:=replace(d,'sync_type<>''sales_invoices''','not '||retry_condition);
 d:=replace(d,'sync_type=''sales_invoices''',retry_condition);
 -- Preserve the last useful result on a failed call and count recovery rounds.
 -- Existing invoice metadata remains compatible; stock rounds use the same counter.
 d:=replace(d,'last_result = coalesce(p_result, ''{}''::jsonb)','last_result = case when p_is_failure then last_result else coalesce(p_result, ''{}''::jsonb) end');
 execute d;

 select pg_get_functiondef('public.recover_expired_mexal_sync_jobs()'::regprocedure) into d;
 if position('sync_type<>''sales_invoices''' in d)=0 then raise exception 'Unexpected expired lease definition';end if;
 d:=replace(d,'sync_type<>''sales_invoices''','sync_type not in (''sales_invoices'',''stocks'')');
 d:=replace(d,'sync_type=''sales_invoices''','sync_type in (''sales_invoices'',''stocks'')');
 execute d;
end $$;
commit;
