begin;

alter table public.notifiche
  add column if not exists evento text,
  add column if not exists url text,
  add column if not exists priorita text not null default 'normale',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists letta_il timestamptz;

create table if not exists public.notifiche_preferenze (
  utente_id uuid primary key references public.utenti(id) on delete cascade,
  push_attive boolean not null default false,
  suono_attivo boolean not null default true,
  pausa_dalle time,
  pausa_alle time,
  eventi jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifiche_dispositivi (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references public.utenti(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  nome_dispositivo text,
  user_agent text,
  attivo boolean not null default true,
  ultimo_utilizzo timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists notifiche_dispositivi_utente_idx
  on public.notifiche_dispositivi(utente_id, attivo);

create table if not exists public.notifiche_regole (
  codice text primary key,
  nome text not null,
  descrizione text,
  gruppo text not null,
  attiva boolean not null default true,
  push_attiva boolean not null default true,
  suono_attivo boolean not null default true,
  anticipo_minuti integer[] not null default '{}'::integer[],
  updated_at timestamptz not null default now()
);

insert into public.notifiche_regole
  (codice, nome, descrizione, gruppo, anticipo_minuti)
values
  ('messaggio_nuovo', 'Nuovo messaggio', 'Avvisa il destinatario di un nuovo messaggio.', 'Messaggi', '{}'),
  ('attivita_nuova', 'Nuova attività', 'Avvisa le persone assegnate a una nuova attività.', 'Attività', '{}'),
  ('attivita_stato', 'Variazione stato attività', 'Avvisa le persone coinvolte quando cambia lo stato.', 'Attività', '{}'),
  ('attivita_scadenza', 'Attività in scadenza', 'Promemoria prima della scadenza.', 'Attività', '{1440,60}'),
  ('ordine_nuovo', 'Nuovo ordine', 'Avvisa le persone interessate alla creazione di un ordine.', 'Ordini', '{}'),
  ('ordine_stato', 'Variazione stato ordine', 'Avvisa quando cambia lo stato di un ordine.', 'Ordini', '{}'),
  ('giornata_nuova', 'Nuova giornata', 'Avvisa le persone interessate alla nuova giornata.', 'Beauty Days', '{}'),
  ('giornata_stato', 'Variazione stato giornata', 'Avvisa quando cambia lo stato della giornata.', 'Beauty Days', '{}'),
  ('richiesta_giornata', 'Richiesta giornata', 'Avvisa in seguito a una nuova richiesta.', 'Beauty Days', '{}')
on conflict (codice) do nothing;

create table if not exists public.notifiche_push_coda (
  id uuid primary key default gen_random_uuid(),
  notifica_id uuid not null references public.notifiche(id) on delete cascade,
  disponibile_dal timestamptz not null default now(),
  tentativi integer not null default 0,
  elaborata_il timestamptz,
  ultimo_errore text,
  created_at timestamptz not null default now(),
  unique(notifica_id)
);

create or replace function public.accoda_notifica_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  evento_codice text;
  regola_attiva boolean;
begin
  evento_codice := coalesce(new.evento, new.tipo, 'generica');
  select coalesce(r.attiva and r.push_attiva, true)
    into regola_attiva
  from public.notifiche_regole r
  where r.codice = evento_codice;

  if coalesce(regola_attiva, true) then
    insert into public.notifiche_push_coda(notifica_id)
    values (new.id)
    on conflict (notifica_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notifiche_accoda_push on public.notifiche;
create trigger notifiche_accoda_push
after insert on public.notifiche
for each row execute function public.accoda_notifica_push();

alter table public.notifiche_preferenze enable row level security;
alter table public.notifiche_dispositivi enable row level security;
alter table public.notifiche_regole enable row level security;
alter table public.notifiche_push_coda enable row level security;

drop policy if exists "preferenze proprie" on public.notifiche_preferenze;
create policy "preferenze proprie" on public.notifiche_preferenze
for all to authenticated
using (utente_id = (select id from public.utenti where auth_user_id = auth.uid()))
with check (utente_id = (select id from public.utenti where auth_user_id = auth.uid()));

drop policy if exists "dispositivi propri" on public.notifiche_dispositivi;
create policy "dispositivi propri" on public.notifiche_dispositivi
for all to authenticated
using (utente_id = (select id from public.utenti where auth_user_id = auth.uid()))
with check (utente_id = (select id from public.utenti where auth_user_id = auth.uid()));

drop policy if exists "regole leggibili" on public.notifiche_regole;
create policy "regole leggibili" on public.notifiche_regole
for select to authenticated using (true);

create or replace function public.salva_regola_notifica(
  p_codice text,
  p_attiva boolean,
  p_push_attiva boolean,
  p_suono_attivo boolean,
  p_anticipo_minuti integer[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.utenti u
    join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and (coalesce(r.livello, 0) >= 80 or lower(r.nome) in ('admin','administrator','amministratore','super admin','direzione'))
  ) then
    raise exception 'Operazione riservata agli amministratori';
  end if;

  update public.notifiche_regole
  set attiva = p_attiva,
      push_attiva = p_push_attiva,
      suono_attivo = p_suono_attivo,
      anticipo_minuti = coalesce(p_anticipo_minuti, '{}'::integer[]),
      updated_at = now()
  where codice = p_codice;
end;
$$;

grant execute on function public.salva_regola_notifica(text, boolean, boolean, boolean, integer[]) to authenticated;

commit;
