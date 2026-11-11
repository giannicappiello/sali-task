# Email Workspace richieste in chat

## Flusso senza task

L'utente chiede in chat e Progre AI prepara, invia e controlla il risultato usando Workspace. Non serve creare o aprire una task. Il pannello email del prototipo attivita resta scollegato dall'interfaccia.

Il mittente resta quello aziendale configurato. Ogni richiesta prepara **una sola email di testo**, con almeno un destinatario A (To), CC facoltativi e **massimo 30 indirizzi complessivi**. Non sono previsti BCC, allegati, campagne o invii ricorrenti.

## Ricerca degli indirizzi

`WORKSPACE_CONTACTS_SEARCH` consulta la rubrica autorizzata con la sessione Workspace del titolare. Cercare per `query`, oppure risolvere una persona gia identificata con `userId` o `email` esatta. I tre filtri sono alternativi. La risposta espone solo ID, nome, email professionale disponibile, stato attivo e qualita dell'indirizzo.

La pagina predefinita contiene 20 record, al massimo 50. Seguire `nextOffset` prima di dichiarare completa una ricerca. Un singolo risultato di ricerca parziale e un `candidate`, non una risoluzione certa. Omonimi o altri risultati richiedono disambiguazione e poi rilettura per ID/email esatta. Non dedurre indirizzi dal nome e non sostituire un indirizzo assente o non valido con quello di un collega.

La copertura e quella dichiarata dalla risposta, limitata da RLS, moduli e ambito personale/team/cliente. Un elenco vuoto non prova che la persona non esista nell'intera azienda. Non cambiare permessi per ampliare la rubrica. Dettagli: [rubrica Workspace](second-brain-workspace-contacts.md).

## Destinatari e compatibilita

`WORKSPACE_EMAIL_PREPARE` accetta due forme alternative:

- Nuova: `to: ["persona@example.com", "collega@example.com"]`, `cc: ["copia@example.com"]` facoltativo, oltre a `subject`, `body` e `idempotencyKey`.
- Legacy: `recipient: "persona@example.com"`, senza `to` o `cc`, con gli stessi altri campi.

Oggetto fino a 200 caratteri e corpo fino a 12000. Gli indirizzi delle nuove liste vengono normalizzati dal backend. Duplicati, anche tra To e CC, liste vuote To, oltre 30 indirizzi, header injection e formati misti sono rifiutati, mai corretti eliminando destinatari in silenzio. L'ordine e il ruolo To/CC restano parte del contenuto approvato. Tutti i destinatari vedono gli indirizzi To e CC.

Le liste fino a 10 destinatari usano `transport_protocol_version=2`; le liste da 11 a 30 usano `transport_protocol_version=3` e vengono persistite in `to_recipients` e `cc_recipients`. Gli storici e le richieste legacy restano protocollo 1, con array null e `recipient` singolo. Nessun ricalcolo dell'hash o modifica delle vecchie receipt. Il campo legacy presente sulle nuove righe non e un destinatario aggiuntivo.

## Tre deleghe distinte

La delega personale non e attiva per default. Il consenso alla connessione non equivale al consenso per gli invii.

- `chat-email-v1`: una email a **un solo destinatario senza CC**. Le deleghe esistenti conservano contenuto, hash e ambito. Possono coprire anche una nuova lista con un solo To e CC vuoto, perche l'ambito non cambia.
- `chat-email-v2`: una email a **uno o piu destinatari To/CC, massimo 10 totali**. Richiede una nuova proposta e un consenso personale distinto. Puo coesistere con v1; v1 non viene aggiornata o ampliata automaticamente.

- `chat-email-v3`: una email a **massimo 30 destinatari complessivi To/CC**. Richiede una nuova proposta e consenso personale distinto. v1 e v2 conservano esattamente ambito, contenuto e hash; non sono ampliate o riattivate automaticamente.

Tutte valgono solo per email testuali richieste espressamente dal titolare nella chat, per i destinatari e lo scopo indicati. Non autorizzano messaggi spontanei, automatici, ricorrenti, massivi o con allegati. Restano applicabili le conferme previste per dati sensibili e comunicazioni ad alto impatto.

`WORKSPACE_EMAIL_DELEGATION_PROPOSE` seleziona `policyVersion` esplicitamente, per esempio `chat-email-v3` per richiedere fino a 30 To/CC. Ometterlo mantiene la compatibilita v1. Lo strumento prepara una proposta, non la attiva. `BRAIN_REVIEW kind=email-delegation` apre il riepilogo personale: il checkbox non e preselezionato, descrive la versione corrente e non trasferisce il consenso a una nuova receipt o proposta. L'assistente non puo cliccarlo o automatizzarlo. La stessa revisione permette la revoca umana.

## Preparazione, invio e revisione

1. Leggere `BRAIN_STATUS` e `WORKSPACE_EMAIL_CAPABILITY`: identita, permesso, deleghe e disponibilita del trasporto. Il generico stato di una delega non basta: verificare che il suo ambito copra tutti i destinatari richiesti.
2. Recuperare dalla rubrica gli indirizzi mancanti e risolvere eventuali ambiguita. Rispettare la distinzione To/CC indicata dall'utente; non spostare persone tra le liste per evitare un limite o una conferma.
3. `WORKSPACE_EMAIL_PREPARE` prepara l'esatto messaggio immutabile e restituisce ID e `payload_hash`. Preparare non significa inviare. Riutilizzare la chiave idempotente per la stessa richiesta, non creare un'altra proposta dopo un timeout senza leggere lo stato.
4. Con delega compatibile attiva e invio espressamente richiesto, `WORKSPACE_EMAIL_SEND` usa quell'ID e quell'hash. Il backend ricontrolla identita, livello AI, permesso, delega e protocollo del trasporto prima dell'accodamento.
5. Senza delega compatibile, fermarsi o offrire la revisione umana della singola email con `BRAIN_REVIEW kind=email`. Il riepilogo mostra **tutti** i To e CC, oggetto e testo come contenuto non modificabile. La conferma restituisce la stessa receipt firmata; non ricostruisce ne altera i destinatari nel client.
6. `WORKSPACE_EMAIL_STATUS` legge l'esito persistito; `WORKSPACE_EMAIL_HISTORY` legge solo lo storico chat del titolare. Dopo errore o timeout verificare lo stato prima di altro. Non reinviare un esito `uncertain`.

