alter table public.documenti_workspace
  add column if not exists brand_prodotti text[] not null default '{}',
  add column if not exists linee_prodotto text[] not null default '{}';
create index if not exists documenti_workspace_brand_prodotti_idx on public.documenti_workspace using gin (brand_prodotti);
create index if not exists documenti_workspace_linee_prodotto_idx on public.documenti_workspace using gin (linee_prodotto);
