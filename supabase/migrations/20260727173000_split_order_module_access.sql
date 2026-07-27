begin;

-- Mantiene gli accessi esistenti, ma da questo momento PR e PH sono configurabili
-- indipendentemente tramite due righe distinte per utente.
insert into public.integrazioni_utenti (
  utente_id,
  modulo,
  enabled,
  ruolo_ordini,
  codice_agente_mexal,
  agenti_gestiti,
  updated_at
)
select
  utente_id,
  target.modulo,
  enabled,
  ruolo_ordini,
  codice_agente_mexal,
  agenti_gestiti,
  now()
from public.integrazioni_utenti legacy
cross join (values ('gestione_ordini_pr'), ('gestione_ordini_ph')) as target(modulo)
where legacy.modulo = 'gestione_ordini'
on conflict (utente_id, modulo) do nothing;

drop policy if exists "mexal event automations read orders users"
on public.mexal_event_automations
;

create policy "mexal event automations read orders users"
on public.mexal_event_automations
for select to authenticated
using (
  exists (
    select 1
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
      and (
        coalesce(r.livello, 0) >= 80
        or lower(coalesce(r.nome, '')) in
          ('admin', 'administrator', 'amministratore', 'super admin', 'direzione')
      )
  )
  or exists (
    select 1
    from public.utenti u
    join public.integrazioni_utenti i on i.utente_id = u.id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
      and i.modulo in ('gestione_ordini_pr', 'gestione_ordini_ph')
      and i.enabled = true
  )
);

commit;
