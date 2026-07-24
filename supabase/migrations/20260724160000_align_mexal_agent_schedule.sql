-- Consente al dispatcher giornaliero di includere la sincronizzazione agenti.
alter table if exists public.mexal_sync_schedules
  drop constraint if exists mexal_sync_schedules_sync_type_check;

alter table if exists public.mexal_sync_schedules
  add constraint mexal_sync_schedules_sync_type_check
  check (
    sync_type in (
      'clients',
      'agents',
      'products',
      'commercial_conditions',
      'document_series',
      'stocks',
      'list_price_commissions',
      'orders'
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
  'agents',
  false,
  'daily_vercel_hobby',
  100,
  2,
  now(),
  now()
where not exists (
  select 1
  from public.mexal_sync_schedules
  where sync_type = 'agents'
);
