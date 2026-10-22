-- Run in a transaction with ROLLBACK. No external Mexal requests are made.
do $$
declare cid bigint; jid bigint; sid bigint; iid bigint; oid bigint; claimed public.mexal_sync_jobs%rowtype; result jsonb; count_claim integer;
begin
 if exists(select 1 from public.mexal_sync_jobs where status in ('leased','running') and lease_expires_at>now()) then
  raise exception 'Retry test when no active worker lease exists';end if;
 -- Temporarily isolate fixtures from live pending jobs. Caller MUST roll back.
 update public.mexal_sync_jobs set status='cancelled' where status in ('queued','retry');
 select id into sid from public.mexal_sync_schedules where sync_type='stocks';
 select id into iid from public.mexal_sync_schedules where sync_type='sales_invoices';
 select id into oid from public.mexal_sync_schedules where sync_type='oct_orders';
 insert into public.mexal_sync_cycles(cycle_key,scheduled_date,scheduled_for,timezone,source,status)
 values('test-failure-isolation-'||gen_random_uuid(),'1940-01-01','1940-01-01','Europe/Rome','worker_api','failed') returning id into cid;
 insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,status,attempts,max_attempts,available_at,last_error)
 values(cid,sid,'stocks',5,'failed',5,5,now(),'STOCK ERROR MUST REMAIN VISIBLE');
 insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,status,attempts,max_attempts,available_at,"offset")
 values(cid,iid,'sales_invoices',7,'queued',0,5,now(),44);
 insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,status,attempts,max_attempts,available_at)
 values(cid,oid,'oct_orders',90,'queued',0,5,now());
 perform public.resume_blocked_mexal_sync_cycles();
 select * into strict claimed from public.claim_next_mexal_sync_job('test-worker',300);
 if claimed.cycle_id<>cid or claimed.sync_type<>'sales_invoices' then raise exception 'Failed stocks still block invoices';end if;
 select count(*) into count_claim from public.claim_next_mexal_sync_job('test-second-worker',300);
 if count_claim<>0 then raise exception 'Concurrent active lease allowed';end if;
 update public.mexal_sync_jobs set attempts=5 where id=claimed.id;
 result:=public.retry_mexal_sync_job(claimed.id,'test-worker',claimed.lock_token,'INVOICE ERROR MUST RETRY',44,null,'{}',true);
 if result->>'status'<>'retry' or (result->>'attempts')::integer<>0 or (result->>'offset')::integer<>44
  or (result->>'available_at')::timestamptz<=now() or (result->'payload'->>'invoice_retry_rounds')::integer<>1 then raise exception 'Invoice lost at retry limit: %',result;end if;
 select * into strict claimed from public.claim_next_mexal_sync_job('test-worker',300);
 if claimed.cycle_id<>cid or claimed.sync_type<>'oct_orders' then raise exception 'Failed invoice backoff blocks following sync';end if;
 perform public.complete_mexal_sync_job(claimed.id,'test-worker',claimed.lock_token,'{}');
 update public.mexal_sync_jobs set available_at=now() where cycle_id=cid and sync_type='sales_invoices';
 select * into strict claimed from public.claim_next_mexal_sync_job('test-worker',300);
 if claimed.sync_type<>'sales_invoices' or claimed."offset"<>44 then raise exception 'Invoice resume skipped failed cursor';end if;
 perform public.complete_mexal_sync_job(claimed.id,'test-worker',claimed.lock_token,'{}');
 if (select status from public.mexal_sync_cycles where id=cid)<>'completed_with_errors' then raise exception 'Cycle error hidden';end if;
 if not exists(select 1 from public.mexal_sync_jobs where cycle_id=cid and sync_type='stocks' and status='failed' and last_error='STOCK ERROR MUST REMAIN VISIBLE') then raise exception 'Stock failure relabelled as skipped';end if;
 -- A stock retry, including outside its night window, cannot hold invoices.
 insert into public.mexal_sync_cycles(cycle_key,scheduled_date,scheduled_for,timezone,source,status)
 values('test-stock-retry-'||gen_random_uuid(),'1941-01-01','1941-01-01','Europe/Rome','worker_api','queued') returning id into cid;
 insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,status,attempts,max_attempts,available_at,last_error)
 values(cid,sid,'stocks',5,'retry',1,5,now()+interval '1 hour','retry later');
 insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,status,attempts,max_attempts,available_at)
 values(cid,iid,'sales_invoices',7,'queued',0,5,now());
 select * into strict claimed from public.claim_next_mexal_sync_job('test-worker',300);
 if claimed.sync_type<>'sales_invoices' or claimed.cycle_id<>cid then raise exception 'Backoff stock blocks invoice';end if;
 -- Exhausted lease recovery retains invoice work instead of failing permanently.
 update public.mexal_sync_jobs set attempts=5,lease_expires_at=now()-interval '1 second',"offset"=88 where id=claimed.id;
 perform public.recover_expired_mexal_sync_jobs();
 if not exists(select 1 from public.mexal_sync_jobs where id=claimed.id and status='retry' and attempts=0 and "offset"=88 and completed_at is null) then raise exception 'Expired invoice lease lost work';end if;
 update public.mexal_sync_jobs set status='cancelled' where cycle_id=cid and status in ('queued','retry');
 -- Fresh, healthy dependencies still execute in their normal order.
 insert into public.mexal_sync_cycles(cycle_key,scheduled_date,scheduled_for,timezone,source,status)
 values('test-dependency-'||gen_random_uuid(),'1942-01-01','1942-01-01','Europe/Rome','worker_api','queued') returning id into cid;
 insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,status,attempts,max_attempts,available_at)
 values(cid,(select id from public.mexal_sync_schedules where sync_type='products'),'products',2,'queued',0,5,now());
 insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,status,attempts,max_attempts,available_at)
 values(cid,iid,'sales_invoices',7,'queued',0,5,now());
 select * into strict claimed from public.claim_next_mexal_sync_job('test-worker',300);
 if claimed.sync_type<>'products' or claimed.cycle_id<>cid then raise exception 'Healthy dependency order lost';end if;
 if has_function_privilege('authenticated','public.resume_blocked_mexal_sync_cycles()','execute') then raise exception 'Recovery exposed to unprivileged caller';end if;
end;$$;
select 'PASS: failed/retrying stocks do not block invoices; failed invoice persists beyond max attempts; other jobs continue; cursor/locks/errors preserved' as result;
