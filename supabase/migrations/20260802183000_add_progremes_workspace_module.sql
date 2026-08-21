begin;

alter table public.reparti_moduli
  drop constraint if exists reparti_moduli_modulo_check;

alter table public.reparti_moduli
  add constraint reparti_moduli_modulo_check check (
    modulo in (
      'beauty_days',
      'ordini_pr',
      'ordini_ph',
      'prodotti',
      'documenti',
      'progetti',
      'attivita',
      'agenda',
      'messaggi',
      'report',
      'team',
      'progremes'
    )
  );

create table if not exists public.progremes_sso_tickets (
  token_hash text primary key,
  utente_id uuid not null references public.utenti(id) on delete cascade,
  creato_il timestamptz not null default now(),
  scade_il timestamptz not null,
  consumato_il timestamptz
);

alter table public.progremes_sso_tickets enable row level security;

revoke all on public.progremes_sso_tickets from public, anon, authenticated;

create or replace function public.consume_progremes_sso_ticket(target_token_hash text)
returns table (
  workspace_user_id uuid,
  email text,
  nome text,
  cognome text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with consumed as (
    update public.progremes_sso_tickets ticket
    set consumato_il = now()
    where ticket.token_hash = target_token_hash
      and ticket.consumato_il is null
      and ticket.scade_il >= now()
    returning ticket.utente_id
  )
  select
    user_profile.id,
    lower(btrim(user_profile.email)),
    coalesce(user_profile.nome, ''),
    coalesce(user_profile.cognome, '')
  from consumed
  join public.utenti user_profile on user_profile.id = consumed.utente_id
  where user_profile.attivo is not false
    and nullif(btrim(coalesce(user_profile.email, '')), '') is not null;
end;
$$;

revoke all on function public.consume_progremes_sso_ticket(text)
  from public, anon, authenticated;
grant execute on function public.consume_progremes_sso_ticket(text)
  to service_role;

commit;
