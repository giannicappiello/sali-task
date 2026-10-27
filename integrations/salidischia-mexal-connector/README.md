# Connettore Sali di Ischia → Mexal

Configurazione attivata il 21 ottobre 2026. Il task Windows `SaliDiIschia-Mexal-Connector` controlla ordini e catalogo ogni cinque minuti. **Primo OC reale creato e verificato: ordine sito 13730 → OC/1/17359**. Il cliente e la destinazione sono stati creati e riletti; imponibile, IVA, spedizione e totale corrispondono all'ordine.

## Comportamento

- Nuovi ordini WooCommerce successivi al 13729, creati dal 21 ottobre 2026, in stato processing/completed e con data di pagamento.
- Anagrafica con ragione sociale, nome/cognome, indirizzo completo, CAP, città, provincia, paese, telefono, email, partita IVA, codice fiscale, PEC e SDI disponibili sul sito. Destinazione separata dalla fatturazione.
- Nuovi clienti: listino iniziale 1, valuta EURO 1 verificata sulla tabella Mexal e pagamento iniziale corrispondente all'ordine. I valori abituali dei clienti già esistenti vengono preservati. Cliente e indirizzo includono la nazionalità Mexal I per Italia; altre nazionalità richiedono mappatura esplicita prima dell'invio. L'indirizzo riceve una chiave numerica libera, con riuso soltanto del riferimento ordine esatto e dati riletti identici.
- OC standard senza suffisso di modulo (`cod_modulo` vuoto), serie 1, magazzino 5, causale **2 - Vendita On Line**, righe **E**, prezzi già scontati e spedizione. Il modulo X identifica OCX / Ordine Cliente Stralcio e non va usato per questo flusso.
- Ricerca cliente tramite riferimento sito o identità fiscale e paese, anche con prefisso nazionale della partita IVA. Nessuna associazione basata sul solo nome/email; nessuna cancellazione dei dati non forniti dal sito.
- Calcolo preventivo dei totali in Mexal e rilettura dopo la scrittura. Prezzi delle righe, quantità e spedizione restano verificati esattamente. Dal 27 ottobre 2026, su richiesta del titolare, totali e IVA sono confrontati per euro e prima cifra decimale: 62,03 / 62,04 sono accettati; 62,09 / 62,10 sono rifiutati. Gli scostamenti nei centesimi sono conservati nel journal e mostrati nel CRM, senza correggere prezzi o aggiungere righe. Gli ordini precedenti senza differenze conservano lo stesso hash.
- Journal SQLite persistente contro i duplicati. Un esito incerto dopo una scrittura richiede riconciliazione; il POST non viene ripetuto automaticamente.
- Dopo la verifica dell'OC, il connettore salva il riferimento in `_sdi_mexal_oc_v1` sull'ordine WooCommerce e lo rilegge. Il CRM Workspace lo importa in `raw_summary.mexal_oc` per mostrarlo nell'elenco e nel dettaglio. `publishOrderReferences` abilita il passaggio. Un errore di pubblicazione viene ritentato nei cicli successivi senza ricreare l'OC. Per riconciliare gli invii già verificati: `node --env-file-if-exists=.env.local scripts/publish-order-references.mjs`.

Pagamenti attivi verificati: PayPal (`ppcp`/`paypal`) → Mexal **4**; carta (`ppcp_card`), Google Pay (`ppcp_googlepay`) e Apple Pay (`ppcp_applepay`) → Mexal **20 - Carta di credito**. Il servizio di calcolo ha confermato che entrambi i pagamenti mantengono i totali del sito. IVA verificata: aliquota WooCommerce 1 → Mexal **22**. Pagamenti/aliquote non mappati, ordini senza pagamento, rimborsi, supplementi e altre valute richiedono revisione e producono un esito attention-required.

## Passaggio dal vecchio collegamento

Snippet WordPress attivo: **53**, “Sali di Ischia - passaggio ordini al nuovo connettore Mexal”. Sorgente: `wordpress/order-cutover.php`.

La chiave storica 1 vede gli ordini fino al 13729. Per i prodotti già sincronizzati dal nuovo connettore, lo snippet protegge prezzi e stock dagli aggiornamenti della chiave storica. Descrizioni, immagini e clienti restano accessibili. La chiave CRM 2, la nuova chiave 3 e la normale interfaccia amministrativa mantengono l’accesso agli ordini. La vecchia chiave non è stata revocata. Prima di ogni esecuzione con scritture il worker verifica la separazione tramite l’endpoint autenticato `/wc-sdi/v1/connector-status`; se la regola viene disabilitata, gli invii si fermano.

