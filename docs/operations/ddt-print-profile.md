# Profilo stampa Magazzino e conferma personale

Il profilo richiesto e: DDT fronte/retro lato lungo; packing list fronte/retro
soltanto fra pagine dello stesso bancale; bianco e nero; vassoio 1.

L'installazione di questa versione non attiva il profilo. La migrazione
`20261103090000_ddt_print_options_review.sql` aggiunge campi con valore vuoto,
istantanee per i nuovi job e l'azione controllata, senza ristampare documenti.

## Attivazione

1. Aggiornare il modulo Printing di ProgreMES.APS. Il servizio deve esporre
   `warehousePrintOptionsVersion: 1` nell'inventario delle stampanti.
2. Verificare la destinazione MAGAZZINO nelle impostazioni stampanti MES e
   aggiornarne l'inventario in Configurazioni DDT Workspace.
3. Nel connettore Second Brain usare `DDT_PRINT_SETTINGS_READ`, quindi
   `DDT_PRINT_SETTINGS_UPDATE` con un motivo. Quest'ultimo prepara solo una
   proposta: il riepilogo contiene prima/dopo, stampante e versione letta.
4. Aprire `BRAIN_REVIEW` con `kind=controlled` e l'ID della proposta.
   La persona verifica e conferma personalmente. Non automatizzare la pagina.

Le impostazioni e l'esito persistito vengono aggiornati atomicamente solo dopo
la conferma. Un cambiamento concorrente della configurazione richiede una nuova
proposta. Sono richiesti amministratore Workspace e permesso integrations.configure
sulla schermata integrazioni.ddt, verificati nuovamente all'applicazione.

## Stampa e compatibilita

Le impostazioni sono copiate nel job quando nasce: cambi successivi non alterano
richieste in coda, retry o esiti incerti. I job precedenti mantengono il vecchio
protocollo. DDT e packing vengono indirizzati alla stampante associata a MAGAZZINO.

Ogni packing list per bancale e un PDF e un job separato; non viene usata la
packing list complessiva per la stampa duplex. Se ci sono piu copie di un PDF
con pagine dispari, il worker inserisce un retro vuoto fra le copie. Per il
DDT col profilo attivo si invia l'originale singola copia con conteggio copie
(predefinito 3), anziche concatenare tre PDF senza confine di foglio.

Il driver riceve opzioni private del job, non nuove preferenze Windows.
Il vassoio e risolto dal nome Tray 1 / Vassoio 1 nell'elenco del driver usando
il suo effettivo identificativo, che puo essere un ID proprietario Ricoh.
Vassoio assente/ambiguo o normalizzazione del driver incompatibile bloccano
la stampa prima di StartDoc. Non si ripiega sul vassoio automatico.
Oltre alla richiesta monocromatica al driver, PDFium rende in scala di grigi.

Completed/submitted significa accettato dallo spooler, non uscita carta verificata.
La prova fisica resta necessaria: DDT di 1 e 2 pagine con piu copie, packing
di due bancali con 1 e 3 pagine, sorgente carta 1 e fronte/retro lato lungo.

## Verifiche

Test JS/SQL: `node --test --test-isolation=none test/ddt-print-options.test.mjs`
con PGLITE_MODULE impostato al modulo PGlite. Suite di regressione:
`server/ai/controlled-actions.test.js`, `server/second-brain/handler.test.js`,
`test/preparation-dispatch.test.mjs`.

Sul MES eseguire build e test `WarehousePrintOptionsTests`, poi il collaudo
fisico sul server con il driver Ricoh. Il controllo locale in memoria verifica
DEVMODE, ID proprietario del vassoio, rifiuto di nomi ambigui e delle opzioni
scartate dal driver; non apre stampanti ne invia carta.

Riferimenti Windows ufficiali:
- https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-devmodew
- https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-devicecapabilitiesw
