# Sincronizzazione prodotti Mexal

## Causa corretta

La vecchia API `sync-products` eseguiva, al primo lotto, un aggiornamento globale che impostava `attivo`, `attivo_mexal` e `mostra_in_app` a `false`. Se un lotto successivo, Mexal o la rete fallivano, gli articoli non ancora rielaborati sparivano dalle query frontend. Il contatore **Prodotti visibili** era quindi correttamente zero rispetto a dati resi preventivamente invisibili, non un valore fisso.

## Flusso incrementale

1. L'area Integrazioni (solo amministratori) avvia una run `mexal_sync_runs`.
2. Mexal restituisce l'elenco paginato; sono ammessi i codici `IT*`, `MKT*` e `IMP*`.
3. Ogni articolo completo viene cercato con la chiave stabile `prodotti.codice_mexal`, poi aggiornato oppure inserito. Non viene mai cancellato né nascosto un record preesistente.
4. I lotti vengono salvati progressivamente. La run registra elaborati, inseriti, aggiornati, scartati, errori e stato `running`, `completed`, `completed_with_errors` o `failed`.
5. Il cron usa gli stessi lotti in sequenza. Non esiste più il parametro con effetto di sostituzione del catalogo.

L'assenza di un articolo da un lotto o da una sincronizzazione incompleta non produce disattivazione automatica. La riconciliazione di articoli definitivamente rimossi da Mexal resta una procedura separata e controllata.

## Garanzie e limiti

- Un'interruzione dopo 100 articoli conserva tutti i record già presenti e visibili; al massimo aggiorna/inserisce i 100 ricevuti.
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