## Catalogo Mexal → sito

Estensione attivata il 21 ottobre 2026. La chiave WooCommerce 3 è stata autorizzata e aggiornata a **Leggi/Scrivi**; `catalogEnabled` è attivo nella configurazione privata. Primo allineamento: 357 schede / 178 codici Mexal su 386 schede totali (incluse bozze e traduzioni). Il titolare ha poi autorizzato il collegamento delle 12 varianti Fondotinta Camouflage IT0483-1 … IT0488-1 agli stessi codici base IT0483 … IT0488 del Second Skin, condividendo prezzi e giacenze. Gli stessi alias vengono usati per gli articoli negli OC, conservando lo SKU originale nel piano locale. Stick labbra/Lip stick (12675/12678) sono esclusi perché non acquistabili, su indicazione del titolare. Gift card e bundle senza SKU mantengono la propria gestione. Le quattro bozze con codice/prezzo mancante restano invariate. Resoconto corrente: `output/catalog-last-run.json`; elenco esclusioni: `output/catalog-eccezioni.txt`.

Allineamento successivo agli abbinamenti completato e verificato: **369 schede**, comprese le 12 varianti Camouflage. Nessun articolo pubblicato abbinabile rimasto in attention-required. Verifica indipendente della coppia IT0487 / IT0487-1: prezzo 15,00 € e quantità vendibile 96 per entrambe al momento del controllo.

- **Listino 1**, importo copiato come prezzo al pubblico IVA inclusa, **senza aggiungere IVA**, su esplicita indicazione del titolare. WooCommerce è già configurato con prezzi comprensivi di imposte. Nessun ripiego su altri listini. Il prezzo promozionale specifico del prodotto viene svuotato per mantenere l'importo di listino; le regole generali del plugin sconti/carrello rimangono separate.
- Abbinamento esatto per SKU, anche sulle traduzioni; alias espliciti in `catalogSkuAliases` solo dopo conferma del titolare. Nessuna eliminazione automatica dei suffissi. Le varianti Camouflage conservano lo SKU WooCommerce e usano il codice Mexal base autorizzato per listino, giacenze e OC.
- Somma dei progressivi per lotto del **magazzino 5**: inventario + carico − scarico. Con meno di **10 pezzi fisici**, prodotto non disponibile; da 10 in su disponibile se ci sono pezzi liberi da impegni. La quantità vendibile esclude gli ordini clienti impegnati; ordini sospesi e arrivi futuri non aumentano lo stock vendibile. Nessun ordine arretrato consentito.
- La soglia viene applicata anche nella lettura della disponibilità WooCommerce, così una quantità positiva sotto 10 non rende il prodotto acquistabile. La normale disponibilità WooCommerce continua ad applicarsi, inclusi i pezzi già impegnati.
- Progressivi vuoti accettati solo con dettaglio articolo PZ e inventario/carico/scarico esplicitamente a zero. Errori API e prezzi mancanti lasciano il prodotto invariato e vengono segnalati.
- Backup iniziale per prodotto in `data/catalog-backups/`; rilettura GET indipendente dopo ogni PUT. L'anteprima e l'ultimo ciclo sono in `output/catalog-preview.json` e `output/catalog-last-run.json`.
- Nel ciclo periodico gli ordini vengono elaborati prima del catalogo. Un errore del singolo ordine viene segnalato senza impedire il controllo del catalogo. I blocchi globali di configurazione o di separazione dal vecchio connettore interrompono il ciclo.
- Il task parte ogni cinque minuti, con una sola esecuzione alla volta e limite di 15 minuti per consentire aggiornamenti consistenti. Se un ciclo dura oltre cinque minuti, quello successivo attende la successiva partenza utile. Il blocco di processo è condiviso anche dalle esecuzioni manuali.

```powershell
node --env-file=.env.local scripts/sync-catalog.mjs
node --env-file=.env.local scripts/sync-catalog.mjs --write
```

La seconda riga aggiorna il sito. Per sospendere solo il catalogo impostare `catalogEnabled` a `false`; per rimuovere anche l'effetto della soglia sui prodotti già marcati occorre ripristinare lo snippet e i dati dei prodotti dal backup, dopo aver fermato il worker. La disattivazione completa dello snippet rimuove anche la separazione degli ordini e richiede prima riconciliazione.

## Esecuzione

