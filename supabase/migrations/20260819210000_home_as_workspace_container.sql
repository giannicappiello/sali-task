begin;

update public.workspace_moduli
set tipo = 'contenitore',
    descrizione = 'Contenitore principale dei moduli disponibili nel Workspace.',
    percorso = '/home',
    sempre_disponibile = true,
    mostra_menu = true,
    attivo = true,
    aggiornato_il = now()
where codice = 'home';

commit;
