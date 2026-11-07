# Chiusure, avvii forzati e riaperture

## Matrice richiesta, non configurazione accertata

| Operazione | Regola |
|---|---|
| Chiusura ordinaria | Anche operatore produzione, senza approvazione della Direzione, quando autorizzato nel backend e tutti i prerequisiti sono soddisfatti. Dal connettore restano proposta e conferma umana Workspace. |
| Chiusura forzata | Anomalia e motivazione obbligatorie; autorizzatore con permesso specifico **Autorizza chiusura forzata**, verificato nel sistema. Ruolo generale o livello AI non bastano. |
| Avvio forzato di lavorazione bloccata | MES_PRODUCTION_FORCE_START, soltanto per l’eccezione carenze materiali già prevista dal MES in miscelazione. Richiede `progremes.production.force_start`; stampa e tutti gli altri controlli restano obbligatori. |
| Riapertura di lavorazione conclusa | MES_PRODUCTION_REOPEN dopo MES_PRODUCTION_REOPEN_PREVIEW, con `progremes.production.reopen`. Riapre in Sospeso soltanto una conclusione non contabilizzata e senza dipendenze bloccanti; non annulla SL/CL. |

Nessuna abilitazione viene assegnata dalla Skill. Se manca prova del permesso o del controllo backend, ferma la proposta di forzatura e segnala il gap; non sondare il diritto creando una proposta reale.

## Chiusura ordinaria

Identifica ordine esatto, lavorazione e fase con MES_PRODUCTION_LOOKUP e letture correnti. Se ci sono più candidati chiedi quale. Verifica pesate, quantità/scarti, registrazioni richieste, SL/CL, qualità, rilascio e vincoli del servizio. Nessuno strumento ordinario dedicato è esposto nello snapshot: indirizza all'interfaccia ufficiale MES/Workspace senza inventare URL e segnala che l'abilitazione operatori resta da verificare. Se in futuro compare un servizio ordinario, verifica il suo contratto e applica il flusso proposte/review. Non passare a chiusura forzata automaticamente.

## Chiusura forzata

1. Leggi lavorazione attuale; mostra ordine, ID produzione/OP, articolo, fase, lotto e impianto se disponibili, stato, quantità, pesate, qualità/rilascio e blocchi.
2. Registra tipo di anomalia, descrizione precisa e motivazione distinta. Categorie esemplificative: meccanica, elettrica, dosaggio/peso, materiale, qualità, software, altro. Non inventare cause o quantità.
3. Verifica che la specifica anomalia sia gestibile dal servizio senza bypass. Richiedi prova attuale di SL e CL registrati: un semplice flag o una dichiarazione non dimostra verifica Mexal. Se il connettore non rende verificabile la registrazione ufficiale, segnala e ferma. Qualità e vincoli backend rimangono obbligatori.
4. Verifica il permesso specifico dell'autorizzatore tramite MES_PRODUCTION_PERMISSIONS: `progremes.production.force_close` corrisponde ad **Autorizza chiusura forzata**. Leggi MES_PRODUCTION_FORCE_CLOSE_PREVIEW e richiedi mexalVerified=true per la produzione esatta. Se strumenti, permesso o verifica non sono disponibili, ferma la proposta. Non attribuire l'autorizzazione a chi ha soltanto fatto la richiesta.
5. Solo con richiesta operativa autorizzata e prerequisiti soddisfatti prepara MES_PRODUCTION_FORCE_CLOSE usando i valori reali appena letti. Esponi conseguenze e anomalie; poi BRAIN_REVIEW con ID/kind effettivamente restituiti e conferma umana separata in Workspace.
6. Leggi esito persistito e rilegge stato lavorazione. Non dichiarare eseguita finché manca prova coerente. Verifica che l'audit registri richiedente, autorizzatore, tempi, bersaglio, tipo/descrizione anomalia, motivo ed esito; segnala eventuali campi non verificabili.

### Contratto osservato di MES_PRODUCTION_FORCE_CLOSE

Campi: articleCode, expectedProducedQuantity, expectedScrapQuantity, expectedStart, expectedStatus (InProduzione oppure Sospeso), orderNumber, phase (Semilavorato, Confezionamento oppure Astucciatura), productionId, productionOrderId, reason, slAndClAlreadyRegistered (letterale true), targetId.

