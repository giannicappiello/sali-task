begin;

-- Un UPSERT specifica le colonne dell'UPDATE anche quando il loro valore non
-- cambia. Il precedente trigger ricalcolava quindi tutti i clienti CRM per
-- ciascun agente ad ogni sincronizzazione, fino al timeout PostgreSQL.
drop trigger if exists crm_refresh_customers_after_agent_change on public.mexal_agenti;

create trigger crm_refresh_customers_after_agent_change
after update of codice, nome, cognome, attivo_mexal on public.mexal_agenti
for each row
when (
  old.codice is distinct from new.codice
  or old.nome is distinct from new.nome
  or old.cognome is distinct from new.cognome
  or old.attivo_mexal is distinct from new.attivo_mexal
)
execute function public.crm_refresh_customers_after_agent_change();

comment on trigger crm_refresh_customers_after_agent_change on public.mexal_agenti is
  'Aggiorna i responsabili CRM soltanto quando i dati agente rilevanti cambiano realmente.';

commit;
