begin;

alter table public.ai_utilizzo_mensile
  add column if not exists costo_usd numeric(14,8) not null default 0;

create table if not exists public.ai_generazioni (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references public.utenti(id) on delete cascade,
  conversazione_id uuid references public.ai_conversazioni(id) on delete set null,
  tipo text not null check (tipo in ('chat_interna','ricerca_web','analisi_ordini','piano_produzione','piano_ordini','piano_attivita')),
  modello text not null,
  stato text not null default 'in_corso' check (stato in ('in_corso','completata','errore')),
  token_input bigint not null default 0,
  token_output bigint not null default 0,
  costo_usd numeric(14,8) not null default 0,
  provider_request_id text,
  errore text,
  metadati jsonb not null default '{}'::jsonb,
  creata_il timestamptz not null default now(),
  completata_il timestamptz
);

create index if not exists ai_generazioni_utente_data_idx
  on public.ai_generazioni (utente_id, creata_il desc);
create index if not exists ai_generazioni_data_idx
  on public.ai_generazioni (creata_il desc);

alter table public.ai_generazioni enable row level security;

drop policy if exists "users read own AI generations" on public.ai_generazioni;
create policy "users read own AI generations"
on public.ai_generazioni for select to authenticated
using (utente_id = public.workspace_current_profile_id());

drop policy if exists "admins read all AI generations" on public.ai_generazioni;
create policy "admins read all AI generations"
on public.ai_generazioni for select to authenticated
using (public.workspace_user_is_admin());

drop policy if exists "admins read all AI usage" on public.ai_utilizzo_mensile;
create policy "admins read all AI usage"
on public.ai_utilizzo_mensile for select to authenticated
using (public.workspace_user_is_admin());

grant select on public.ai_generazioni to authenticated;

create or replace function public.workspace_record_ai_usage(
  p_utente_id uuid,
  p_token_input bigint,
  p_token_output bigint,
  p_costo_usd numeric
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_utilizzo_mensile (
    utente_id, mese, richieste, token_input, token_output, costo_usd, aggiornato_il
  )
  values (
    p_utente_id,
    date_trunc('month', now())::date,
    1,
    greatest(coalesce(p_token_input, 0), 0),
    greatest(coalesce(p_token_output, 0), 0),
    greatest(coalesce(p_costo_usd, 0), 0),
    now()
  )
  on conflict (utente_id, mese) do update set
    richieste = public.ai_utilizzo_mensile.richieste + 1,
    token_input = public.ai_utilizzo_mensile.token_input + excluded.token_input,
    token_output = public.ai_utilizzo_mensile.token_output + excluded.token_output,
    costo_usd = public.ai_utilizzo_mensile.costo_usd + excluded.costo_usd,
    aggiornato_il = now();
$$;

revoke all on function public.workspace_record_ai_usage(uuid, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.workspace_record_ai_usage(uuid, bigint, bigint, numeric) to service_role;

commit;
