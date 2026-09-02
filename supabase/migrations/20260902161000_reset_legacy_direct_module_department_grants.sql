begin;

-- Ribadisce il modello autorizzativo dei moduli DIRECT. La migration resta
-- idempotente e non assegna implicitamente i moduli ad alcun reparto.
update public.workspace_moduli
set sempre_disponibile = false,
    assegnabile_reparto = true,
    configurabile_ruolo = true,
    aggiornato_il = now()
where codice in ('documenti', 'prodotti');

-- I grant antecedenti alla conversione dei moduli DIRECT in moduli assegnabili
-- derivano dal vecchio backfill basato sui permessi di ruolo. Le assegnazioni
-- effettuate dalla nuova schermata dopo il rilascio vengono invece preservate.
delete from public.reparti_moduli
where modulo in ('documenti', 'prodotti')
  and creato_il < timestamptz '2026-09-02 15:00:00+00';

commit;
