begin;

-- Il catalogo MES è letto automaticamente dal Workspace. Il codice stabile
-- conserva le assegnazioni anche quando nome, percorso o stato cambiano.
update public.progremes_sync_config
set sincronizzazione_automatica = true,
    prossima_esecuzione = now(),
    aggiornato_il = now()
where id = 1;

-- Documenti era storicamente pubblicato con il codice Formule. Creiamo il
-- codice corretto e copiamo le assegnazioni esistenti senza rimuovere quelle
-- del modulo Formule, che ora torna alla propria route applicativa.
insert into public.progremes_moduli
  (codice, nome, descrizione, percorso, attivo, ordine, ultima_sincronizzazione)
values
  ('Documenti', 'Documenti', 'Archivio documentale ProgreMES', '/documenti', true, 90, now())
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  percorso = excluded.percorso,
  attivo = excluded.attivo,
  ordine = excluded.ordine,
  ultima_sincronizzazione = excluded.ultima_sincronizzazione;

insert into public.progremes_reparti_moduli (reparto_id, modulo_codice)
select reparto_id, 'Documenti'
from public.progremes_reparti_moduli
where modulo_codice = 'Formule'
on conflict (reparto_id, modulo_codice) do nothing;

commit;
