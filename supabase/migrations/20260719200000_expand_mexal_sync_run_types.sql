-- Estende il registro append-only senza alterare o eliminare run esistenti.
alter table public.mexal_sync_runs drop constraint if exists mexal_sync_runs_sync_type_check;
alter table public.mexal_sync_runs add constraint mexal_sync_runs_sync_type_check
  check (sync_type in ('products','clients','stocks','orders','commercial_conditions','document_series','agents','payments'));
