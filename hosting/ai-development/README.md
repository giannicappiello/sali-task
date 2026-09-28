# Assistente AI sul PC

La configurazione autorizzata usa esclusivamente questo PC per coordinatore e
compilazioni/test. La directory dedicata è C:\AssistenteAI; il disco Linux WSL2
si trova in C:\AssistenteAI\Linux. Il MES rimane sul server attuale.

## Separazione degli accessi

- Conversazioni, autorizzazioni e approvazioni rimangono in Workspace.
- WSL non monta automaticamente Windows e non esegue programmi Windows.
- Il processo fidato usa l'utente Linux aiworker, senza privilegi amministrativi.
- Il codice generato viene eseguito in container effimeri senza rete, credenziali,
  socket del runtime o montaggi del filesystem dell'host.
- CPU, memoria, processi, spazio temporaneo e durata devono essere limitati.
  Un errore del runtime interrompe il job; nessuna esecuzione diretta sul PC.
- La pubblicazione richiede verifiche riuscite e un commit contenente esattamente
  i file testati. Workspace deve risultare READY sull'alias di produzione.

## Stato

Prerequisiti installati: Ubuntu 24.04 su WSL2, Podman rootless, utente dedicato.
La presenza dei prerequisiti non certifica il collegamento operativo a Workspace.
Il servizio deve superare la verifica di isolamento ed essere associato mediante
un'identità dedicata prima di accettare lavori remoti.

Il PC deve essere acceso per elaborare lavori. Spegnimento e sospensione non devono
trasformare un lavoro interrotto in un successo né ripetere scritture su MES/Mexal.

## Configurazione e avvio

1. Preparare il runtime dedicato con `prepare-linux-host.sh` e copiare `sandbox.py`
   e `run_payload.py` in `/opt/assistenteai`, leggibile soltanto da root e aiworker.
2. Preparare separatamente le immagini con i Containerfile revisionati. Il normale
   worker non installa pacchetti e non consente rete ai test.
3. Il JSON di configurazione deve contenere `workspaceUrl` HTTPS, `nodeExecutable`,
   `distribution`, `outputDirectory` e `repositories.workspace` / `repositories.mes`.
   Ogni repository richiede `path`, `image` fissata per digest, `checks` (array di
   comandi), `dependencyManifest` (percorso -> SHA256 del contenuto Git).
   Per seguire main impostare `sourceRef=refs/remotes/origin/main` ed `expectedRemote`.
4. Eseguire `Install-Worker.ps1 -ConfigPath <file>`: copia il coordinatore nella
   cartella dedicata con ACL ristrette. Il JSON non deve contenere token.
5. Dopo il rilascio delle migrazioni/API, associare il PC dalle Impostazioni AI e
   inserire la credenziale in `Pair-Worker.ps1`. È salvata con DPAPI dell'utente
   Windows e trasmessa a Node tramite stdin, senza argomenti o file in chiaro.
6. La task Windows `Workspace AssistenteAI` parte all'accesso dello stesso utente.
   Verificare l'ultimo collegamento nelle Impostazioni AI. La revoca blocca nuovi
   lavori e rinnovi. Un lavoro con sessione scaduta passa a Interrotto.

## Esito di una richiesta

La richiesta esplicita di modifica dell’amministratore autorizza elaborazione e
test: il lavoro entra direttamente in coda, senza una seconda conferma nelle
Impostazioni AI. Una richiesta di sola analisi non deve avviare il lavoro.
Le vecchie proposte già salvate restano da confermare e non vengono avviate in massa.
Il worker fotografa una revisione Git,
verifica le dipendenze, richiede i file necessari e applica sostituzioni vincolate
al contenuto originale. Il modello non esegue comandi sul PC. Solo dopo test riusciti
viene creato un commit nel ramo `codex/ai-<id>` usando un indice Git separato:
nessun checkout o hook sul PC. Le nuove richieste degli admin pubblicano anche
`main`, salvo richiesta esplicita di non pubblicare (`publish=false`). Le vecchie
proposte non vengono pubblicate automaticamente. Il repository deve avere
`publishEnabled=true` e `expectedRemote` esatto. Per Workspace configurare
`deployment: { project: "sali-task", scope: "progre1", alias: "https://workspace.progre.it" }`.
Il processo fidato usa l'accesso Git e Vercel già configurato dell'utente Windows;
nessuna credenziale entra nel contenitore o nei prompt del modello.

Il push è un avanzamento normale di main, mai forzato. Una main modificata da altri
dopo i test richiede nuova elaborazione e test: non si sovrascrive. Prima del push
si salva un checkpoint; dopo un'interruzione si riconcilia lo stesso commit.
Per Workspace si verifica il commit del deployment e l'alias attivo, per MES si
pubblicano solo i sorgenti e si notifica di aggiornare il server. L'esito viene
salvato nella chat originale e nelle Impostazioni AI. Il PC deve rimanere acceso.

