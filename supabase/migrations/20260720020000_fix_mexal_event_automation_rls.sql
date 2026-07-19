-- Restrict event automation visibility to administrators or enabled Gestione Ordini users.
drop policy if exists "mexal event automations read authorized" on public.mexal_event_automations;
create policy "mexal event automations read orders users" on public.mexal_event_automations for select to authenticated using (
 exists (select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo is not false and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione')))
 or exists (select 1 from public.utenti u join public.integrazioni_utenti i on i.utente_id=u.id where u.auth_user_id=auth.uid() and u.attivo is not false and i.modulo='gestione_ordini' and i.enabled=true)
);
