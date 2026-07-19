-- Keep every status used by the Mexal run lifecycle, including terminal manual stops.
-- This alters only the status constraint and leaves all existing run data untouched.
alter table public.mexal_sync_runs
  drop constraint if exists mexal_sync_runs_status_check;

alter table public.mexal_sync_runs
  add constraint mexal_sync_runs_status_check
  check (status in (
    'running',
    'completed',
    'completed_with_errors',
    'completed_with_warnings',
    'failed',
    'cancelled',
    'timeout',
    'skipped'
  ));
