begin;

create table if not exists public.ai_argomenti (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references public.utenti(id) on delete cascade,
  nome text not null check (char_length(trim(nome)) between 1 and 100),
  tipo text not null default 'argomento' check (tipo in ('argomento', 'progetto')),
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

alter table public.ai_conversazioni
  add column if not exists argomento_id uuid references public.ai_argomenti(id) on delete set null;

create index if not exists ai_argomenti_utente_idx on public.ai_argomenti (utente_id, aggiornato_il desc);
create unique index if not exists ai_argomenti_nome_unique_idx on public.ai_argomenti (utente_id, lower(nome), tipo);
create index if not exists ai_conversazioni_argomento_idx on public.ai_conversazioni (argomento_id, aggiornata_il desc);

alter table public.ai_argomenti enable row level security;

drop policy if exists "users read own AI topics" on public.ai_argomenti;
create policy "users read own AI topics" on public.ai_argomenti
for select to authenticated using (utente_id = public.workspace_current_profile_id());

grant select on public.ai_argomenti to authenticated;

commit;
