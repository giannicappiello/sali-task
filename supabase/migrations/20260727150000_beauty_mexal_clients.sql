begin;

-- Dati Beauty Days aggiuntivi per l'anagrafica unica dei clienti Mexal.
-- I dati anagrafici restano in ordini_clienti_cache e non vengono duplicati.
create table if not exists public.beauty_clienti_mexal (
  codice_cliente text primary key
    references public.ordini_clienti_cache(codice_cliente)
    on update cascade
    on delete cascade,
  beauty_external_id uuid,
  legacy_farmacia_id uuid,
  note text,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

create index if not exists beauty_clienti_mexal_beauty_idx
  on public.beauty_clienti_mexal(beauty_external_id)
  where beauty_external_id is not null;

alter table public.beauty_clienti_mexal enable row level security;

drop policy if exists "workspace reads visible beauty clients"
  on public.beauty_clienti_mexal;
create policy "workspace reads visible beauty clients"
on public.beauty_clienti_mexal
for select to authenticated
using (
  exists (
    select 1
    from public.ordini_clienti_cache c
    where c.codice_cliente = beauty_clienti_mexal.codice_cliente
      and (
        c.codice_agente_mexal in (select public.visible_mexal_agent_codes())
        or exists (
          select 1 from public.utenti u
          left join public.ruoli r on r.id = u.ruolo_id
          where u.auth_user_id = auth.uid()
            and u.attivo is not false
            and (
              coalesce(r.livello, 0) >= 80
              or lower(coalesce(r.nome, '')) in
                 ('admin','administrator','amministratore','super admin','direzione')
            )
        )
      )
  )
);

drop policy if exists "admins manage beauty clients"
  on public.beauty_clienti_mexal;
create policy "admins manage beauty clients"
on public.beauty_clienti_mexal
for all to authenticated
using (
  exists (
    select 1 from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
      and (
        coalesce(r.livello, 0) >= 80
        or lower(coalesce(r.nome, '')) in
           ('admin','administrator','amministratore','super admin','direzione')
      )
  )
)
with check (
  exists (
    select 1 from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
      and (
        coalesce(r.livello, 0) >= 80
        or lower(coalesce(r.nome, '')) in
           ('admin','administrator','amministratore','super admin','direzione')
      )
  )
);

grant select, insert, update, delete on public.beauty_clienti_mexal to authenticated;

commit;
