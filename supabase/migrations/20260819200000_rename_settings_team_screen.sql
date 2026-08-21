begin;

update public.workspace_schermate
set nome = 'Utenti e accessi',
    descrizione = 'Utenti, accessi, moduli e relazioni organizzative.',
    ultima_sincronizzazione = now()
where codice = 'impostazioni.team';

commit;
