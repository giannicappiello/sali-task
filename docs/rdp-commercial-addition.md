# Aggiunta righe a una RdP confermata

«Aggiorna RdP» include le nuove righe produttive attive degli OCT già presenti nella richiesta. Righe descrittive, cancellate e previsioni annullate restano escluse. Una riga collegata a un'altra RdP attiva blocca l'aggiunta.

Quando esistono già OP, MES deve supportare `AppendsCommercialLines` e la conferma `EXTENDED`. I vecchi OP conservano identità, quantità, scadenze, posizioni, lotti, impegni e documenti. Quantità o consegne modificate insieme all'aggiunta richiedono una revisione separata. Gli OP accorpati non vengono separati automaticamente.

Le nuove righe diventano previsioni della stessa RdP. La normale conferma del piano genera successivamente i loro OP. L'aggiunta non genera SL, CL, lotti o avvii. La risposta contiene gli OP conservati e le identità delle righe previsionali; entrambi gli insiemi devono coprire esattamente l'anteprima.

La migrazione `rdp_append_confirmed_commercial_lines` registra i nuovi collegamenti e uno snapshot append-only nella transazione della ricevuta MES. I collegamenti e gli snapshot precedenti restano conservati. Errori di rete riutilizzano la stessa conferma e la ricevuta persistita, senza ripianificare o duplicare la produzione.

Richiede anche l'aggiornamento del MES con `WorkspaceCommercialAddition.cs`. Su versioni precedenti Workspace segnala di aggiornare MES prima della conferma. Nessuna RdP viene modificata dalla sola installazione della migrazione o dalla pubblicazione.

Verifiche: test di aggiunta e recupero Workspace, integrazione MES con OP6495/PB0009 da 25.000 pezzi e PB0049 da 10.000, conservazione della posizione manuale, replay, rifiuto delle modifiche all'OP originale e test PostgreSQL locale della transazione. I vecchi test statici `workspacemes-rdp-workbench.test.mjs` hanno cinque fallimenti già presenti su main, dovuti anche al precedente spostamento delle route nel dispatcher server; non rappresentano regressioni di questa modifica.
