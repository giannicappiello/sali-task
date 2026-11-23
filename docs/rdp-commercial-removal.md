# Aggiornamento RdP con righe sostituite e sorgenti archiviate

L'aggiornamento distingue le sorgenti OCT eliminate con ricevuta MES completata dalle singole righe divenute inattive in un OCT ancora valido. Le prime mantengono le prove di archiviazione; le seconde richiedono una sostituzione attiva nello stesso OCT e una conferma MES che identifichi esattamente la riga ritirata.

Gli identificativi vengono congelati nell'anteprima e riletti prima della conferma. La registrazione Workspace accetta la rimozione dalla domanda attiva solo se la ricevuta MES corrisponde, la riga è ancora inattiva oppure la sorgente ha una prova di riconciliazione valida. I collegamenti originali non vengono eliminati. La nuova riga viene collegata una sola volta nella stessa transazione del mirror.

Richiede la versione MES con `removedWorkspaceLineIds` e `retiredCommercialLines`, oltre alla migrazione `20261123105751_rdp_reconcile_removed_commercial_lines.sql`. L'installazione della migrazione aggiorna la funzione di registrazione senza modificare dati commerciali o produzioni esistenti.

Verifiche: test Node su aggiunte, rimozioni, recupero delle risposte e riconciliazione OCT. Il controllo PostgreSQL riproducibile è `scripts/check-rdp-commercial-removal-db.mjs`, eseguibile con `@electric-sql/pglite` installato in un ambiente di test e, se esterno al repository, `PGLITE_MODULE` impostato all'URL del modulo. Non si collega al database aziendale. Verifica rollback per ricevuta incompleta e sorgente riattivata, conservazione dei collegamenti storici e ripetizione senza duplicati.