Il nuovo contratto aggiunge anomalyType e anomalyDescription, distinti da reason. Tipi ammessi: meccanica, elettrica, dosaggio_peso, materiale, qualita, software, altro. Descrizione e motivo: 5–1000 caratteri. Usa lo schema corrente effettivo; non impostare slAndClAlreadyRegistered=true se manca la verifica Mexal. Ripeti lettura e proposta se dati di concorrenza sono cambiati; nessuna correzione automatica dei valori attesi.

## Avvio e ripresa chiusura esistenti

- Avvio ordinario: MES_PLAN_BATCHES → MES_PRODUCTION_START_PREVIEW → eventuale proposta MES_PRODUCTION_START → BRAIN_REVIEW → lettura MES_PRODUCTION_START_STATUS. Stampa confermata prima dell'avvio; accodato non significa avviato. Non ripetere stampa/avvio dopo timeout senza leggere lo stato.
- Ripresa chiusura già iniziata: MES_PRODUCTION_CLOSURE_STATE prima di MES_PRODUCTION_RESUME_CLOSE; conserva consuntivo congelato, pesate, quantità e documenti riusciti. Non forza qualità né presume SL/CL manuali. Review e verifica finale obbligatorie.

## Percorso delle aperture forzate implementate

Verifica prima MES_PRODUCTION_PERMISSIONS nella sessione dell'utente. I nuovi permessi non vengono assegnati automaticamente nemmeno agli amministratori. La disponibilità richiede la versione Workspace e, per riapertura e verifica SL/CL, l'aggiornamento MES corrispondente. Se il servizio manca o restituisce 404, segnala aggiornamento necessario senza percorsi alternativi.

Avvio: leggi MES_PRODUCTION_START_PREVIEW usando ordine, kind=production e phaseId esatti. Mostra carenze e impatto, poi proponi MES_PRODUCTION_FORCE_START con targetId, kind, phaseId, expectedHash, anomalyType, anomalyDescription, reason. La deroga è solo quella per carenze già prevista dal MES: non promettere avvio di qualsiasi lavorazione bloccata. Prosegui con BRAIN_REVIEW e MES_PRODUCTION_START_STATUS. Non passare allowShortage=true al comando ordinario MES_PRODUCTION_START.

Riapertura: leggi MES_PRODUCTION_REOPEN_PREVIEW(targetId=ID lavorazione), mostra before, effect e blockers. Procedi solo con canReopen=true. Proponi MES_PRODUCTION_REOPEN con targetId, expectedHash, anomalyType, anomalyDescription e reason; poi BRAIN_REVIEW e lettura audit/stato. La lavorazione torna Sospeso, conservando quantità, qualità, presenze chiuse e storico; il precedente consuntivo resta nell'audit. La ripresa fisica segue la procedura ordinaria.

Documenti SL/CL, movimenti o giacenze prodotti, passaggi esterni incerti, impianto occupato, fasi successive avviate, scarico IBC, batch non riconciliato o ordine chiuso/annullato bloccano la riapertura. Questi casi richiedono rettifica ufficiale separata e non sono implementati come cancellazione dei documenti.

### Requisiti per future estensioni

Per estendere le aperture oltre i casi già implementati, mantenere:

- Servizi ufficiali distinti per avvio di lavorazione bloccata e riapertura di lavorazione conclusa, con lettura/anteprima senza scritture, stato atteso/hash e applicazione controllata.
- Permessi specifici verificati server-side per ciascuna azione, distinti da **Autorizza chiusura forzata**. Qualunque ruolo, anche admin, deve soddisfare il permesso richiesto.
- Tipo anomalia, motivazione, oggetto/fase, impatti e audit persistente; proposta e BRAIN_REVIEW con conferma umana separata di persona abilitata.
- Per avvio: diagnosi dei blocchi, disponibilità materiali/macchina, qualità, lotto, versione piano e stampa richiesta. I blocchi non derogabili restano tali.
- Per riapertura: verifica documenti SL/CL/Mexal, magazzino, lotti, qualità, fasi e ordini dipendenti, costi e consuntivi congelati. Nessuna cancellazione o riscrittura dello storico: eventuali rettifiche seguono servizi ufficiali e tracciati.
- Esiti idempotenti, controllo concorrenza, lettura stato dopo timeout e prova end-to-end autorizzata prima di dichiarare supporto.

In assenza di questi servizi produci il riepilogo dell'esigenza e dei blocchi per il manutentore, senza tentare operazioni equivalenti, accessi diretti o forzature dei parametri.
