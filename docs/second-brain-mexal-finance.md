# Second Brain: collegamento economico-finanziario Mexal e memoria

Requisiti confermati dal titolare l'8 novembre 2026: lettura e memorizzazione dei dati aziendali autorizzati, scadenziari, cassa, margini, costi, magazzino, scarichi SL e bilancio. I requisiti sono stati effettivamente salvati nella memoria personale del richiedente mediante proposta MEMORY_SAVE e BRAIN_REVIEW; questo non significa che gli archivi finanziari siano già stati importati.

## Connessione e autorizzazioni

Si riusa `buildMexalClient`, lo stesso client e le stesse credenziali server già configurati per Workspace. Nessuna seconda connessione, nuova credenziale, modifica SQL, policy RLS o modifica a ruoli/permessi. I nuovi strumenti finanziari richiedono il profilo amministratore Workspace, dati interni abilitati, conferma live dell'admin tramite `workspace_user_is_admin` e scope `tutti`. Si usa il vincolo admin del servizio Mexal esistente; il catalogo AI contiene soltanto moduli aziendali, non il modulo tecnico `integrazioni`, che non deve essere inventato come grant aggiuntivo. Errori o ambiti più ristretti bloccano prima di contattare Mexal. Questi strumenti non estendono l'accesso degli altri utenti.

## Strumenti

| Strumento | Comportamento |
|---|---|
| MEXAL_FINANCE_CATALOG | Legge `/help` con la connessione esistente e restituisce le risorse GET economico-finanziarie effettivamente pubblicate dall'installazione. Identificativi derivati dal metodo/percorso del contratto. Non esegue servizi contabili. |
| MEXAL_FINANCE_READ | Rilegge il catalogo, controlla capacità e percorso e invia solo GET. Ammessi esclusivamente percorsi corrispondenti alla risorsa finanziaria pubblicata; niente URL esterni, traversal, query inserita nel percorso o metodi di scrittura. Restituisce risposta e cursori ufficiali senza trasformare gli importi. |
| MEXAL_ARCHIVE_READ | Archivio Workspace paginabile di fatture vendita sincronizzate, righe per ID fattura e storico magazzino. JWT personale/RLS; proiezioni fisse, niente select generico o client privilegiato. Nessun limite di campione: seguire `nextOffset` fino a null. Limite tecnico offset 1.000.000 dichiarato dallo schema. |
| BRAIN_SOURCE_MEMORY_PREVIEW | Legge una pagina da una fonte supportata/autorizzata, prepara copie storiche personali con fonte, parametri, data, hash e chiavi deduplicate. Non crea proposte e non salva memoria. |
| BRAIN_SOURCE_MEMORY_PROPOSE | Rilegge la stessa fonte e confronta lo snapshot. Se cambia, restituisce conflitto; se coincide crea proposte MEMORY_SAVE. Non conferma né esegue salvataggi. Ogni ID richiede BRAIN_REVIEW e verifica di BRAIN_ACTION_STATUS dopo la conferma. |

Lo storico memorizzato non è il dato corrente: rileggerlo da Mexal quando serve un saldo aggiornato. Riacquisire lo stesso snapshot della stessa pagina riusa le chiavi memoria; versioni diverse restano copie storiche distinte. Le copie sono personali per evitare di condividere dati finanziari/HR con utenti non autorizzati alla fonte. Nessun import periodico o salvataggio automatico è stato attivato.

La memoria non è un backup completo del gestionale: il flusso acquisisce ogni pagina esplicitamente letta e approvata. Per un archivio completo occorre percorrere tutti i cursori ufficiali e confermare le relative proposte. Le pagine troppo grandi sono rifiutate con invito a ridurre il limite; non sono troncate silenziosamente. In caso di errore durante la preparazione, la risposta conserva gli ID già creati e non li ritenta automaticamente.

## Perimetro economico richiesto

- **Scadenziari**: clienti e fornitori, con tipo di archivio e cursori ufficiali. Il parametro `tipo` P/D/X è disponibile quando previsto dall'endpoint scadenzario dell'installazione. Non trattare scadenze aperte come movimenti bancari già avvenuti.
- **Flussi di cassa**: tenere distinti movimenti effettivi, saldi disponibili e previsioni da scadenziario. Nessuna ricostruzione autonoma della cassa dalle sole fatture.
- **Margini e costi**: leggere report/valori ufficiali o Consuntivi produzioni, conservando parzialità, basi e periodo. L'obiettivo STATION per lavorazione non è un costo industriale.
- **Magazzino**: conservare data, magazzino, unità, criterio di valorizzazione e fonte. Lo storico Workspace contiene anche copie `mexal_reconstructed` e costi ultimi; non presentarli come valorizzazione ufficiale di bilancio o LIFO/FIFO/medio.
- **Scarichi SL**: leggere il movimento/documento originale disponibile, con riferimento, anno, articoli e importi. Non sostituire i valori storici con prezzi correnti senza una qualificazione esplicita.
- **Bilancio**: saldi e dettagli conti, stato patrimoniale e conto economico devono provenire dal contratto o dall'export ufficiale pubblicato dall'installazione. Un catalogo privo di queste risorse non prova saldo zero: segnala un gap di integrazione. La memoria di tali report non ne cambia natura o stato di approvazione.

## Evidenze e limiti della verifica

Il codice locale non dispone delle variabili della connessione Mexal di produzione; sono riusate sul server dove sono già configurate. Non sono state estratte chiavi o credenziali per eseguire prove locali. Il catalogo finanziario effettivo dell'installazione deve quindi essere letto dopo il rilascio: i test con fixture dimostrano i controlli e il percorso, non la presenza live di bilancio, saldi o cassa. Sono gestite risposte JSON; export PDF/XBRL o report disponibili solo tramite servizi POST richiedono un adattatore specifico di sola lettura verificato, non esecuzione libera di programmi.

Validazione: 99 test Node superati su connettore, autorizzazioni, snapshot, parità consuntivi e nuove letture; lint mirato e build Vite/PWA riusciti. Nessun dato finanziario è stato importato durante i test. Lettura HR admin riuscita nella sessione corrente; non è attestazione di ogni autorizzazione Mexal.

Riferimenti primari: [Web API Mexal — manuale ufficiale](https://www.edupass.it/manuali/manualistica-passcom/manuale-prodotto?a=manuale-passweb-ecommerce%2Fconfigurazione%2Fmexal--configurazione-gestionale%2Fweb-api-mexal), [Novità WebAPI — endpoint scadenzario](https://www.edupass.it/StreamFile/Resources/materialevideocorsiriservati/novit-webapi.pdf). Il contratto operativo resta `/help` della specifica installazione, verificato a ogni chiamata.
