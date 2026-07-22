# Diagnostica provvigioni listini Mexal

## Scopo e modalità read-only

La console amministrativa **Impostazioni → Diagnostica Mexal → Provvigioni listini** interroga esclusivamente `GET /dati-generali/provvigioni-listini`. Non invia POST, PUT, PATCH o DELETE a Mexal e non usa `POST /dati-generali/provvigioni-listini/ricerca`.

L'azione **Analizza provvigioni listini** restituisce soltanto una sintesi: tipo del payload, record rilevati, wrapper, nomi dei campi, metadati di paginazione, limiti di analisi e possibili corrispondenze nominali con i campi locali. La scansione ricorsiva di chiavi è limitata in profondità e numero di elementi; non deduce una mappatura o una regola dal solo nome di un campo.

L'azione **Scarica JSON provvigioni listini** restituisce invece la risposta Mexal completa e invariata con `Content-Type: application/json` e `Content-Disposition: attachment`, nel file `mexal-provvigioni-listini.json`. Il file è generato nella risposta HTTP per un amministratore autenticato, non è salvato nel repository, sul server o in Supabase.

## Paginazione e limiti

La diagnostica segnala i metadati `next`, `next_token`, `nextToken`, `continuation_token`, `pagina`, `page`, `totale`, `total` e `has_more` se presenti. Non inventa parametri né richieste successive: legge la prima risposta GET e dichiara la completezza soltanto se Mexal indica esplicitamente `has_more: false`. Il download conserva integralmente la risposta letta, anche quando la completezza non è garantita.

## Sicurezza e separazione dei dati

Il summary non contiene payload completi, credenziali, token, header, variabili ambiente o coordinate gestionali. La diagnostica non scrive in Supabase e non crea, aggiorna o elimina regole.

- Le **categorie provvigionali** sono anagrafiche cliente/articolo sincronizzate separatamente in `mexal_categorie_provvigionali`.
- Le **regole provvigionali** sono configurazioni locali in `mexal_regole_provvigioni` usate dal motore.
- Le **provvigioni listini** sono la risorsa Mexal qui letta a scopo esplorativo: la loro struttura e la loro semantica non vengono presunte.
