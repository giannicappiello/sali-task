alter table public.workspace_article_supplier_associations
  add column if not exists source text not null default 'MANUAL',
  add column if not exists last_order_at date,
  add column if not exists order_count integer not null default 1 check (order_count > 0),
  add column if not exists source_seen_at timestamptz;

create index if not exists workspace_article_supplier_associations_source_idx
  on public.workspace_article_supplier_associations (source, source_seen_at desc);

create table if not exists public.workspace_article_supplier_sync_state (
  source text primary key,
  status text not null check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  relationship_count integer not null default 0 check (relationship_count >= 0),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.workspace_article_supplier_sync_state enable row level security;
revoke all on table public.workspace_article_supplier_sync_state from anon, authenticated;
grant all on table public.workspace_article_supplier_sync_state to service_role;

comment on column public.workspace_article_supplier_associations.source is
  'Origine dell associazione: storico ordini fornitore Mexal oppure integrazione manuale facoltativa.';
comment on table public.workspace_article_supplier_sync_state is
  'Stato della sincronizzazione automatica e idempotente delle associazioni articolo-fornitore.';
