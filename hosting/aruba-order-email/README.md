# Worker email ordini su Aruba Hosting Linux

Questo pacchetto invia le email degli ordini dall'infrastruttura Aruba usando
PHP 8.3 e `mail()`. La coda e lo stato restano su Supabase, ma la chiave
`SUPABASE_SERVICE_ROLE_KEY` non viene mai caricata sullo spazio Aruba.

## Sicurezza iniziale

Il file di esempio mantiene `queue_enabled` su `false`. In questo stato il
worker non può prelevare né inviare le email reali già presenti in coda.

1. Creare sul terzo livello la cartella `order-email-worker`.
2. Caricare `.htaccess`, `worker.php` e `config.example.php`.
3. Copiare `config.example.php` in `config.php`.
4. Inserire in `config.php`:
   - URL Workspace;
   - lo stesso `WORKER_SECRET` configurato su Vercel;
   - mittente del dominio Aruba;
   - un proprio destinatario di prova.
5. Lasciare `queue_enabled => false`.

Il file `.htaccess` impedisce l'accesso web alla configurazione e disabilita
l'elenco della cartella.

## Prima prova controllata

Inviare una richiesta `POST` a `worker.php` con:

```text
Authorization: Bearer <WORKER_SECRET>
Content-Type: application/json
```

e corpo:

```json
{"action":"test"}
```

La prova usa esclusivamente `test_recipient` e non modifica la coda ordini.
Dopo il test impostare `test_enabled => false`.

## Attivazione della coda

Solo dopo aver verificato mittente, consegna e antispam:

```php
'queue_enabled' => true,
'test_enabled' => false,
```

Il worker elabora al massimo `max_jobs_per_run` messaggi per esecuzione.

## Cron di recupero

Nel pannello Aruba creare un Processo Cron di tipo istruzione PHP, ogni 10
minuti, indicando il percorso di `worker.php`. Il Cron è un recupero di
sicurezza; l'applicazione potrà richiamare lo stesso endpoint via HTTPS subito
dopo l'accodamento.

## Requisiti PHP

- PHP 8.3
- estensione cURL
- funzione `mail()`
- HTTPS verso `workspace.progre.it`

## Log

Gli errori vengono scritti nel log PHP con prefisso:

```text
[progre-order-email]
```

Non vengono registrati password, segreti o contenuti delle email.

## Report commerciali mensili

La versione con `report_protocol=1` supporta anche i PDF commerciali. Aggiornare
solo `worker.php`, conservando il `config.php` e il mittente già in uso. Prima
pubblicare il backend Workspace con la migrazione `commercial_report_delivery`.
La verifica autenticata `GET ?action=report_capabilities` non elabora alcuna coda.
Non usare una richiesta POST per verificare una versione precedente: i vecchi
worker interpretano le azioni sconosciute come un normale invio ordini.

`POST {"action":"run_reports"}` elabora esclusivamente la coda report. I PDF
vengono scaricati singolarmente attraverso il backend autenticato e verificati
con SHA-256, senza link pubblici. Gli invii incerti richiedono verifica umana;
non vengono ripetuti automaticamente. Il piano è inizialmente disabilitato e
si collega dalla pagina Workspace `/settings/commercial-reports`.

## Email Workspace: più destinatari To e CC

Il worker supporta `activity_email_protocol` 1 (storico, un destinatario) e 2
(liste `to_recipients` e `cc_recipients`). Il limite è 10 indirizzi complessivi;
indirizzi duplicati, header injection e BCC vengono rifiutati prima dell'invio.
`mail()` riceve tutti i To nel primo argomento e i CC nell'header `Cc`, usato
anche per la consegna dal trasporto PHP. Non vengono create email separate.

Per aggiornare un'installazione che già supporta le email Workspace:

1. Dopo approvazione del rilascio, aggiornare **solo `worker.php`**. Non cambiare
   `config.php`, segreti, mittente o cron. Il nuovo worker mantiene
   `activity_email_protocol: 1` e aggiunge `activity_email_protocols: [1, 2]` sia
   alle capability sia alle richieste di claim: può quindi lavorare con il
   backend precedente senza consumare code incompatibili.
2. Verificare soltanto con il `GET` autenticato
   `?action=activity_email_capabilities`: deve dichiarare `[1, 2]` e
   `queue_enabled: true`. Questo controllo non preleva né invia messaggi.
3. Applicare la migrazione destinatari v2, quindi pubblicare il backend e la UI.
   Il backend richiede capability 2 per confermare/accodare le proposte v2 e usa
   `workspace_claim_email_v2` esclusivamente per consumer compatibili. La vecchia
   RPC resta vincolata alle righe protocollo 1. Una mail v2 non può essere
   prelevata da un vecchio worker e inviata soltanto al primo destinatario.
4. L'eventuale verifica reale richiede un messaggio e destinatari esplicitamente
   approvati. Non usare `action=test`, POST o cron come test di sola readiness.

`accepted` significa presa in carico dal trasporto, non conferma di consegna
nelle caselle. Esiti ambigui o acknowledgements persi restano `uncertain` e non
vengono ripetuti automaticamente. Anche l'accettazione SMTP parziale dei
To/CC è `uncertain`, per evitare duplicati ai destinatari già accettati.

## Anomalie: report Fabbisogni solo testo

Il worker espone `GET ?action=anomaly_email_capabilities`, che dichiara il
protocollo dedicato, la coda attiva, il mittente configurato e l'assenza di
allegati. `POST {"action":"run_anomalies"}` lavora esclusivamente le email
testuali della coda Anomalie e usa `anomaly_only: true` nel claim Workspace; non
consuma le code ordini, DDT o report commerciali. Il payload con allegati o BCC
viene rifiutato prima dell'invio. Se l'esito SMTP o la conferma backend è ambiguo,
la consegna resta `uncertain` e non viene ripetuta automaticamente.

Il worker aggiornato è compatibile con le code esistenti; per abilitare il nuovo
flusso occorre però prima applicare la migrazione incrementale Anomalie e
pubblicare il backend Workspace. Il controllo GET non preleva né invia email.
Non eseguire `run_anomalies` come test: elabora la coda reale.

Test locali senza configurazione, rete né invii reali:

```sh
php -l hosting/aruba-order-email/worker.php
php hosting/aruba-order-email/worker.test.php
node --test server/email/activity-email-worker.test.js server/email/smtp-client.test.js server/email/email-transport-gate.test.js test/order-email-worker.test.mjs
```
