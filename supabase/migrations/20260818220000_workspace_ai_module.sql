begin;

insert into public.workspace_moduli (
  codice, nome, descrizione, tipo, area, percorso, provider,
  sempre_disponibile, assegnabile_reparto, configurabile_ruolo,
  mostra_menu, attivo, ordine
)
values (
  'assistente_ai', 'Assistente AI',
  'Assistente aziendale con accessi separati a dati interni, Web, ordini e ProgreMES.',
  'modulo', 'intelligenza_artificiale', '/assistente-ai', 'workspace',
  false, true, true, true, true, 85
)
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  area = excluded.area,
  percorso = excluded.percorso,
  provider = excluded.provider,
  assegnabile_reparto = true,
  configurabile_ruolo = true,
  mostra_menu = true,
  attivo = true,
  ordine = excluded.ordine;

insert into public.workspace_schermate (
  codice, nome, descrizione, provider, percorso, chiave_componente, protetta, attiva, ordine
)
values (
  'assistente_ai', 'Assistente AI',
  'Chat, ricerca e pianificazione assistita nel rispetto dei permessi Workspace.',
  'workspace', '/assistente-ai', 'assistant.ai', false, true, 85
)
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  percorso = excluded.percorso,
  chiave_componente = excluded.chiave_componente,
  attiva = true,
  ordine = excluded.ordine;

insert into public.workspace_moduli_schermate (
  modulo_codice, schermata_codice, ordine, predefinita, visibile_menu
)
values ('assistente_ai', 'assistente_ai', 10, true, true)
on conflict (modulo_codice, schermata_codice) do update set
  ordine = excluded.ordine,
  predefinita = true,
  visibile_menu = true;

insert into public.ruoli_moduli (ruolo_id, modulo, livello_accesso)
select
  r.id,
  'assistente_ai',
  case when r.amministratore_workspace then 'amministrazione' else 'lettura' end
from public.ruoli r
on conflict (ruolo_id, modulo) do nothing;

create table if not exists public.ai_reparti_capacita (
  reparto_id uuid primary key references public.reparti(id) on delete cascade,
  dati_interni boolean not null default true,
  ricerca_web boolean not null default false,
  ordini boolean not null default false,
  progremes boolean not null default false,
  pianificazione boolean not null default false,
  applicazione_piani boolean not null default false,
  limite_richieste_mese integer check (limite_richieste_mese is null or limite_richieste_mese > 0),
  aggiornato_da uuid references public.utenti(id) on delete set null,
  aggiornato_il timestamptz not null default now()
);

create table if not exists public.ai_conversazioni (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references public.utenti(id) on delete cascade,
  titolo text not null default 'Nuova conversazione',
  modalita text not null default 'interno' check (modalita in ('interno','web','ordini','pianificazione')),
  creata_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now()
);

create table if not exists public.ai_messaggi (
  id uuid primary key default gen_random_uuid(),
  conversazione_id uuid not null references public.ai_conversazioni(id) on delete cascade,
  ruolo text not null check (ruolo in ('user','assistant')),
  contenuto text not null,
  fonti jsonb not null default '[]'::jsonb,
  metadati jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now()
);

create table if not exists public.ai_proposte (
  id uuid primary key default gen_random_uuid(),
  conversazione_id uuid references public.ai_conversazioni(id) on delete set null,
  utente_id uuid not null references public.utenti(id) on delete cascade,
  tipo text not null check (tipo in ('piano_produzione','piano_ordini','piano_attivita')),
  titolo text not null,
  stato text not null default 'bozza' check (stato in ('bozza','approvata','in_applicazione','applicata','rifiutata','errore','connettore_richiesto')),
  criterio text not null,
  proposta jsonb not null default '{}'::jsonb,
  errore text,
  creata_il timestamptz not null default now(),
  approvata_il timestamptz,
  applicata_il timestamptz
);

create table if not exists public.ai_audit_log (
  id bigint generated always as identity primary key,
  utente_id uuid references public.utenti(id) on delete set null,
  azione text not null,
  entita_tipo text,
  entita_id text,
  dettagli jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now()
);

create table if not exists public.ai_utilizzo_mensile (
  utente_id uuid not null references public.utenti(id) on delete cascade,
  mese date not null,
  richieste integer not null default 0,
  token_input bigint not null default 0,
  token_output bigint not null default 0,
  aggiornato_il timestamptz not null default now(),
  primary key (utente_id, mese)
);

create index if not exists ai_conversazioni_utente_idx on public.ai_conversazioni (utente_id, aggiornata_il desc);
create index if not exists ai_messaggi_conversazione_idx on public.ai_messaggi (conversazione_id, creato_il);
create index if not exists ai_proposte_utente_idx on public.ai_proposte (utente_id, creata_il desc);
create index if not exists ai_audit_utente_idx on public.ai_audit_log (utente_id, creato_il desc);