`worker.integration.test.mjs` con `AI_VERIFY_WSL=1` verifica davvero entrambi gli
esiti nel container, usando API simulata e repository temporaneo. Non costituisce
una verifica del modello remoto o della connessione alla produzione.

## Copertura dei test MES

`check-mes-linux.sh` esegue la compilazione e la suite compatibile con il
contenitore. Elenca esplicitamente i controlli che richiedono Windows, font PDF
o configurazioni escluse dal trasferimento. Prima del rilascio MES eseguire anche
la suite completa Windows sui sorgenti revisionati. Il worker non esegue mai
il codice generato sul sistema Windows. La pubblicazione MES non installa il
software né applica migrazioni sul server: questo resta parte dell'aggiornamento MES.

## Ricerca dei sorgenti

Il worker precarica i componenti indicati dal contesto e le importazioni locali
immediate. Il modello può richiedere più file insieme con `SOURCE_READ_MANY`.
Le acquisizioni di sorgenti (massimo 20, ognuna deve aggiungere file) sono separate
dai quattro tentativi di compilazione e riparazione. Il database limita a 24 le
chiamate totali e mantiene vincoli su revisione, sessione e autorizzazioni.
I risultati registrano separatamente acquisizioni e test. Aggiornare anche il
worker locale e applicare `20260924170000_ai_source_discovery_budget.sql`.

## Annullamento e diagnosi (protocollo 2)
Il coordinatore deve essere aggiornato insieme al backend e alla migrazione
20260928190000_ai_development_cancellation.sql. I vecchi worker non possono acquisire nuovi lavori.
CODE_SERVICE_STATUS espone il heartbeat; Results/worker-status.json registra il collegamento locale.
CODE_JOB_CANCEL e il pulsante Annulla lavoro invalidano la sessione prima della pubblicazione.
Un comando semplice "fermati" nella chat annulla deterministicamente i lavori della stessa
conversazione, senza una chiamata al modello. La fase publishing è acquisita atomicamente:
se è già iniziata l'annullamento restituisce un conflitto, mai una falsa conferma.
Dopo un crash i lavori sono interrupted e non vengono ripubblicati automaticamente.
Il deployment READY attesta il rilascio del commit, non il funzionamento della UI o le migrazioni.
La verifica funzionale resta esplicitamente distinta e non viene inventata.

## Browser, database e deleghe

Applicare `20260928210000_ai_runtime_permissions.sql` prima del backend.
Le impostazioni AI permettono all'admin di assegnare separatamente sviluppo,
pubblicazione, browser e database. Nessun permesso viene assegnato automaticamente
agli altri utenti. La revoca viene riletta dal backend e dai gate SQL del worker.

Installare nel solo coordinatore `playwright@1.63.0` (senza script di installazione);
viene usato Chrome già installato. Copiare anche `runtime.mjs` e `browser-login.mjs`.
Configurare `runtimeEnabled: true` e `supabaseExecutable` con il percorso assoluto
della CLI Supabase autenticata. Il repository Workspace deve essere collegato
al progetto Supabase corretto. Le credenziali restano nel servizio, mai nei prompt.

`BROWSER_OPEN_LOGIN` apre il profilo isolato del richiedente sul PC; il primo login
è personale. `BROWSER_VERIFY` naviga su Workspace, esegue azioni per nome accessibile,
controlla testi e conserva schermata/esito. Prima delle azioni verifica l'identità
Workspace nel DOM: un account diverso viene rifiutato. Non usa il profilo Chrome
personale né il profilo di un altro utente. Per popup interni sono supportati clic
e campi con etichette univoche; CAPTCHA e credenziali restano manuali.

`DATABASE_SCHEMA` legge solo metadati e firme RPC reali. `DATABASE_APPLY_MIGRATIONS`
accetta il proprio lavoro già pubblicato e testato: il coordinatore legge soltanto
i file di migrazione di quel commit e verifica che siano ancora identici in main.
Non usa `db push` sull'insieme delle migrazioni pendenti. Registra ogni versione
applicata e ricarica lo schema PostgREST. Un errore tra esecuzione e registrazione
viene segnalato esplicitamente e richiede riconciliazione prima di ripetere.

Le operazioni vengono accodate e restituite nella conversazione; `AI_OPERATION_STATUS`
legge risultati ed errori. "Fermati" blocca le azioni residue della conversazione;
non annulla effetti già completati. Dopo una scadenza non si ripetono automaticamente
azioni browser o migrazioni. Build, deployment, migrazioni e verifica browser
rimangono esiti distinti.
