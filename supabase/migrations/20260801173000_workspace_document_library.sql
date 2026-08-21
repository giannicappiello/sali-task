create table if not exists public.documenti_workspace (
  id uuid primary key default gen_random_uuid(),
  percorso text not null unique,
  nome_file text not null,
  titolo text not null,
  estensione text not null,
  mime_group text not null default 'altro' check (mime_group in ('pdf','immagine','video','altro')),
  categoria text not null default 'Altro',
  marca text,
  gamma text,
  prodotto text,
  parole_chiave text[] not null default '{}',
  dimensione bigint not null default 0,
  modificato_il timestamptz,
  attivo boolean not null default true,
  sincronizzato_il timestamptz not null default now(),
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

create index if not exists documenti_workspace_categoria_idx on public.documenti_workspace (categoria);
create index if not exists documenti_workspace_attivo_idx on public.documenti_workspace (attivo, modificato_il desc);
create index if not exists documenti_workspace_ricerca_idx on public.documenti_workspace using gin (
  to_tsvector('simple', coalesce(titolo,'') || ' ' || coalesce(nome_file,'') || ' ' || coalesce(marca,'') || ' ' || coalesce(gamma,'') || ' ' || coalesce(prodotto,''))
);

alter table public.documenti_workspace enable row level security;

drop policy if exists "active users read workspace documents" on public.documenti_workspace;
create policy "active users read workspace documents"
on public.documenti_workspace for select to authenticated
using (attivo and exists (
  select 1 from public.utenti u
  where u.auth_user_id = auth.uid() and u.attivo is not false
));

drop policy if exists "admins manage workspace documents" on public.documenti_workspace;
create policy "admins manage workspace documents"
on public.documenti_workspace for all to authenticated
using (exists (
  select 1 from public.utenti u left join public.ruoli r on r.id = u.ruolo_id
  where u.auth_user_id = auth.uid() and u.attivo is not false
    and (coalesce(r.livello,0) >= 80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))
))
with check (exists (
  select 1 from public.utenti u left join public.ruoli r on r.id = u.ruolo_id
  where u.auth_user_id = auth.uid() and u.attivo is not false
    and (coalesce(r.livello,0) >= 80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))
));

grant select, insert, update, delete on public.documenti_workspace to authenticated;
