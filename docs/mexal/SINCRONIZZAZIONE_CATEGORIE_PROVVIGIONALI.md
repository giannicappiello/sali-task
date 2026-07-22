# Sincronizzazione categorie provvigionali Mexal

## Perimetro e sicurezza

L'azione amministrativa **Sincronizza categorie provvigionali** usa esclusivamente GET verso Mexal:

- `/dati-generali/categorie-provvigioni` per le categorie clienti (`cod_cat_pr`);
- `/dati-generali/categorie-provvigioni-articoli` per le categorie articoli (`id_categoria_pr`).

Non invia POST, PUT, PATCH o DELETE a Mexal e non legge né usa `/dati-generali/provvigioni-listini`: il catalogo non dimostra che tale risorsa sia la matrice cliente × prodotto. Non vengono registrati payload completi, credenziali o header.

## Persistenza e idempotenza

La migration crea `mexal_categorie_provvigionali`, distinta da `mexal_regole_provvigioni`. Conserva `tipo`, `codice_mexal`, eventuale identificativo, descrizione, stato attivo quando presente, payload e timestamp. L'unicità è `(tipo, codice_mexal)`; l'upsert aggiorna la stessa riga, senza duplicati. I record assenti dalla risposta non vengono mai eliminati.

Le risposte collection sono riconosciute sia come array sia nei wrapper `dati`, `records`, `items`, `data`, `risultati`, `results` e `categorie`. Se Mexal restituisce un token `next` (o variante documentata) tutte le pagine vengono lette, con limite di sicurezza di 200 pagine.

## Limiti deliberati

Le anagrafiche possono migliorare descrizioni e diagnostica, ma non alterano il motore provvigionale, la regola locale verificata `2 + 3 = 7,5%`, né `mexal_regole_provvigioni`. Non modifica i flussi ordine o la logica EVADIBILE/SOSPESO.
