-- Run after the migration, in the SAME transaction, then roll everything back.
do $$
declare a jsonb; b jsonb; j public.mexal_sync_jobs%rowtype; j2 public.mexal_sync_jobs%rowtype; count_jobs integer; start_offset integer;
begin
  if exists(select 1 from mexal_sync_jobs where status in ('queued','retry','leased','running')) then raise exception 'Test requires idle queue'; end if;
  a:=enqueue_manual_stock_sync(null,null);
  b:=enqueue_manual_stock_sync(null,null);
  if a->>'jobId' <> b->>'jobId' or not (b->>'duplicate')::boolean then raise exception 'Duplicate work created'; end if;
  update mexal_sync_jobs set available_at=now() where id=(a->>'jobId')::bigint;
  select * into strict j from claim_priority_mexal_sync_job('test-stock-one',300,(a->>'jobId')::bigint);
  start_offset:=j."offset";
  select count(*) into count_jobs from claim_priority_mexal_sync_job('test-stock-two',300,j.id);
  if count_jobs<>0 then raise exception 'Concurrent owner accepted'; end if;
  update mexal_sync_jobs set lease_expires_at=now()-interval '1 second' where id=j.id;
  perform recover_expired_mexal_sync_jobs();
  select * into strict j2 from claim_priority_mexal_sync_job('test-stock-two',300,j.id);
  if j2.sync_run_id<>j.sync_run_id or j2."offset"<>start_offset or j2.lock_token=j.lock_token then raise exception 'Recovery lost cursor or ownership'; end if;
  update mexal_sync_runs set status='cancelled',completed_at=now() where id=j2.sync_run_id;
  if exists(select 1 from mexal_sync_jobs where id=j.id and status<>'cancelled') then raise exception 'Stop left queue active'; end if;
  select count(*) into count_jobs from claim_priority_mexal_sync_job('test-stock-three',300,j.id);
  if count_jobs<>0 then raise exception 'Cancelled job claimed'; end if;
end $$;
select 'PASS: deduplication, exclusive claim, expired lease recovery, preserved cursor, cancellation' as verification;
rollback;