Dopo l'attivazione personale non occorrono pannelli task o conferme Workspace ripetute per gli invii coperti dalla delega. Tutte le altre operazioni conservano le conferme previste.

## Sicurezza e trasporto

Il contenuto approvato, le liste e i loro ruoli, il protocollo, il titolare, la provenienza e la delega sono vincolati al checksum e all'idempotenza. Le email standalone sono indipendenti dalle task e visibili solo al titolare autorizzato. Le decisioni controllano receipt, identita, stato e hash. Revoca e cambiamenti dei permessi bloccano nuovi invii; il worker ricontrolla la delega al claim.

La revisione mostra gli indirizzi come testo, senza interpretare HTML. Doppi click non duplicano le decisioni. Dopo timeout i pulsanti restano bloccati; cambiare proposta o usare Indietro/Avanti rilegge lo stato canonico e non riutilizza consenso o receipt di un altro riepilogo. Solo l'errore esplicito `EMAIL_TRANSPORT_NOT_READY` indica che nessuna email e stata accodata e consente un nuovo click personale.

La disponibilita Aruba viene letta con GET, senza drenare code. Il protocollo 2 e richiesto per liste fino a 10, anche con un solo To, e per attivare v2. Il protocollo 3 e richiesto per liste da 11 a 30 e per attivare v3. Il claim SQL esclude le righe protocollo 3 dai worker precedenti, anche durante un rilascio parziale. Un worker che dichiara solo protocollo 1 non puo ricevere nuove conferme protocollo 2. Lettura esiti, rifiuto e revoca restano disponibili. Gli invii protocollo 1 continuano con il vecchio contratto.

Il trasporto SMTP/Aruba invia un solo messaggio con To e CC distinti, mantenendo isolate le code ordini, DDT e report. `queued` significa accodato; `accepted` significa accettato dal server, non consegnato a ciascuno dei destinatari. Esiti ambigui o parziali richiedono verifica e non autorizzano un nuovo invio a tutto il gruppo.

## Rilascio e attivazione separati

Questo sviluppo locale non applica migrazioni, non pubblica codice, non cambia il plugin installato, non attiva deleghe e non invia email reali. Prima dell'uso occorrono, con autorizzazione distinta:

- Migrazione dedicata `20261111194321_email_thirty_recipients.sql` dopo `20261109182211_email_to_cc.sql`, con verifica di RLS, grant, immutabilita e dati storici. Non applicare indiscriminatamente migrazioni pendenti estranee.
- Rilascio coordinato backend/frontend/worker. Conservare mittente e configurazione segreta esistenti.
- Verifica GET della capability protocollo 3 e aggiornamento del catalogo plugin/skill, se obsoleto. Non cambiare permessi globali per un catalogo vecchio.
- Nuova attivazione personale v3 per gli invii da 11 a 30 destinatari dalla chat, oppure approvazione umana della singola email. Nessuna attivazione implicita delle deleghe v1/v2.
- Per un collaudo reale, destinatari, contenuto e invio esplicitamente approvati; verificare separatamente accettazione e ricezione.

Lo stato operativo di produzione va riletto al rilascio: la presenza del codice o un test locale non prova che migrazione, worker e plugin siano gia aggiornati.

## Verifiche locali

Node.js 24. Test solo con mock e fixture, senza destinatari reali:

```sh
node --test test/activity-email-review-ui.test.mjs test/activity-email-ui.test.mjs server/email/email-review-protocol.test.js server/email/activity-email-handler.test.js server/second-brain/handler.test.js
npm run build
```

I test DOM coprono liste complete fino al limite, fallback legacy e CC null, HTML injection, consenso distinto v1/v2/v3, receipt invariata, doppi click, timeout, cambio utente e navigazione Indietro/Avanti simulata. I test handler verificano il gate protocollo 1/2/3 prima delle scritture e la revoca senza trasporto. Questi test non sostituiscono il collaudo browser e il rilascio coordinato.

## Limiti e rilascio isolato

`maxRecipients=30` indica il limite tecnico. `authorizedMaxRecipients` indica il limite coperto dalle deleghe attive dell'utente, mentre `canSendThirty` richiede sia v3 attiva sia trasporto protocollo 3 pronto. Un vecchio consenso v2 resta valido fino a 10.

Il limite dei report commerciali, i relativi piani, destinatari, cron e gating non cambiano. I trasporti condivisi mantengono il limite precedente per report, ordini e DDT; solo le email ordinarie protocollo 3 usano il limite 30.

Il repo e condiviso con il progetto Vercel Club: un push Git puo creare deploy anche per Club. Per un rilascio circoscritto usare il progetto Workspace esplicito, migrazione dedicata e worker aggiornato; non eseguire `deploy:production` senza aver controllato tutte le migrazioni collegate. Nessuna pubblicazione o attivazione segue automaticamente dai test locali.
