-- Sprint 3: agenti Mexal -> Workspace.
create table if not exists public.mexal_agenti (
  id uuid primary key default gen_random_uuid(),
  codice text not null unique,
  nome text,
  cognome text,
  email text,
  telefono text,
  responsabile_utente_id uuid references public.utenti(id) on delete set null,
  workspace_utente_id uuid unique references public.utenti(id) on delete set null,
  accesso_workspace_attivo boolean not null default false,
  attivo_mexal boolean not null default true,
  dati_mexal jsonb not null default '{}'::jsonb,
  ultimo_sync_mexal timestamptz,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

create index if not exists mexal_agenti_nome_idx on public.mexal_agenti(cognome, nome);
create index if not exists mexal_agenti_responsabile_idx on public.mexal_agenti(responsabile_utente_id);

alter table public.utenti add column if not exists mexal_agente_id uuid references public.mexal_agenti(id) on delete set null;
alter table public.utenti add column if not exists codice_agente_mexal text;
create unique index if not exists utenti_mexal_agente_id_uidx on public.utenti(mexal_agente_id) where mexal_agente_id is not null;
create index if not exists utenti_codice_agente_mexal_idx on public.utenti(codice_agente_mexal);

alter table public.mexal_agenti enable row level security;
create policy "authenticated read mexal agents" on public.mexal_agenti for select to authenticated using (true);
create policy "admins manage mexal agents" on public.mexal_agenti for all to authenticated
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

-- Regola automatica predefinita, disattivata finché l'amministratore non la abilita.
insert into public.mexal_sync_schedules (sync_type, enabled, execution_order, batch_size)
select 'agents', false, 2, 100
where not exists (select 1 from public.mexal_sync_schedules where sync_type = 'agents');