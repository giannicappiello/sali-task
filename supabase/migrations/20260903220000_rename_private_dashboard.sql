begin;

update public.workspace_schermate
set nome = 'Dashboard PRIVATE',
    descrizione = 'Clienti, valore, ordini, pipeline e riordino PRIVATE.',
    ultima_sincronizzazione = now()
where codice = 'crm.conto_terzi.dashboard';

commit;
