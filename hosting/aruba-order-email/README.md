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
