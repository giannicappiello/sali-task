-- A run is always closed explicitly: cancellation is distinct from an error.
alter table public.mexal_sync_runs drop constraint if exists mexal_sync_runs_status_check;
alter table public.mexal_sync_runs add constraint mexal_sync_runs_status_check
  check (status in ('running', 'completed', 'failed', 'cancelled', 'timeout', 'skipped'));
