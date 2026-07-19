-- Corrective migration: central run ids are bigint, while the legacy detail
-- tables retain UUID ids for commercial-condition internal runs.
update public.mexal_sync_runs
set status = 'timeout',
    completed_at = now(),
    error_message = coalesce(error_message, 'Run chiusa automaticamente durante la migrazione correttiva.')
where status = 'running'
  and started_at < now() - interval '30 minutes';

insert into public.mexal_event_automations
  (event_key, sync_type, execution_order, enabled, blocking, allow_continue_on_error, scope)
values
  ('orders_module_open', 'products', 1, true, false, true, 'global'),
  ('orders_module_open', 'stocks', 2, true, false, true, 'global')
on conflict (event_key, sync_type, scope) do nothing;
