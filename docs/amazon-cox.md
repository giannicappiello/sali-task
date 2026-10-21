# Corrispettivi Amazon

La sincronizzazione completa Amazon, manuale o quotidiana, importa i dati e poi emette i nuovi COX. Gli ordini del sito mantengono il loro flusso.

- Solo stato Amazon `SHIPPED`; esclusi gli ordini parzialmente spediti.
- Prima data d'ordine autorizzata: 21 ottobre 2026, calendario Europe/Rome. La stessa data dell'ordine determina data e anno gestionale del documento.
- Sigla CO, modulo X, serie 1, cliente Mexal 501.02156 (Cliente AMAZON), causale 2, magazzino 4 sia in testata sia sulle righe.
- Associazioni SKU/articoli lette ogni volta da Workspace per connessione e marketplace. Solo articoli IT riconciliati.
- Nota `Ordine Amazon <numero>`. Prezzi lordi definitivi, già scontati, con aliquota articolo verificata. Calcolo preventivo Mexal prima del salvataggio; rilettura di data, cliente, magazzino, righe, totale e IVA dopo. Imponibile e imposta devono coincidere con i valori definitivi Amazon.
- Per articoli con lotto obbligatorio, richiesta di autoprelievo Mexal (`id_lotto=-2`), senza scegliere arbitrariamente un lotto.
- Importi mancanti, valute diverse da EUR e differenze fra totale righe e totale ordine bloccano l'emissione: nessuna ripartizione arbitraria di imposte, sconti o spedizione.

Il numero COX (anno, serie, numero) e l'eventuale motivo del blocco compaiono nell'elenco e nel dettaglio ordine Amazon. Le righe e il cursore provider sono indipendenti dal registro invii.

Il registro riservato al servizio ha una chiave univoca per numero ordine Amazon, anche tra connessioni. Il claim è atomico; un errore prima dell'emissione può essere riprovato alla prossima sincronizzazione dopo aver corretto i dati. Un timeout successivo al POST o un processo interrotto con claim aperto non consentono un altro POST automatico: riconciliare prima su Mexal. Anche documenti già presenti con il riferimento Amazon nelle note vengono verificati e collegati, senza crearne altri.

La fase COX prosegue a lotti limitati usando `amazon_cox_state`; la sincronizzazione passa a completata solo quando termina anche questa fase. `amazon_cox_from` è il limite di attivazione sulla connessione; la migrazione inizializza al 21 ottobre 2026 le connessioni Amazon esistenti. Le nuove connessioni richiedono una data esplicita lato servizio.

Test: `node --test server/crm/amazon-cox.test.js`. Per il test PostgreSQL locale impostare `PGLITE_MODULE` all'entry ESM di `@electric-sql/pglite` ed eseguire anche `server/crm/amazon-cox-db.test.js`.

Nota operativa: la cronologia remota presenta vecchie migrazioni mancanti. Per questo rilascio il proprietario ha autorizzato esplicitamente l’applicazione e la registrazione della sola migrazione COX; non eseguire le migrazioni pregresse non pertinenti con un push globale.
