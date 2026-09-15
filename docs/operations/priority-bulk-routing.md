# Revisione priorità: distinzione bulk

La pagina mostra separatamente i semilavorati interni (`productionDependencies`) e gli articoli da disimpegnare (`materials`). Il ruolo è deciso dal MES sulla distinta confermata, non dal codice articolo. Una carenza di bulk interno non deve essere proposta all'utente come trasferimento di materiale fisico.

L'IA usa la stessa risposta e rifiuta input che includano un semilavorato interno nei trasferimenti. Un `planningBlock` viene riportato integralmente prima della simulazione. Gli OP donatori esclusi conservano motivazione e controlli MES. Conferma esplicita, hash, rivalidazione e riallineamento Workspace rimangono invariati.

Richiesti `reservationReleaseVersion >= 2` e `bulkRoutingVersion >= 1`: aggiornare MES prima di attivare questa versione Workspace. Non sono richieste migrazioni Supabase. Il rilascio del codice non effettua alcun trasferimento né modifica quantità formula o piani esistenti.

Verificati: 8 test backend IA, build Vite/PWA, lint dei file UI/contratto modificati e controllo visivo del form reale su risposte simulate, senza chiamate al MES operativo. Nel caso interno FP112B è mostrato come dipendenza; nel caso magazzino rimane nell'elenco dei fabbisogni fisici.