alter table public.ai_reparti_capacita enable row level security;
alter table public.ai_conversazioni enable row level security;
alter table public.ai_messaggi enable row level security;
alter table public.ai_proposte enable row level security;
alter table public.ai_audit_log enable row level security;
alter table public.ai_utilizzo_mensile enable row level security;

create or replace function public.workspace_current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.utenti u
  where u.auth_user_id = auth.uid() and u.attivo is not false
  limit 1;
$$;

revoke all on function public.workspace_current_profile_id() from public, anon;
grant execute on function public.workspace_current_profile_id() to authenticated, service_role;

drop policy if exists "users read own AI department capabilities" on public.ai_reparti_capacita;
create policy "users read own AI department capabilities"
on public.ai_reparti_capacita for select to authenticated using (
  public.workspace_user_is_admin()
  or reparto_id in (
    select ur.reparto_id from public.utenti u
    join public.utenti_reparti ur on ur.utente_id = u.id
    where u.auth_user_id = auth.uid() and u.attivo is not false
    union
    select u.reparto_id from public.utenti u
    where u.auth_user_id = auth.uid() and u.attivo is not false and u.reparto_id is not null
  )
);

drop policy if exists "admins manage AI department capabilities" on public.ai_reparti_capacita;
create policy "admins manage AI department capabilities"
on public.ai_reparti_capacita for all to authenticated
using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());

drop policy if exists "users read own AI conversations" on public.ai_conversazioni;
create policy "users read own AI conversations" on public.ai_conversazioni
for select to authenticated using (utente_id = public.workspace_current_profile_id());

drop policy if exists "users read own AI messages" on public.ai_messaggi;
create policy "users read own AI messages" on public.ai_messaggi
for select to authenticated using (exists (
  select 1 from public.ai_conversazioni c
  where c.id = conversazione_id and c.utente_id = public.workspace_current_profile_id()
));

drop policy if exists "users read own AI proposals" on public.ai_proposte;
create policy "users read own AI proposals" on public.ai_proposte
for select to authenticated using (utente_id = public.workspace_current_profile_id());

drop policy if exists "users read own AI audit" on public.ai_audit_log;
create policy "users read own AI audit" on public.ai_audit_log
for select to authenticated using (utente_id = public.workspace_current_profile_id());

drop policy if exists "users read own AI usage" on public.ai_utilizzo_mensile;
create policy "users read own AI usage" on public.ai_utilizzo_mensile
for select to authenticated using (utente_id = public.workspace_current_profile_id());

grant select on public.ai_reparti_capacita, public.ai_conversazioni, public.ai_messaggi,
  public.ai_proposte, public.ai_audit_log, public.ai_utilizzo_mensile to authenticated;
grant select, insert, update, delete on public.ai_reparti_capacita to authenticated;

create or replace function public.workspace_ai_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select u.id, u.reparto_id, coalesce(r.amministratore_workspace, false) as is_admin
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid() and u.attivo is not false
    limit 1
  ), departments as (
    select ur.reparto_id from me join public.utenti_reparti ur on ur.utente_id = me.id
    union
    select reparto_id from me where reparto_id is not null
  ), policies as (
    select p.* from departments d
    left join public.ai_reparti_capacita p on p.reparto_id = d.reparto_id
  ), usage as (
    select coalesce(sum(u.richieste), 0)::integer as requests
    from me left join public.ai_utilizzo_mensile u
      on u.utente_id = me.id and u.mese = date_trunc('month', now())::date
  )
  select jsonb_build_object(
    'module_access', case when me.is_admin then true else public.workspace_module_enabled_for_user(me.id, 'assistente_ai') end,
    'internal_data', case when me.is_admin then true else coalesce(bool_or(coalesce(policies.dati_interni, true)), true) end,
    'web_search', case when me.is_admin then true else coalesce(bool_or(policies.ricerca_web), false) end,
    'orders', case when me.is_admin then true else coalesce(bool_or(policies.ordini), false) end,
    'progremes', case when me.is_admin then true else coalesce(bool_or(policies.progremes), false) end,
    'planning', case when me.is_admin then true else coalesce(bool_or(policies.pianificazione), false) end,
    'apply_plans', case when me.is_admin then true else coalesce(bool_or(policies.applicazione_piani), false) end,
    'monthly_limit', case when me.is_admin then null else min(policies.limite_richieste_mese) end,
    'monthly_requests', max(usage.requests)
  )
  from me cross join usage left join policies on true
  group by me.id, me.is_admin;
$$;

revoke all on function public.workspace_ai_capabilities() from public, anon;
grant execute on function public.workspace_ai_capabilities() to authenticated, service_role;

commit;
