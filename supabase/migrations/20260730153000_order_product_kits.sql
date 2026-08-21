create table if not exists public.ordini_impianti (
  id uuid primary key default gen_random_uuid(),
  codice text not null unique,
  descrizione text not null,
  modalita_prezzo text not null default 'sconto_ordine'
    check (modalita_prezzo in ('sconto_ordine','prezzo_fisso','sconto_personalizzato')),
  prezzo_fisso numeric(14,4),
  sconto_personalizzato numeric(7,3),
  attivo boolean not null default true,
  creato_da uuid references public.utenti(id) on delete set null,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  check (modalita_prezzo <> 'prezzo_fisso' or prezzo_fisso >= 0),
  check (modalita_prezzo <> 'sconto_personalizzato' or sconto_personalizzato between 0 and 100)
);

create table if not exists public.ordini_impianti_componenti (
  id uuid primary key default gen_random_uuid(),
  impianto_id uuid not null references public.ordini_impianti(id) on delete cascade,
  codice_articolo text not null references public.ordini_prodotti_cache(codice_articolo) on update cascade,
  quantita numeric(14,3) not null check (quantita > 0),
  posizione integer not null default 0,
  unique (impianto_id, codice_articolo)
);

create index if not exists idx_ordini_impianti_componenti_impianto
  on public.ordini_impianti_componenti(impianto_id, posizione);

alter table public.ordini_impianti enable row level security;
alter table public.ordini_impianti_componenti enable row level security;

create policy "authenticated read order kits"
  on public.ordini_impianti for select to authenticated using (true);
create policy "authenticated read order kit components"
  on public.ordini_impianti_componenti for select to authenticated using (true);

create policy "admins manage order kits"
  on public.ordini_impianti for all to authenticated
  using (exists (
    select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false
      and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))
  ))
  with check (exists (
    select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false
      and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))
  ));

create policy "admins manage order kit components"
  on public.ordini_impianti_componenti for all to authenticated
  using (exists (
    select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false
      and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))
  ))
  with check (exists (
    select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false
      and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))
  ));
