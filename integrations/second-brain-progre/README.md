# Second Brain Progrè — connettore Codex

**Modalità consigliata: collegamento online senza installazioni.** Seguire la pagina Second Brain in Workspace e [la documentazione online](../../docs/second-brain-online.md). Il pacchetto Windows descritto sotto è una compatibilità transitoria, non è necessario per il nuovo collegamento nell'account OpenAI.

Usa Codex con l'account ChatGPT di ciascuna persona e collega i servizi già presenti in Workspace. Il connettore non chiama modelli OpenAI: il ragionamento è svolto nella chat, secondo il piano del singolo utente. **Genera ordini con AI resta nel modulo Workspace e mantiene le API esterne esistenti.**

## Accesso di utenti e PC

Ogni persona usa il proprio account Codex e il proprio profilo Workspace. Non condividere password, cartelle di sessione o l'accesso dell'amministratore. Un account personale Codex non è automaticamente un membro dello spazio ChatGPT Business.

Il pacchetto si installa su ogni PC autorizzato, senza un limite applicativo di due postazioni. Ogni sessione conserva l'identità Workspace della persona: i permessi sono verificati dal server a ogni richiesta. Il numero di postazioni non assegna licenze Codex aggiuntive e non sostituisce i posti del piano Business. Per aggiungere una persona occorrono il suo accesso Codex e un profilo Workspace abilitato ai moduli consentiti. Non distribuire un account aziendale unico o sessioni preautenticate.

Requisiti: Windows, Node.js 22 o successivo, Codex, accesso Workspace con modulo AI abilitato. Il backend Second Brain deve essere pubblicato e la migrazione dedicata applicata prima del login.

1. Estrai il pacchetto in una cartella personale permanente.
2. Esegui `Install-SecondBrain.ps1` dal terminale PowerShell. Il pacchetto aziendale include `config.json` con i soli parametri pubblici. Per un'installazione dai sorgenti, specifica URL Supabase e chiave **pubblica** della stessa installazione Workspace. Non usare mai service-role o chiavi OpenAI.
3. Lo script registra il connettore nel tuo profilo Codex. Se non trova Codex CLI, stampa il blocco MCP da aggiungere alle impostazioni. Gli altri connettori rimangono configurati. Mantieni la cartella del pacchetto nel percorso scelto.
4. Apri una nuova chat locale Codex e richiedi il collegamento a Second Brain Progrè (`BRAIN_LOGIN`).
5. Apri il collegamento locale e accedi al tuo utente Workspace nel browser. Non inserire credenziali nella chat.
6. Verifica `BRAIN_STATUS`: devono comparire connessione e identità corrette.

La sessione è salvata con Windows DPAPI nella cartella personale `.progre-second-brain`; non può essere trasferita all'altro utente/PC. Il token Workspace non viene consegnato al modello. Le pagine locali durano pochi minuti e accettano soltanto richieste dalla propria origine.

## Operazioni

Il catalogo viene ricostruito sul server a ogni chiamata, intersecando permessi aziendali, livello AI e scope dei moduli. Le letture restituiscono dati attuali; simulazioni e proposte non equivalgono all'applicazione.

Le modifiche preparano una proposta. Usa `BRAIN_REVIEW` con `kind` (`controlled`, `heading`, `brain`) e l'ID restituito per aprire il riepilogo. La persona verifica input e situazione precedente e conferma nel browser. Codex non deve automatizzare questa pagina. Dopo la conferma leggere `BRAIN_STATUS`, `BRAIN_ACTION_STATUS` e gli strumenti di verifica del dominio. Un timeout non autorizza a ripetere l'azione.

La creazione attività/progetto usa il catalogo CRM e il servizio `workspace_create_operational_activity`, conservando workflow, reparti e task automatiche. Le rettifiche generiche di progetto/task sono limitate ai campi esposti e richiedono il valore `updated_at` letto prima della proposta. Cambiare la deadline di progetto non ricalcola automaticamente quelle delle task: il riepilogo lo dichiara.

Non sono esposti SQL, shell, credenziali o deleghe al vecchio modello AI. Sviluppo del codice e analisi dei documenti vengono svolti da Codex con i suoi strumenti. Nessun comando PLC è implicito nel collegamento.

## Email dalla chat e rubrica Workspace

