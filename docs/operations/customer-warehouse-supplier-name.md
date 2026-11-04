# Magazzino clienti: corrispondenza ragione sociale fornitore

La migrazione `20261104100000_customer_warehouse_supplier_name.sql` aggiunge agli articoli già visibili da ordini e fatture quelli la cui associazione articolo–fornitore Mexal contiene una ragione sociale uguale a quella di uno dei clienti associati all'utente.

Il confronto è esatto dopo normalizzazione di maiuscole/minuscole e spazi (inclusi tab e spazi ripetuti). I codici conto cliente e fornitore sono indipendenti. Non sono ammesse corrispondenze parziali, nomi vuoti o ricerca approssimativa. Le associazioni duplicate confluiscono nell'insieme degli articoli autorizzati senza moltiplicare quantità.

La sorgente è `workspace_article_supplier_associations` con `source = 'MEXAL_ARTICLE_MASTER_V1'`, già alimentata dal menu Fornitori dell'anagrafica articoli Mexal attraverso la sincronizzazione esistente. Le vecchie associazioni da storico ordini e quelle manuali non estendono l'accesso. Prima del rilascio verificare copertura e aggiornamento di questa sorgente e delle ragioni sociali nella cache clienti. Questa modifica non avvia sincronizzazioni.

Restano applicati `mostra_in_app`, l'ambito dei clienti associati, data inventario, filtri, paginazione e la presentazione cliente senza costi né ubicazioni. Nessun dato dell'anagrafica fornitori viene aggiunto alla risposta della dashboard. La migrazione conserva la firma e i permessi della RPC esistente e aggiunge un indice parziale per il confronto dei nomi.

## Verifica isolata

Il test usa PostgreSQL embedded con tabelle minime e funzioni di sessione simulate. Non richiede credenziali e non contatta produzione. Esegue la RPC precedente e quella modificata, confrontando anche l'intera risposta interna prima/dopo. Copre 11 casi più il test contenitore.

In un ambiente di test con `@electric-sql/pglite@0.5.14` disponibile:

```sh
node --test --experimental-test-isolation=none supabase/tests/customer_warehouse_supplier_name.mjs
```

Se il pacchetto è installato in un runtime separato, impostare `PGLITE_MODULE` al file URL assoluto del suo `dist/index.js`. Il file `.mjs` non viene incluso automaticamente nelle suite `*.test.mjs` prive di questa dipendenza opzionale.

## Attivazione

La sola pubblicazione del frontend non applica questa modifica. Occorre applicare la nuova migrazione al database Workspace mediante il canale di rilascio autorizzato. Non applicare automaticamente altre migrazioni pendenti.

Dopo l'applicazione verificare con una sessione cliente reale: un articolo senza ordini/fatture ma associato a un fornitore omonimo deve comparire; un articolo di un altro cliente deve restare escluso. Confrontare i totali e verificare che i campi economici e le ubicazioni rimangano assenti. Il test isolato non certifica i dati o le prestazioni del database di produzione.
