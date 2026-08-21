begin;

update public.workspace_moduli
set
  percorso = '/moduli/impostazioni_utenti_permessi',
  tipo = 'contenitore',
  descrizione = coalesce(
    nullif(descrizione, ''),
    'Gestione centralizzata di utenti, profili, reparti e verifica delle autorizzazioni.'
  ),
  attivo = true,
  mostra_menu = true
where codice = 'impostazioni_utenti_permessi';

insert into public.workspace_moduli_schermate
  (modulo_codice, schermata_codice, ordine, predefinita, visibile_menu)
values
  ('impostazioni_utenti_permessi', 'impostazioni.utenti_accessi', 10, false, true),
  ('impostazioni_utenti_permessi', 'impostazioni.regole_accesso', 20, false, true),
  ('impostazioni_utenti_permessi', 'impostazioni.verifica_accessi', 30, false, true)
on conflict (modulo_codice, schermata_codice) do update set
  ordine = excluded.ordine,
  predefinita = excluded.predefinita,
  visibile_menu = excluded.visibile_menu;

commit;
