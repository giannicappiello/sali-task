begin;

-- Magazzino non è più globale: resta visibile agli amministratori e ai soli
-- utenti appartenenti a un reparto a cui il modulo è stato assegnato.
update public.workspace_moduli
set sempre_disponibile = false,
    assegnabile_reparto = true,
    livello_self_service = null,
    configurabile_ruolo = true,
    aggiornato_il = now()
where codice = 'magazzino';

commit;
