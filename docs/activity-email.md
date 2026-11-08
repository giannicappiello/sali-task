# Prototipo precedente: email dalle attivita

Questa versione e stata sostituita dal flusso chat-first descritto in [chat-email.md](chat-email.md). Il pannello task non e collegato all’interfaccia. I componenti e i test del prototipo restano nel worktree per conservare il lavoro, ma non sono il percorso richiesto.

# Email dalle attivita Workspace

## Ambito

Email singola da una task v4 esistente: un destinatario, oggetto fino a 200 caratteri e testo fino a 12000. Nessun allegato, lettura casella, invio ricorrente o cambio del mittente in questa versione.

Nel dettaglio attivita, il pannello **Email dell'attivita** permette di preparare una proposta, leggere il riepilogo completo e premere **Conferma e invia**. Preparare una proposta non manda email. Lo storico e accessibile solo nel perimetro attuale della task.

## Autorizzazione e consenso

- Sessione Workspace personale valida e attiva.
- Attivita accessibile e scrivibile, escluso il perimetro cliente esterno.
- Permesso specifico `activity.email.send`; amministratori Workspace secondo le convenzioni esistenti.
- La migrazione definisce il permesso ma non lo assegna a utenti o ruoli.
- Solo l'autore della proposta puo confermarla. Il contenuto e immutabile; la conferma controlla hash, scadenza della proposta e snapshot corrente della task.
- Proposte Progre AI richiedono anche perimetro AI attivita e livello bozza/conferma. La decisione ricontrolla il livello conferma e avviene nella pagina Workspace, mai nello strumento del modello.
- Chiave idempotente per la proposta e conferma ripetuta idempotente. Nessun reinvio automatico dopo esiti incerti.

## Progre AI

Nuovi strumenti: `ACTIVITY_EMAIL_CONTEXT`, `ACTIVITY_EMAIL_PROPOSE`, `ACTIVITY_EMAIL_HISTORY`, `ACTIVITY_EMAIL_STATUS`.
`ACTIVITY_EMAIL_PROPOSE` restituisce la proposta e `reviewKind=email`. Il passaggio successivo e `BRAIN_REVIEW` con `kind=email` e il relativo ID. Il titolare verifica destinatario, oggetto e testo e conferma personalmente in Workspace. `BRAIN_ACTION_STATUS` supporta anche `kind=email`.

Dopo pubblicazione aggiornare il catalogo delle azioni della connessione esistente se il client non mostra i nuovi strumenti. Non cambiare i permessi Workspace per risolvere un catalogo obsoleto.

## Stati e trasporto

`proposed` -> `queued` dopo conferma -> `sending` al claim atomico -> `accepted`, `failed` oppure `uncertain`.
Una proposta rifiutata diventa `rejected`. `accepted` prova soltanto l'accettazione da parte del server, non la consegna finale.

Il claim e unico. Non torna mai automaticamente a queued. Una risposta SMTP ambigua, la perdita della risposta al claim o il mancato salvataggio dell'esito richiedono verifica; i claim scaduti passano a uncertain. Nessun pulsante di retry automatico.

Il trasporto riutilizza Aruba PHP o il worker SMTP esistente. Il protocollo HTTP `activity_email_protocol=1` e il prefisso `activity:` isolano le nuove email da ordini, DDT e report commerciali. `run_activity` elabora esclusivamente attivita.

La conferma ritorna lo stato persistito subito; il risveglio del worker viene gestito con Vercel `waitUntil`. Il dispatcher controlla prima con GET `activity_email_capabilities`: un worker vecchio o sospeso non riceve il nuovo POST. Le configurazioni e i segreti esistenti restano sul server.

## Rilascio, da autorizzare separatamente

1. Rivedere e applicare `supabase/migrations/20261108112613_activity_email.sql` nell'ambiente scelto. La migrazione include RLS, grant minimi, trigger di immutabilita e funzioni worker service-only.
2. Pubblicare backend e frontend della stessa revisione.
3. Se il trasporto attivo e Aruba, aggiornare solo `hosting/aruba-order-email/worker.php` conservando la configurazione e il mittente esistenti. Non usare richieste POST per interrogare vecchi worker.
4. Verificare in sola lettura la capability aggiornata e lo stato operativo del worker. Nessun controllo deve drenare altre code.
5. Assegnare il permesso specifico soltanto agli operatori autorizzati tramite gli strumenti amministrativi esistenti. Gli amministratori Workspace seguono le convenzioni esistenti.
6. Aggiornare le azioni Progre AI se necessario. Per un collaudo reale ottenere un destinatario e contenuto di prova esplicitamente approvati; verificare separatamente accettazione e ricezione.

Non sono state eseguite migrazioni di produzione, pubblicazioni o email reali durante lo sviluppo. PHP e la configurazione live non sono stati usati per dedurre una consegna.

## Verifiche locali

- Test API: metodi e schema, identita, hash, contenuto cambiato, separazione manuale/AI, rifiuto senza invio, stato terminale e privacy errori.
- Test Progre AI: catalogo senza invio diretto, perimetro AI, revisione umana separata, autenticazione/connessione esistenti.
- Test DOM: doppio click, timeout, conservazione bozza, chiusura, cambio task, focus, richiesta idempotente, link AI e prevenzione submit della task con Enter.
- Test trasporto: SMTP simulato, capability-gating Aruba, isolamento report/ordini/DDT, esiti incerti e conferma persa.
- Fixture PostgreSQL in memoria: esecuzione della migrazione e test effettivi di RLS, grant, immutabilita, idempotenza, concorrenza e stati worker. La fixture non sostituisce un collaudo dell'intera baseline di produzione.
- Build Vite e lint mirato. Il lockfile della baseline non contiene gia pdfjs-dist e zxing-wasm: npm ci fallisce sulla baseline; per le verifiche sono state installate dipendenze senza modificare package.json o package-lock.json e senza script di installazione.

Comandi focalizzati (aggiungere la fixture SQL secondo il test dedicato):

```
node --test server/email/activity-email-*.test.js server/second-brain/activity-email-tools.test.js server/second-brain/handler.test.js server/second-brain/online-auth.test.js test/activity-email-ui.test.mjs
npm run build
php hosting/aruba-order-email/worker.test.php
```

Il test PHP richiede un interprete PHP installato. Non contiene invii reali: il mailer e sostituito da mock.
