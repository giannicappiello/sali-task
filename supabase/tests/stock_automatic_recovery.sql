do $$
declare rid bigint; cid bigint; sid bigint; jid bigint; token uuid:=gen_random_uuid(); result jsonb;
begin
 select id into strict sid from public.mexal_sync_schedules where sync_type='stocks' limit 1;
 insert into public.mexal_sync_runs(sync_type,status,source,processed,updated,metadata)
 values('stocks','running','manual',42,30,'{"next_offset":42,"stock_state_version":2}') returning id into rid;
 insert into public.mexal_sync_cycles(cycle_key,scheduled_date,scheduled_for,timezone,source,status)
 values('test-stock-recovery-'||gen_random_uuid(),current_date,now(),'Europe/Rome','worker_api','running') returning id into cid;
 insert into public.mexal_sync_jobs(cycle_id,schedule_id,sync_type,execution_order,status,attempts,max_attempts,available_at,"offset",sync_run_id,worker_id,lock_token,lease_expires_at,last_result)
 values(cid,sid,'stocks',5,'running',5,5,now(),42,rid,'stock-recovery-test',token,now()+interval '5 minutes','{"nextOffset":42}') returning id into jid;
 if not public.mexal_stock_run_resumable(rid) or public.mexal_stock_run_resumable(null) then raise exception 'Resume eligibility broken';end if;
 if public.mexal_stock_night_window('2026-10-31 15:00:00+00') then raise exception 'Test requires daytime';end if;
 if position('mexal_stock_run_resumable(j.sync_run_id)' in pg_get_functiondef('public.claim_scheduled_mexal_sync_job_v1(text,integer)'::regprocedure))=0 then raise exception 'Daytime resume not wired into claim';end if;
 result:=public.retry_mexal_sync_job(jid,'stock-recovery-test',token,'Risposta automation non JSON (HTTP 402).',42,rid,'{}',true);
 if result->>'status'<>'retry' or (result->>'attempts')::integer<>0 or (result->>'offset')::integer<>42 or (result->>'available_at')::timestamptz<=now()
   or result->'last_result'->>'nextOffset'<>'42' then raise exception 'Transient failure lost automatic recovery or checkpoint: %',result;end if;
 if not exists(select 1 from public.mexal_sync_runs where id=rid and processed=42 and updated=30 and metadata->>'next_offset'='42') then raise exception 'Run cursor changed';end if;
 update public.mexal_sync_jobs set status='running',attempts=5,worker_id='stock-recovery-test',lock_token=token,lease_expires_at=now()-interval '1 second' where id=jid;
 perform public.recover_expired_mexal_sync_jobs();
 if not exists(select 1 from public.mexal_sync_jobs where id=jid and status='retry' and attempts=0 and "offset"=42) then raise exception 'Expired lease requires manual restart';end if;
 update public.mexal_sync_jobs set status='running',attempts=5,worker_id='stock-recovery-test',lock_token=token,lease_expires_at=now()+interval '5 minutes' where id=jid;
 result:=public.retry_mexal_sync_job(jid,'stock-recovery-test',token,'INVALID ARTICLE DATA',42,rid,'{}',true);
 if result->>'status'<>'failed' then raise exception 'Permanent data error retried forever';end if;
 update public.mexal_sync_runs set status='cancelled' where id=rid;
 if public.mexal_stock_run_resumable(rid) then raise exception 'Cancelled run eligible for automatic resume';end if;
 if public.mexal_stock_transient_error('INVALID ARTICLE DATA') or not public.mexal_stock_transient_error('fetch failed') or not public.mexal_stock_transient_error('HTTP 503') then raise exception 'Failure classification incorrect';end if;
end $$;
select 'PASS: daytime resume, transient retry rounds, expired lease recovery, preserved cursor, permanent errors and cancellation' as verification;
