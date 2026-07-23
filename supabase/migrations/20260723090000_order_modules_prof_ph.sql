-- Separates commercial order areas while preserving all existing PROF records.
alter table public.ordini_testate add column if not exists modulo_ordini text not null default 'prof' check (modulo_ordini in ('prof', 'ph'));
create index if not exists ordini_testate_modulo_mese_idx on public.ordini_testate(modulo_ordini, mese_ordine);

create table if not exists public.ordini_moduli_configurazione (
  modulo_ordini text primary key check (modulo_ordini in ('prof', 'ph')),
  invia_automaticamente_mexal boolean not null default false,
  serie_documento text,
  invia_email_agente boolean not null default false,
  invia_email_cliente boolean not null default false,
  invia_email_responsabile boolean not null default false,
  backoffice_1_email text,
  backoffice_2_email text,
  aggiornato_il timestamptz not null default now()
);
insert into public.ordini_moduli_configurazione (modulo_ordini, invia_automaticamente_mexal) values ('prof', true), ('ph', false) on conflict do nothing;
alter table public.ordini_moduli_configurazione enable row level security;
create policy "authenticated read order module config" on public.ordini_moduli_configurazione for select to authenticated using (true);
create policy "admins manage order module config" on public.ordini_moduli_configurazione for all to authenticated using (
  exists (select 1 from public.utenti u left join public.ruoli r on r.id = u.ruolo_id where u.auth_user_id = auth.uid() and u.attivo is not false and (coalesce(r.livello,0) >= 80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))
) with check (
  exists (select 1 from public.utenti u left join public.ruoli r on r.id = u.ruolo_id where u.auth_user_id = auth.uid() and u.attivo is not false and (coalesce(r.livello,0) >= 80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))
);
