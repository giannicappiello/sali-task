begin;

alter table public.mexal_sync_jobs
  drop constraint if exists mexal_sync_jobs_sync_type_check;

alter table public.mexal_sync_jobs
  add constraint mexal_sync_jobs_sync_type_check
  check (sync_type in (
    'clients',
    'agents',
    'products',
    'commercial_conditions',
    'document_series',
    'stocks',
    'list_price_commissions',
    'orders',
    'payments',
    'sales_invoices'
  ));

commit;
