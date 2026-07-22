-- Allinea i vincoli del database al tipo di sincronizzazione
-- list_price_commissions già gestito dal backend Mexal.

alter table if exists public.mexal_sync_schedules
  drop constraint if exists mexal_sync_schedules_sync_type_check;

alter table if exists public.mexal_sync_schedules
  add constraint mexal_sync_schedules_sync_type_check
  check (
    sync_type in (
      'clients',
      'products',
      'commercial_conditions',
      'document_series',
      'stocks',
      'list_price_commissions',
      'orders'
    )
  );

-- Alcune installazioni hanno anche un CHECK sullo storico delle run.
alter table if exists public.mexal_sync_runs
  drop constraint if exists mexal_sync_runs_sync_type_check;

alter table if exists public.mexal_sync_runs
  add constraint mexal_sync_runs_sync_type_check
  check (
    sync_type in (
      'clients',
      'agents',
      'products',
      'commercial_conditions',
      'document_series',
      'stocks',
      'list_price_commissions',
      'orders',
      'payments'
    )
  );

insert into public.mexal_sync_schedules (
  sync_type,
  enabled,
  schedule_mode,
  batch_size,
  execution_order,
  created_at,
  updated_at
)
select
  'list_price_commissions',
  false,
  'daily_vercel_hobby',
  500,
  6,
  now(),
  now()
where not exists (
  select 1
  from public.mexal_sync_schedules
  where sync_type = 'list_price_commissions'
);