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
- Una compilazione riuscita non equivale a un rilascio. Risultato, revisione e
  prove devono essere esaminati prima di pubblicare.

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

La conferma autorizza elaborazione e test. Il worker fotografa una revisione Git,
verifica le dipendenze, richiede i file necessari e applica sostituzioni vincolate
al contenuto originale. Il modello non esegue comandi sul PC. Solo dopo test riusciti
viene creato un commit nel ramo `codex/ai-<id>` usando un indice Git separato:
nessun checkout, hook o push automatico. Le Impostazioni AI mostrano file, prove,
ramo e commit per la successiva revisione e pubblicazione.

`worker.integration.test.mjs` con `AI_VERIFY_WSL=1` verifica davvero entrambi gli
esiti nel container, usando API simulata e repository temporaneo. Non costituisce
una verifica del modello remoto o della connessione alla produzione.

## Copertura dei test MES

`check-mes-linux.sh` esegue la compilazione e la suite compatibile con il
contenitore. Elenca esplicitamente i controlli che richiedono Windows, font PDF
o configurazioni escluse dal trasferimento. Prima del rilascio MES eseguire anche
la suite completa Windows sui sorgenti revisionati. Il worker non esegue mai
il codice generato sul sistema Windows e non pubblica automaticamente i rami.
