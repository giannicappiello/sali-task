# Email dalla chat e indirizzi Workspace

Usare per richieste di trovare indirizzi o inviare una sola email di testo a persone specifiche, senza creare task. Verificare lo schema realmente esposto: questa guida non rende disponibili azioni non ancora pubblicate.

## Identificare i destinatari

1. Verificare identita con `BRAIN_STATUS`. Usare `WORKSPACE_CONTACTS_SEARCH`, se esposto, per recuperare gli indirizzi Workspace mancanti. La ricerca e in sola lettura, nel perimetro RLS e personale/team/cliente del titolare.
2. Input alternativi: `query` nome/cognome/email parziale (2–160 caratteri), `userId` UUID o `email` esatta. Senza filtro si sfoglia l'elenco autorizzato. `status` vale `active` di default; `inactive` o `all` solo quando pertinenti. `offset` parte da 0, `limit` default 20 e massimo 50.
3. Leggere `rows`, `nextOffset`, `resolution` e `coverage`. I record hanno `id`, `name`, `email` (anche null), `active`, `emailStatus` (`available`, `missing`, `invalid`). `incomplete` non e una ricerca conclusa; proseguire le pagine necessarie. `candidate` da query parziale non e identita certa.
4. Per omonimi o ambiguita (`ambiguous`) chiedere quale persona e poi rileggere per `userId` o email esatta. Usare un indirizzo solo se la persona e risolta e `emailStatus` e `available`. Se manca o non e valido, chiedere l'indirizzo o segnalare il limite. Non inventare indirizzi da convenzioni aziendali e non scegliere il primo risultato.
5. Non dichiarare che la rubrica copra tutti gli utenti quando `coverage` indica un perimetro limitato. `not_found` vale per la ricerca autorizzata, non per l'intera azienda. Il permesso di leggere non autorizza un invio.

## Preparare un solo messaggio

Verificare destinatari, distinzione A (To)/CC, oggetto, contenuto e richiesta esplicita di invio. Una richiesta di bozza non autorizza a inviare. Non cambiare il ruolo dei destinatari e ricordare, quando rilevante, che To e CC sono visibili a tutti i riceventi.

`WORKSPACE_EMAIL_PREPARE` accetta `to` come array non vuoto di indirizzi e `cc` facoltativo come array, massimo 10 indirizzi totali. Per compatibilita accetta anche `recipient` singolo, ma non insieme a `to` o `cc`. `subject` massimo 200 caratteri, `body` massimo 12000, `idempotencyKey` UUID per la specifica richiesta. Non sono supportati BCC, nomi display con indirizzo incorporato, allegati, campagne o ricorrenze.

Non eliminare silenziosamente duplicati o indirizzi per superare i controlli. Il backend normalizza le nuove liste e rifiuta duplicati anche tra To/CC. Mostrare tutti gli indirizzi risultanti e conservare l'ID e il `payload_hash` restituiti. Non ricalcolare l'hash, non ricostruire destinatari dal solo campo legacy `recipient` se sono presenti `to_recipients` e `cc_recipients`.

## Delega e invio

Leggere `WORKSPACE_EMAIL_CAPABILITY`. Non assumere che un collegamento attivo, il livello AI conferma o una delega qualsiasi bastino a inviare a un gruppo.

- `chat-email-v1` autorizza un solo destinatario senza CC. Resta valida nel proprio ambito anche se il singolo destinatario e espresso con `to: [email]`, `cc: []`.
- `chat-email-v2` autorizza fino a 10 destinatari To/CC per una singola email testuale espressamente richiesta. Non e l'aggiornamento automatico di v1.
- Per richiedere v2 usare `WORKSPACE_EMAIL_DELEGATION_PROPOSE` con `policyVersion: "chat-email-v2"`. Omettere la versione mantiene il comportamento legacy v1 e non richiede v2.
- La proposta non attiva nulla. Il titolare deve leggere e approvare personalmente `BRAIN_REVIEW kind=email-delegation`. Non automatizzare quella pagina, non spuntare checkbox, non usare un consenso in chat come nuova attivazione persistente. Non modificare ruoli o autorizzazioni.
- Senza delega compatibile fermarsi oppure offrire la revisione di quella sola email con `BRAIN_REVIEW kind=email`. Non creare una task e non reinviare tramite un percorso alternativo dopo un diniego.

Con richiesta esplicita e delega compatibile attiva, chiamare `WORKSPACE_EMAIL_SEND` solo con l'ID e l'`expectedHash` esatti della proposta. Se cambiano testo, destinatari o To/CC, serve una nuova proposta autorizzata. Le conferme previste per dati sensibili e comunicazioni ad alto impatto continuano ad applicarsi.

## Esiti, trasporto e limiti

Le nuove liste richiedono protocollo di trasporto 2 anche con un solo To. Gli storici con array null restano protocollo 1, senza riscrittura dell'hash. Un servizio che supporta solo v1 non prova che To/CC siano operativi. `EMAIL_TRANSPORT_NOT_READY` richiede l'aggiornamento del servizio, non un cambio dei permessi o una semplificazione dei destinatari.

Leggere `WORKSPACE_EMAIL_STATUS` dopo l'invio e dopo ogni errore/timeout. `queued` significa accodata, `sending` in corso, `accepted` accettata dal server, non consegnata a tutti. `uncertain` richiede verifica umana e nessun reinvio automatico, neppure a un sottoinsieme. `WORKSPACE_EMAIL_HISTORY` e personale e paginato: non dichiara lo storico di tutti gli utenti.

L'aggiornamento di questa skill nel repository non pubblica codice, non aggiorna il plugin installato, non attiva deleghe e non autorizza test con email reali.
