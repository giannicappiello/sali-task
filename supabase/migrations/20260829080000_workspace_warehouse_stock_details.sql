begin;

create table if not exists public.workspace_warehouse_stock (
  article_code text not null references public.ordini_prodotti_cache(codice_articolo) on update cascade on delete cascade,
  warehouse_number integer not null check (warehouse_number > 0),
  warehouse_name text,
  unit_of_measure text,
  on_hand numeric(18,4) not null default 0,
  committed numeric(18,4) not null default 0,
  available numeric(18,4) not null default 0,
  unit_cost numeric(14,6) not null default 0 check (unit_cost >= 0),
  source_payload jsonb not null default '{}'::jsonb,
  sync_run_id bigint references public.mexal_sync_runs(id) on delete set null,
  synchronized_at timestamptz not null default now(),
  is_current boolean not null default true,
  primary key (article_code, warehouse_number)
);

create index if not exists workspace_warehouse_stock_current_warehouse_idx
  on public.workspace_warehouse_stock (warehouse_number, article_code)
  where is_current = true;

comment on table public.workspace_warehouse_stock is
  'Progressivi reali Mexal per articolo e singolo magazzino. Non sostituisce la disponibilita ordini IT/MKT, che resta sul magazzino 5.';

alter table public.workspace_warehouse_stock enable row level security;

drop policy if exists "warehouse stock authenticated read" on public.workspace_warehouse_stock;
create policy "warehouse stock authenticated read"
  on public.workspace_warehouse_stock for select to authenticated using (true);

grant select on public.workspace_warehouse_stock to authenticated;
grant select, insert, update, delete on public.workspace_warehouse_stock to service_role;

commit;
