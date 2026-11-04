# Correzione archivio PDF BC1

Installare esclusivamente `20261104130000_archived_ddt_bc1_review.sql` dopo le
migrazioni DDT gia presenti. L'installazione registra l'azione e la funzione;
non modifica PDF, bolle, invii o stampe.

Second Brain espone `DDT_ARCHIVED_PDFS_READ` agli amministratori abilitati.
`DDT_ARCHIVED_PDF_REFRESH` prepara una proposta con UUID, riferimenti e hash
delle due versioni correnti, motivo e modulo BC1. La persona deve aprire
`BRAIN_REVIEW` e confermare manualmente in Workspace.

L'esecuzione rilegge la bolla Mexal esistente, ne verifica origine, righe e
lotti, recupera il PDF BC1 con prezzi e costruisce tre copie complete. Ogni
coppia BCF/BCF_PRINT viene aggiunta atomicamente come nuova revisione,
insieme al progresso persistito e all'evento di correzione. Tutte le versioni
precedenti restano disponibili. Non vengono emessi movimenti, inviate email
o richieste stampe fisiche. Packing list e precedenti esiti restano conservati.

La funzione ricontrolla conferma, identita, permessi, riferimenti e hash;
blocca invii o stampe pendenti/incerti. Dopo timeout leggere
`BRAIN_ACTION_STATUS` e l'inventario prima di proporre altre operazioni.
Un errore puo lasciare un insieme parzialmente aggiornato: il risultato
`updated` identifica le coppie gia persistite. La lettura successiva propone
solo i documenti ancora da correggere.

Verifica: `test/ddt-archive-refresh.test.mjs` usa PostgreSQL/PGlite per
conferma, immutabilita, concorrenza, permessi e blocchi email, e un PDF reale
di due pagine per verificare le tre copie complete. Non chiama servizi reali.