Il flusso corrente non richiede task o pannelli attivita. `WORKSPACE_CONTACTS_SEARCH` cerca gli indirizzi professionali nel perimetro autorizzato del titolare, con paginazione, stato degli indirizzi e disambiguazione; non concede accesso globale e non deduce gli indirizzi mancanti.

`WORKSPACE_EMAIL_PREPARE` prepara una sola email con liste `to` e `cc`, massimo 10 destinatari complessivi, oppure il vecchio `recipient` singolo. `WORKSPACE_EMAIL_SEND` usa l’ID e l’hash della proposta immutabile, soltanto per un invio espressamente richiesto e coperto dalla delega personale. La v1 resta per un destinatario senza CC. La v2 To/CC richiede una nuova proposta esplicita `policyVersion: "chat-email-v2"`, seguita da `BRAIN_REVIEW kind=email-delegation` e consenso personale non automatizzabile; non estende le deleghe esistenti. In alternativa si puo approvare la sola email con `BRAIN_REVIEW kind=email`.

La revisione mostra tutti i To/CC, oggetto e testo. `accepted` non prova la consegna e un timeout non autorizza a ripetere l’invio. Sono esclusi BCC, allegati e campagne. Gli storici protocollo 1 mantengono destinatario, hash e receipt originali; le nuove liste richiedono un worker protocollo 2. Leggere [flusso e rilascio](../../docs/chat-email.md) e [guida operativa della skill](skills/progre-ai/references/chat-email.md). Le modifiche al repository non aggiornano da sole il backend, il plugin o la skill installata e non attivano deleghe personali.

## Memoria e chat

`BRAIN_MEMORY_SEARCH` ricerca nella memoria autorizzata. `MEMORY_SAVE` prepara una voce con fonte, data, categoria e visibilità personale, di reparto o aziendale. Solo un amministratore può pubblicare una voce aziendale. Le voci collegate a progetti richiedono anche accesso a quei progetti.

`BRAIN_IMPORT_HISTORY` apre l'importatore locale: seleziona un file JSON esportato da ChatGPT, JSONL storico o un JSON normalizzato `{ "conversations": [{ "id": "...", "title": "...", "messages": [{ "id": "...", "role": "user", "text": "...", "at": "..." }] }] }`.

Prima di confermare, controlla l'intera anteprima oscurata. Sono inclusi solo testi utente/assistente, non output degli strumenti, ragionamento nascosto o immagini. I filtri rimuovono formati riconoscibili di chiavi, token e password; testi con segreti non etichettati devono essere esclusi nella revisione. Gli archivi si importano inizialmente nella memoria personale del richiedente; il secondo utente non li vede automaticamente. La reimportazione aggiorna le stesse fonti senza duplicarle. Ogni lotto è atomico e auditato. Le richieste storiche non autorizzano operazioni e gli esiti vanno verificati sui sistemi correnti.

Gli archivi originali e `ContestoChat` non devono essere aggiunti al repository né ai pacchetti. Il connettore non garantisce l'accesso automatico a chat remote non esportate, allegati o account di altre persone.

## Verifica e rilascio

Dal repository: `node --test server/second-brain/handler.test.js integrations/second-brain-progre/test/*.test.mjs`.

La migrazione `20261101180000_second_brain_progre.sql` aggiunge soltanto tabelle/funzioni Second Brain. `server/second-brain/security-regression.sql` si esegue dentro una transazione di prova con rollback, dopo il corpo della migrazione: controlla proprietà, isolamento di due utenti, conferme e deduplicazione.

L'endpoint è `POST /api/mexal/automation?route=second-brain`. Le icone AI di Workspace e MES aprono `/assistente-ai`: la pagina prepara una richiesta controllabile e apre Codex con il protocollo ufficiale `codex://new?prompt=...`. L'utente invia personalmente il testo. Il download Windows è disponibile dalla pagina. Non viene inviata una password nel collegamento.

La precedente chat e le deleghe al worker sono rimosse. I vecchi endpoint chat/worker/CRM AI rispondono HTTP 410. La migrazione `20261101190000_retire_legacy_assistant.sql` elimina chat, messaggi, argomenti e lavori del vecchio assistente, bloccandone la ricreazione anche da vecchi client. Conserva autorizzazioni, audit delle azioni, memoria Second Brain e generazione ordini AI. Gli helper PDF usati anche dai report restano disponibili.
