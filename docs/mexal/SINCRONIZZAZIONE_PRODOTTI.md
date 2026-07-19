# Sincronizzazione prodotti Mexal

## Causa corretta

La vecchia API `sync-products` eseguiva, al primo lotto, un aggiornamento globale che impostava `attivo`, `attivo_mexal` e `mostra_in_app` a `false`. Se un lotto successivo, Mexal o la rete fallivano, gli articoli non ancora rielaborati sparivano dalle query frontend. Il contatore **Prodotti visibili** era quindi correttamente zero rispetto a dati resi preventivamente invisibili, non un valore fisso.

## Flusso incrementale

1. L'area Integrazioni (solo amministratori) avvia una run `mexal_sync_runs`.
2. Mexal restituisce l'elenco paginato; sono ammessi i codici `IT*`, `MKT*` e `IMP*`.
3. Ogni articolo completo che supera i filtri viene cercato con la chiave stabile `prodotti.codice_mexal`, poi aggiornato oppure inserito. L'aggiornamento marca il record attivo e salva `ultimo_sync_mexal`.
4. I lotti vengono salvati progressivamente. La run conserva il proprio `started_at` e registra elaborati, inseriti, aggiornati, scartati, errori e stato `running`, `completed`, `completed_with_errors` o `failed`.
5. Solo nell'ultimo lotto, senza errori e dopo la conferma che tutti i lotti della stessa run sono stati registrati, la riconciliazione disattiva i record Mexal `IT*`, `MKT*` e `IMP*` non aggiornati dalla data di avvio della run (o senza `ultimo_sync_mexal`). Il numero è esposto come `disattivati` e salvato nei metadata della run.
6. Un timeout, un'eccezione, errori di lotto o una run incompleta non attivano mai la riconciliazione: la visibilità precedente resta invariata.
7. Il cron usa gli stessi lotti in sequenza. Non esiste più il parametro con effetto di sostituzione del catalogo.

L'assenza di un articolo da un lotto o da una sincronizzazione incompleta non produce disattivazione automatica. In una run completa e senza errori, invece, i record non più ammessi (annullati, precancellati, fuori produzione o assenti da Mexal) restano senza timestamp della run e vengono disattivati nella riconciliazione finale controllata.

## Garanzie e limiti

- Un'interruzione dopo 100 articoli conserva tutti i record già presenti e visibili; al massimo aggiorna/inserisce i 100 ricevuti.
- Una run completa aggiorna solo gli articoli validi e disattiva alla fine quelli Mexal ammessi ma non aggiornati durante la run.
- Una seconda esecuzione aggiorna lo stesso `codice_mexal` e non crea duplicati nell'uso sequenziale dell'API.
- Il database baseline deve garantire l'unicità logica di `codice_mexal`; questa migrazione non crea un vincolo unico senza prima verificare eventuali duplicati esistenti.
- I filtri UI reali sono `attivo_mexal = true` e `mostra_in_app = true`; la sincronizzazione non li azzera più globalmente.

## Variabili ambiente

Le API Vercel richiedono `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MEXAL_BASE_URL`, `MEXAL_USERNAME`, `MEXAL_PASSWORD`, `MEXAL_AZIENDA`, `MEXAL_ANNO`, `MEXAL_MAGAZZINO`; il cron richiede anche `CRON_SECRET`. Le credenziali non devono essere registrate nei log.

## Verifica logica richiesta

| Scenario | Esito atteso dalla logica |
| --- | --- |
| A. 1.000 prodotti, primo lotto di 100 poi errore | Non esiste `DELETE` o update globale dei flag: i 1.000 record precedenti rimangono visibili; i soli 100 ricevuti possono essere aggiornati. |
| B. Codice articolo già presente | `findExistingProduct` aggiorna il record con lo stesso `codice_mexal`. |
| C. Nuovo codice articolo | Viene inserito un solo record. |
| D. Due esecuzioni uguali | La seconda esecuzione ritrova e aggiorna i codici, senza inserimenti duplicati nel flusso sequenziale. |
| E. Errore serie documenti | La risposta contiene `success: false`, un messaggio leggibile e dettagli non sensibili; nessuna serie viene disattivata preventivamente. |
