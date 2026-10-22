# Schede prodotto Direct

## Uso

In Prodotti Direct, accanto al titolo del prodotto, **Compila Scheda** apre i sei testi. Lo stato Da compilare / Parziale / Completa indica quanti campi della scheda italiana sono valorizzati. I testi sono separati dagli import Mexal; ogni salvataggio italiano crea una revisione e conserva la versione precedente.

La selezione della lingua permette di tradurre automaticamente in ENG, FR, DE, ES e PT usando l’italiano salvato. La traduzione è una proposta da controllare: deve essere approvata esplicitamente e salvata prima di generare documenti. L’INCI/CTFA è copiato esattamente. Una modifica della revisione italiana rende obsolete le approvazioni delle traduzioni precedenti.

**Template scheda tecnica** gestisce i template condivisi. Si possono caricare sfondi JPEG, aggiungere o rimuovere campi, trascinare e ridimensionare le caselle, specificarne le coordinate percentuali, scegliere font/dimensione/colore e allineare il testo orizzontalmente e verticalmente. Selezione multipla: spunte o Maiusc + clic. Sono disponibili bordi e centri, distribuzione orizzontale/verticale e uniformazione delle dimensioni. Con una sola casella gli allineamenti si riferiscono alla pagina. Le frecce spostano le caselle; Maiusc + frecce aumenta il passo. L’anteprima blocca testi fuori casella, senza tagliarli o ridurre automaticamente i caratteri.

Il template è una pagina A4 verticale o orizzontale. La generazione la ripete una volta per lingua. Usare JPEG con grafica fissa (logo e decorazioni), senza titoli italiani incorporati quando il template è multilingue: le etichette dei campi vengono tradotte dal generatore. Foto, nome, codice, EAN, categoria e formato sono letti dall’anagrafica; i dati mancanti restano vuoti. Non vengono inventati valori o ingredienti.

**Genera scheda tecnica** permette di scegliere template, lingue approvate e formato:

- JPEG: `IT0001_IT.jpeg`, `IT0001_ENG.jpeg` (un file per lingua).
- PDF: `IT0001.pdf` (un unico file, una pagina per lingua nell’ordine mostrato).

Anteprima prepara file scaricabili senza scrivere sul NAS. **Genera e salva sul NAS** scrive i file e conferma il checksum letto dal gateway prima di dichiararli salvati. Se il NAS fallisce, i documenti generati restano scaricabili e compare l’errore. PDF e JPEG usano gli stessi rendering a 144 dpi: il PDF contiene immagini delle pagine, senza testo selezionabile. Limite NAS: 20 MiB per file.

## Autorizzazioni

- Prodotti Direct, lettura: consultazione e generazione/scaricamento locale.
- Prodotti Direct, scrittura: compilazione, traduzione, approvazione delle traduzioni e archiviazione sul NAS.
- Prodotti Direct, amministrazione: gestione dei template e pubblicazione dei testi sui canali.

Il controllo è applicato anche da RPC, RLS e API. Aggiornamenti con revisioni obsolete sono respinti. Le destinazioni esterne devono risultare accessibili tramite le RLS CRM e avere un mapping `matched` per il prodotto.

## Sito, Amazon e Club

Salvare una bozza non pubblica i testi. Il riquadro nella compilazione italiana consente agli amministratori di inviare la revisione salvata e completa:

- Club: snapshot italiano condiviso con la scheda pubblica. Restano valide le regole di visibilità, prezzi, offerte e materiali del catalogo Club.
- WooCommerce: ricerca per SKU esatto e aggiornamento dei soli `description` e `short_description`, con HTML escapato. Nessuna modifica a prezzi, stock, EAN o categorie.
- Amazon Seller SP-API: aggiornamento parziale del solo `product_description` del marketplace italiano, mantenendo gli attributi degli altri marketplace. `ACCEPTED` significa accettazione della richiesta, non pubblicazione già visibile. Marketplace in altre lingue non vengono aggiornati usando l’italiano.

Gli invii registrano revisione ed esito ed evitano richieste duplicate sulla stessa revisione. Le traduzioni per i documenti non avviano pubblicazioni commerciali automatiche.

Riferimenti dei contratti: [WooCommerce Products](https://developer.woocommerce.com/docs/apis/rest-api/v3/products), [Amazon patchListingsItem](https://developer-docs.amazon.com/sp-api/reference/patchlistingsitem).

## Attivazione

Questa modifica richiede applicazione delle due migrazioni dedicate, rilascio di Workspace e Club e aggiornamento del gateway documentale. Non eseguire migrazioni storiche non correlate come effetto collaterale.

1. Applicare tramite il canale amministrativo approvato **solo** `20261022160000_direct_product_sheets.sql` e `20261022161000_direct_sheet_languages_archive.sql`, dopo aver verificato lo schema corrente. Sono additive e non cambiano dati di prodotto, prezzi o assegnazioni dei permessi.
2. Distribuire il frontend/API Workspace e il frontend Club aggiornati.
3. Aggiornare sul computer NAS `hosting/document-gateway/server.mjs` insieme a `generated-sheets.mjs`, conservando la configurazione e il segreto esistenti. Il modulo usa solo librerie Node native.
4. Impostare nel servizio gateway `DOC_GATEWAY_ALLOW_SHEET_WRITES=1`. Il valore predefinito mantiene la sola lettura.
5. Il percorso relativo predefinito è `Schede Tecniche` sotto `DOC_GATEWAY_ROOT`. Se diverso, impostare **lo stesso** `DOCUMENT_SHEETS_FOLDER` su Vercel e sul gateway. L’account Windows del servizio deve poter scrivere in questa cartella, inclusa `.versions`.
6. L’origine autorizzata è `https://workspace.progre.it`; eventuali origini aggiuntive vanno elencate in `DOC_GATEWAY_SHEET_ORIGINS`, separate da virgola.
7. La traduzione usa l’autenticazione AI Gateway esistente. `DIRECT_SHEET_TRANSLATION_MODEL` è facoltativo; valore predefinito `openai/gpt-6-luna`. Non inserire credenziali nel codice, negli artefatti o nei log.

Il gateway accetta scritture esclusivamente sull’endpoint dedicato e su nomi validi. Ogni URL è firmato per metodo, nome, dimensione, checksum, revisione e data di generazione. Non sono consentiti traversal, redirect verso cartelle, origini estranee o sostituzioni con generazioni obsolete. Il file viene scritto temporaneamente e rinominato; una copia della precedente versione è conservata nella sottocartella nascosta `.versions`. Non esiste un endpoint di cancellazione.

## Verifica isolata

`node --test test/direct-product-sheets.test.mjs` verifica logica, adapter con risposte simulate, traduzioni, gateway HTTP su NAS temporaneo e migrazioni su PostgreSQL WASM tramite le fixture PGlite esistenti.

`node test/direct-sheets.browser.mjs` esegue il flusso browser → RPC/SQL → template/allineamenti → traduzione approvata → PDF a due pagine → JPEG per lingua → caricamento firmato → conferma NAS, con browser e NAS locali temporanei. Supporta `PGLITE_MODULE`, `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_CHANNEL` e `DIRECT_SHEETS_BROWSER_OUTPUT` per i runtime di test. Nessuna chiamata AI reale o pubblicazione a provider esterni viene eseguita dai test.
