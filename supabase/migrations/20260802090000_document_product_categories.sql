alter table public.documenti_workspace
  add column if not exists categorie_prodotto text[] not null default '{}';

create index if not exists documenti_workspace_categorie_prodotto_idx
  on public.documenti_workspace using gin (categorie_prodotto);

comment on column public.documenti_workspace.categorie_prodotto is
  'Categorie Mexal: il documento è visibile su tutti i prodotti con categoria_mexal corrispondente.';
