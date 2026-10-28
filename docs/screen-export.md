# Esportazione schermate Progre

Il comando Esporta è installato accanto all’assistente nella barra comune e nelle finestre di dialogo di Workspace e MES. È disponibile anche senza il permesso assistente AI.

I report usano il modello dei report AI Progre: PDF A4 con copertina originale, Word DOCX con copertina e tabelle modificabili, Excel XLSX con logo, stili e impostazioni di stampa A4. Workspace riusa anche l’intestazione PDF configurata per i report AI, quando presente. Non vengono effettuate chiamate a un modello AI.

## Elenchi completi

Il raccoglitore segue esclusivamente i controlli Precedente/Successiva degli elenchi, dalla prima all’ultima pagina, conservando filtri e ordinamento. Gestisce più elenchi nella stessa schermata e non elimina righe con valori identici. Al termine ripristina la pagina iniziale, anche in caso di annullamento. Nessuna azione di riga o scrittura applicativa viene attivata.

Un errore o un timeout interrompe l’esportazione senza scaricare un file parziale. Le colonne Azioni/Operazioni, i controlli, la chat AI, le password e i campi segreti non fanno parte del documento. I valori correnti dei moduli sono inclusi.

Per nuovi componenti paginati usare controlli con etichette accessibili Precedente/Successiva, un contenitore con classe pagination oppure data-export-pagination, e collocare l’elenco immediatamente prima dei controlli (oppure usare una tabella nel contenitore). Una paginazione senza controlli riconoscibili, un elenco virtualizzato o dati non ancora caricati senza paginazione richiedono un adattatore dedicato: non sono ricostruibili dalla sola superficie DOM.

## Sorgenti e distribuzione

Sorgenti comuni: shared/screen-export. L’integrazione Workspace è src/components/ScreenExport.jsx. L’entry MES è scripts/screen-export/mes-entry.js.

Dopo modifiche ai sorgenti comuni eseguire node scripts/build-screen-export-mes.mjs <directory-output>, quindi copiare report-export.js nel repository MES, in wwwroot/report-export/. Il logo è copiato da public/progre-logo-white.png in wwwroot/images/report-progre-logo.png. Il bundle è locale e non carica librerie da CDN.

L’esportazione da Workspace di un MES incorporato viene delegata al frame autenticato del MES, con controllo dell’origine e del mittente. Occorre distribuire entrambi gli aggiornamenti. Il contenuto non viene trasferito tra le origini.

## Verifica

node --test test/screen-export.test.mjs

I test verificano due elenchi di cinque pagine, avvio da pagine intermedie, ripristino dopo annullamento, campi riservati, righe duplicate, tutti e tre i formati e l’impostazione A4.

## Totali delle tabelle

Le colonne numeriche espongono due righe di footer: Totale pagina e Totale generale, con i valori nella stessa colonna dei dati. Una tabella con totali esistenti non riceve altri footer. Codici, identificativi, date e numeri d’ordine non vengono sommati. Le quantità con UDM diverse rimangono separate. Il medesimo comportamento è applicato ai documenti esportati.

I dataset React comuni, i dettagli CRM e il magazzino registrano i dati completi con registerTableTotals. Il magazzino legge le pagine autorizzate dal servizio già esistente, mantenendo i filtri e il perimetro cliente. Per le altre tabelle paginated il raccoglitore effettua una lettura completa con indicatore di avanzamento e ripristina la pagina iniziale. Durante questa lettura il contenuto è temporaneamente bloccato per evitare modifiche di filtri e pagina. I risultati vengono riutilizzati finché i dati della pagina e i filtri coincidono; un errore viene mostrato come Non disponibile.