Richiede Node.js 24+. Il task usa l’utente Windows `gianni.cappiello`, senza password negli argomenti e senza privilegi SYSTEM. **Server acceso e sessione Windows autenticata sono necessari; RDP può essere disconnessa.** Dopo un logout/riavvio occorre il nuovo accesso Windows.

```powershell
npm test
npm run sync:preview
npm run sync:once
npm run fetch:order -- 13729
npm run preview:live -- 13729
Get-ScheduledTaskInfo -TaskName 'SaliDiIschia-Mexal-Connector'
```

- `sync:preview`: lettura, senza scritture in Mexal.
- `sync:once`: invio con tutti i controlli e la separazione sul sito verificati.
- `preview:live`: confronta un ordine scaricato con articoli, cliente e calcolo Mexal, senza creare documenti.
- Stato: `output/last-run.json`.
- Log del processo Windows: `output/connector-service.log`.
- Registro invii: `data/connector.sqlite`. Non cancellarlo per risolvere un errore: prima riconciliare il documento in Mexal.

## Verifiche completate

- Connessioni reali WooCommerce/Mexal e schemi clienti, destinazioni, articoli e OC.
- Causale 2, pagamento 4 e articoli reali dell’ordine 13729.
- Cliente fiscale Mexal identificato univocamente: 501.02388.
- Calcolo reale Mexal senza salvataggio: prodotti 116,23 €, spedizione 15,00 €, IVA 28,87 €, totale 160,10 €. Imponibili riga identici al sito; quattro decimali per il prezzo unitario.
- 58 test locali su trasformazione, API simulate, duplicati, timeout, persistenza, dati fiscali, destinazione, totali, pagamenti, worker, catalogo, alias, esclusioni, OC senza modulo X, blocco delle esecuzioni sovrapposte, sintassi PHP e certificato.
- Nessun OC retroattivo creato per l'ordine 13729 già spedito. L'ordine 13730, arrivato durante l'attivazione, ha esposto campi obbligatori aggiuntivi del gestionale: risolti con riconciliazione esplicita, senza cancellare il journal o creare OC duplicati. OC/1/17359 riletto e totale verificato a 2,67 €; controllo successivo `already-imported`. Prova: `output/ordine-13730-verificato.json`.
- Su richiesta del titolare OC/1/17359 è stato corretto dal modulo OCX (Stralcio) al modulo standard OC. Aggiornata la sola testata con `solo_testata=true`, conservando esplicitamente gli identificativi delle righe. Verificati invariati cliente, data, causale, magazzino, pagamento, destinazione, righe, quantità, prezzi, IVA e totale. Prova: `output/oc-17359-modulo-corretto.json`; copia precedente protetta in `.private/`.

## Configurazione e protezione

Impostazioni effettive: `.private/connector-config.json`. `config.example.json` contiene esempi. Non rigenerare la configurazione attiva: `configure-live.mjs` rifiuta una sovrascrittura senza opzione esplicita.

Credenziali: `.env.local`, escluso da Git, con ACL limitata al proprietario e a SYSTEM. Chiave WooCommerce 3 dedicata, con permessi Leggi/Scrivi autorizzati per la sincronizzazione dei prodotti. Il certificato autofirmato Mexal è autorizzato tramite l’impronta SHA-256 approvata dall’utente: il controllo avviene prima dell’invio delle credenziali ed è limitato al solo endpoint configurato. Un certificato diverso interrompe la connessione; la verifica TLS non è disabilitata globalmente.

`data/`, `output/` e `.private/` sono esclusi da Git e possono contenere dati anagrafici. I parametri storici sono stati recuperati da `C:/Progetti/WorkspaceRemoto/ManualiWorkspace_MES/Mexal_WebAPI_Dati_Accesso.pdf`, poi verificati direttamente sulle API.

## Arresto e ripristino

```powershell
Disable-ScheduledTask -TaskName 'SaliDiIschia-Mexal-Connector'
```

Prima di ripristinare l’accesso completo del vecchio programma, riconciliare gli ordini già inviati dal nuovo. Poi disabilitare lo snippet 53 in WordPress. Disabilitare lo snippet senza controllare gli invii precedenti potrebbe farli importare anche dal vecchio programma.

Reinstallazione sullo stesso server: `ops/Install-ConnectorTask.ps1 -Activate`, dopo verifica di configurazione, identità Windows e separazione sul sito. Per migrare il worker trasferire anche SQLite e mantenere una sola installazione attiva.
