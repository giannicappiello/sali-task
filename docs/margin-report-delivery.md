# Agente marginalità lavorazioni Progre

Richiesta di Giovanni del 9 novembre 2026: PDF annuale aggiornato da gennaio all'ultimo mese concluso, ogni 10 del mese, ai soli `giovanni.cappiello@progre.it` e `roberto.profili@progre.it`. Primo invio appena operativo. Le modifiche richieste al documento riguardano esclusivamente il layout del template Progre.

## Esecuzione e autorizzazione

L’agente è disponibile in ChatGPT: https://chatgpt.com/agents/a/agt_6af20afad7408191be2f8c646346be0c . Il canale pubblicato è `agtch_6af20f47e00881919fec1d0bc76e630c`. La precedente automazione Codex `agente-marginalit-lavorazioni-progre` è sospesa per evitare doppie esecuzioni. Il servizio Workspace avvia l’agente il giorno 10 alle 10:00 Europe/Rome, con due finestre UTC che gestiscono ora solare e legale. Il generatore legge Mexal attraverso l’identità personale e non modifica contabilità/MES.

Su richiesta esplicita di Giovanni si riutilizza l’autorizzazione Workspace Agents del medesimo titolare già conservata cifrata per l’agente commerciale. Non si usa una chiave OpenAI Platform, non si creano acquisti o ricariche. Restano applicabili i limiti e le regole sui crediti del piano ChatGPT. Il canale API serve ad avviare l’agente ChatGPT, non a chiamare direttamente un modello a consumo separato. Nessun token passa al browser o al modello.

Il trasporto riutilizza il servizio Aruba/Workspace già operativo per Agente report commerciali. La delega commerciale e quella per singole email testuali non vengono estese o riutilizzate come permesso finanziario. I dati di esecuzione stanno in quattro tabelle dedicate `margin_report_plans`, `margin_report_runs`, `margin_report_chunks`, `margin_report_triggers`, con RLS abilitata e nessun accesso anon/authenticated. Il servizio filtra sempre il proprietario e verifica ruolo amministratore corrente e ambito tutti. Giovanni ha autorizzato separatamente in chat il canale API fisso, oltre al piano mensile gi� attivato umanamente in Workspace. Il collegamento di questo canale non riattiva il piano n� ripete il primo invio. Gli avvii sono associati agli hash di policy e agente. Un avvio per proprietario e periodo; gli esiti incerti restano da verificare senza ripetizioni automatiche. La presenza di un PDF per il mese impedisce una nuova elaborazione pianificata.

La schermata `https://workspace.progre.it/settings/margin-reports` mostra PDF, destinatari, frequenza, lacune e stato. Solo il titolare può attivare il piano mediante ricevuta di conferma associata a identità, policy e hash del PDF. Questa operazione non è esposta agli strumenti del modello e non deve essere automatizzata. L'attivazione accoda il primo invio e sveglia il servizio email; non significa consegna alla casella.

## Sicurezza e duplicazioni

Un lotto per proprietario e mese, con vincolo univoco. Il PDF verificato è immutabile. Claim atomico `FOR UPDATE SKIP LOCKED`, stato `uncertain` prima della restituzione al worker, nessun reinvio automatico in caso di esito incerto. Hash SHA256 controllato in caricamento e al prelievo allegato. Stato `sent` significa accettazione da parte del trasporto. Il primo PDF approvato è immediato; i successivi non sono prelevabili prima del 10 alle 10:00 di Roma. Il piano commerciale e i suoi destinatari rimangono separati.

## Metodo e layout

Mappatura e formule sono quelle approvate nella chat. Costo espositore IT0002 rettificato a 0,2172 nel solo report 2026 su autorizzazione; IT0555 resta da valorizzare perché la distinta deve essere compilata. I conti aggiuntivi e quelli non caratteristici non confermati restano dichiarati. Il PDF può essere inviato come provvisorio, senza trasformare costi mancanti in zero.

La revisione del layout riutilizza le quattro sezioni, geometrie, stili, numerazioni, temi, tabella e box nativi del master SHA256 `df5d359c7bbd169f5b9067f5cd50b4a0f78720cc811ff1f1f463b611764d1249`. Copertina senza grafici; indice aggiornato; prima pagina interna dispari; tutte le pagine renderizzate e verificate. Non cambiano gli importi.

Verifiche: test autorizzazione/receipt/policy/periodi/immutabilità/duplicazioni/esiti incerti; regressioni commerciali; build applicazione; verifica RLS e privilegi; piano e stato PDF letti live tramite accesso personale. Nessuna email di prova o approvazione automatica.
