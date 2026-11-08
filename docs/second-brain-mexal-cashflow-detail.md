# MEXAL_CASHFLOW_DETAIL_READ

Estensione in sola lettura del prospetto MEXAL_CASHFLOW_READ. Supporta qualsiasi esercizio 2000–2100 disponibile in Mexal, l'intero esercizio o intervalli nello stesso anno; il periodo predefinito dell'anno corrente termina oggi Europe/Rome. Marzo 2026 è solo il caso di collaudo, senza vincoli nel codice.

## Architettura e autorizzazione

- `mexal-cashflow-core.js`: unico motore esistente estratto senza cambiare le regole: importi BigInt a sei decimali, gruppi data/progressivo, esclusione AP/BA/CH, totali per mese e conto. Un callback opzionale espone gli stessi gruppi al dettaglio.
- `mexal-cashflow.js`: unico percorso di esecuzione, connettore `buildMexalClient`, verifica `/help`, proiezioni esplicite e raccolta `collectCashflowSource` condivisa. Il dettaglio aggiunge descrizioni delle righe e testate `/prima-nota`; un errore testate non cambia i totali cash flow ma rende il dettaglio incompleto.
- `mexal-cashflow-detail.js`: proietta gruppi, contropartite e testate, qualifica le attribuzioni e verifica somme esatte contro il prospetto della stessa lettura. Non calcola un secondo cash flow.
- Esposizione automatica tramite il factory già incluso da `createBrainCatalog`; bridge Windows e MCP online usano il catalogo personale. BRAIN_DATA_COVERAGE e financialTools riconoscono lo strumento senza registry paralleli.

La lettura eredita `canReadFinance` e `requireFinanceAdmin`: dati interni abilitati, amministratore Workspace verificato nuovamente tramite RPC personale e ambito `tutti`. Revoca, scope propri/team e accesso non amministrativo restano bloccati. Nessuna nuova credenziale, migrazione, policy RLS o modifica dei ruoli. Le letture continuano a produrre il normale audit tecnico delle chiamate Second Brain; non creano scritture operative, proposte o importazioni di dati aziendali.

## Input

`year` e `accountCodes` sono obbligatori. I conti si scelgono dal piano corrente usando il prospetto esistente. `from` e `to` sono date ISO opzionali nello stesso esercizio. `liquidAccountCodes` indica ulteriori conti liquidi esplicitamente verificati per identificare giroconti al di fuori dei conti selezionati: non cambia i totali selezionati. Un codice non presente nel piano corrente è rifiutato.

`limit` 1–50 (default 20), `offset` (default 0), `snapshot` e `topLimit` 1–30 (default 10) regolano pagina e classifica. Per offset successivi a zero serve lo snapshot della prima pagina; variazioni delle fonti o dei filtri producono 409. `expectedNetMovement` è una stringa decimale firmata facoltativa per confrontare un riferimento esterno, senza correggere o forzare il totale.

## Output e limiti

I totali, i mesi e gli aggregati riguardano l'intero archivio letto nel perimetro richiesto. `movements` è solo una pagina; seguire `pagination.nextOffset` fino a null mantenendo snapshot e filtri. `largestOutflows` è una classifica limitata, ordinata per uscita netta per registrazione. I totali e gli aggregati ripetuti fra pagine non vanno sommati.

Ogni movimento riporta identità originale, righe selezionate, contropartite, descrizioni originali e controllo di quadratura della registrazione. Le testate devono essere univoche; nomi dei conti ambigui o assenti restano null. Fino a 200 righe selezionate e 200 contropartite per registrazione vengono restituite, con conteggi totali e troncamento esplicito; ciò non tronca il calcolo. Risposte oltre 2 MB sono rifiutate esplicitamente con HTTP 413 e invito a ridurre limit/topLimit, senza troncamento silenzioso delle descrizioni. Il dettaglio completo richiede fonti esaurite, righe valide, testate univoche, registrazioni bilanciate e assenza di troncamenti.

Un giroconto è attestato solo quando l'intera registrazione bilanciata contiene esclusivamente conti liquidi dichiarati esplicitamente. Le compensazioni fra conti selezionati sono già nel motore esistente. I trasferimenti fuori dal perimetro selezionato restano in entrate/uscite di quel perimetro.

Le categorie sono **conti contropartita originali**, attribuiti soltanto se univoci, descritti dal piano corrente, in una registrazione bilanciata e senza segni o causali ambigui. Non sono categorie economiche dedotte. Le altre uscite sono esplicitamente non attribuite, con copertura separata per giroconti. Il contratto corrente non prova un collegamento al beneficiario del pagamento: beneficiario null, aggregati vuoti e copertura non attribuita esplicita. Non si interpretano testi liberi come prove di identità.

AP, BA e CH compaiono separatamente con righe, registrazioni e importi selezionati, senza concorrere ai totali. `reconciliation.exact` certifica la parità analitica sulla stessa lettura; `sourceComplete` distingue una lettura parziale. Non è riconciliazione bancaria: `bankReconciled=false`, saldi iniziali/finali null, denominazione valuta non attestata. Le letture paginabili non sono transazionali.

## Rilascio

Il codice candidato e la skill possono essere revisionati senza deployment. Dopo autorizzazione, usare il processo di rilascio esistente con controllo del diff e delle eventuali migrazioni pendenti: questa modifica non richiede migrazioni e non autorizza l'esecuzione di migrazioni estranee. Il comando generale `deploy:production` include un push database e non va eseguito indiscriminatamente per questa modifica.

Dopo il rilascio verificare con identità personale BRAIN_STATUS, tools/list, BRAIN_DATA_COVERAGE e una chiamata effettiva al dettaglio; per profili non autorizzati verificare l'assenza o il diniego senza impersonare altri utenti. La skill Progre AI è predisposta per usare il nuovo strumento: la pubblicazione del pacchetto condiviso e l'aggiornamento delle azioni vanno distinti dal salvataggio del codice.
