-- Read-only Mexal category master data. This table intentionally has no link
-- to mexal_regole_provvigioni: category synchronization must not alter rules.
create table if not exists public.mexal_categorie_provvigionali (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('cliente', 'articolo')),
  codice_mexal text not null,
  identificativo_mexal text null,
  descrizione text null,
  attivo boolean null,
  payload jsonb not null default '{}'::jsonb,
  sincronizzato_il timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tipo, codice_mexal)
);
create index if not exists mexal_categorie_provvigionali_tipo_idx on public.mexal_categorie_provvigionali (tipo, sincronizzato_il desc);
alter table public.mexal_categorie_provvigionali enable row level security;
drop policy if exists "admins read mexal commission categories" on public.mexal_categorie_provvigionali;
create policy "admins read mexal commission categories" on public.mexal_categorie_provvigionali for select to authenticated using (
  exists (select 1 from public.utenti u left join public.ruoli r on r.id = u.ruolo_id where u.auth_user_id = auth.uid() and u.attivo is not false and (coalesce(r.livello, 0) >= 80 or lower(coalesce(r.nome, '')) in ('admin','administrator','amministratore','super admin','direzione')))
);
