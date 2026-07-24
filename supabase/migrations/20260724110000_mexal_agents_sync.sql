-- Sprint 3 agenti Mexal: source of truth /fornitori, account only for active 602.* agents.
create table if not exists public.mexal_agenti (
  codice_agente_mexal text primary key check (codice_agente_mexal ~ '^602\\.[0-9]{5}$'),
  nome text not null,
  cognome text,
  email text,
  telefono text,
  attivo boolean not null default true,
  dati_mexal jsonb not null default '{}'::jsonb,
  ultimo_sync_mexal timestamptz not null default now()
);
alter table public.mexal_agenti enable row level security;
drop policy if exists "authenticated read mexal agents" on public.mexal_agenti;
create policy "authenticated read mexal agents" on public.mexal_agenti for select to authenticated using (true);
