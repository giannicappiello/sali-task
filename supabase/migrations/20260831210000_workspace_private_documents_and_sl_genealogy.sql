begin;

create table if not exists public.workspace_private_documents (
  external_id uuid primary key,
  tipo text not null,
  titolo text not null,
  revisione text not null default '1',
  lingua text not null default 'IT',
  nome_file_originale text not null,
  content_type text not null,
  dimensione_byte bigint not null default 0,
  valido_dal timestamptz,
  valido_al timestamptz,
  attivo boolean not null default true,
  caricato_da text,
  caricato_il timestamptz not null,
  tipo_associazione text not null,
  articolo_mes_id integer,
  giacenza_mes_id integer,
  ordine_produzione_mes_id integer,
  produzione_mes_id integer,
  codice_lotto text,
  sincronizzato_il timestamptz not null default now()
);

create index if not exists workspace_private_documents_article_idx
  on public.workspace_private_documents(articolo_mes_id, codice_lotto, caricato_il desc);
create index if not exists workspace_private_documents_order_idx
  on public.workspace_private_documents(ordine_produzione_mes_id, caricato_il desc);

create table if not exists public.workspace_sl_genealogy (
  mes_id bigint primary key,
  ordine_produzione_mes_id integer not null,
  numero_ordine_produzione text not null,
  articolo_prodotto_mes_id integer not null,
  codice_articolo_prodotto text not null,
  lotto_destinazione text not null,
  tipo_lotto_destinazione text not null,
  articolo_materia_prima_mes_id integer not null,
  codice_articolo_materia_prima text not null,
  descrizione_materia_prima text,
  giacenza_origine_mes_id integer not null,
  lotto_origine text not null,
  quantita numeric(18,6) not null,
  unita_misura text,
  documento_sl text,
  registrata_il timestamptz not null,
  riferimento_oct text,
  riferimento_rdp text,
  codice_cliente text,
  sincronizzato_il timestamptz not null default now()
);

create index if not exists workspace_sl_genealogy_destination_idx
  on public.workspace_sl_genealogy(articolo_prodotto_mes_id, lotto_destinazione);
create index if not exists workspace_sl_genealogy_source_idx
  on public.workspace_sl_genealogy(articolo_materia_prima_mes_id, lotto_origine);
create index if not exists workspace_sl_genealogy_customer_idx
  on public.workspace_sl_genealogy(codice_cliente, registrata_il desc);

-- Associa gli account Workspace esterni ai codici cliente Mexal autorizzati.
-- Gli utenti interni con accesso al modulo Documenti non necessitano di righe qui.
create table if not exists public.workspace_private_document_customer_access (
  utente_id uuid not null references public.utenti(id) on delete cascade,
  codice_cliente text not null,
  creato_il timestamptz not null default now(),
  creato_da uuid references public.utenti(id) on delete set null,
  primary key (utente_id, codice_cliente)
);

alter table public.workspace_private_documents enable row level security;
alter table public.workspace_sl_genealogy enable row level security;
alter table public.workspace_private_document_customer_access enable row level security;

revoke all on public.workspace_private_documents from public, anon, authenticated;
revoke all on public.workspace_sl_genealogy from public, anon, authenticated;
revoke all on public.workspace_private_document_customer_access from public, anon, authenticated;
grant all on public.workspace_private_documents to service_role;
grant all on public.workspace_sl_genealogy to service_role;
grant all on public.workspace_private_document_customer_access to service_role;

insert into public.permessi(codice, descrizione, modulo)
values
  ('documentation.private.view', 'Visualizza e scarica i Documenti Private autorizzati', 'documenti'),
  ('documentation.private.upload', 'Carica e classifica i Documenti Private sul NAS', 'documenti'),
  ('documentation.private.manage_access', 'Gestisce gli accessi cliente ai Documenti Private', 'documenti')
on conflict (codice) do update set descrizione = excluded.descrizione, modulo = excluded.modulo;

commit;
