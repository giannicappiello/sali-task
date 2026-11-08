# Email Workspace richieste in chat

## Obiettivo attuale

L'utente chiede in chat e Progre AI prepara, invia e controlla il risultato usando Workspace. Non e necessario creare o aprire una task. Non e presente un pannello email nel dettaglio attivita.

Il mittente e quello aziendale gia configurato nel trasporto Workspace. La prima versione tratta una email testuale e un destinatario per richiesta; nessun allegato, campagna o automazione ricorrente.

## Vincolo attuale e attivazione legittima

Il contratto Second Brain attuale richiede revisione umana Workspace per le scritture. Non e lecito automatizzare quella conferma o trattare un generico consenso in chat come attivazione di nuovi accessi persistenti.

La nuova implementazione introduce una delega personale e limitata `chat-email-v1`, inizialmente NON attiva. Il titolare deve approvarne una volta il riepilogo in Workspace. Il riepilogo spiega che l'assistente puo inviare singoli messaggi di testo soltanto quando l'utente lo richiede espressamente nella chat e ai destinatari indicati; non autorizza email non richieste, ricorrenti, massive o con allegati. Il checkbox non e preselezionato. La delega e revocabile dalla stessa revisione.

L'attivazione e un'operazione umana separata. Non e esposta come strumento del modello; gli strumenti possono soltanto preparare la proposta di delega e leggere lo stato. Non si cambiano ruoli, credenziali o autorizzazioni di altre funzioni.

Dopo attivazione e rilascio, per un invio specificamente richiesto nella chat non serve aprire una task o approvare di nuovo in Workspace. Le altre conferme previste per dati sensibili o comunicazioni ad alto impatto restano applicabili.

## Flusso

1. `BRAIN_STATUS` e `WORKSPACE_EMAIL_CAPABILITY`: verificano identita, permesso email e delega personale corrente.
2. Se manca la delega e l'utente vuole il flusso dalla chat, `WORKSPACE_EMAIL_DELEGATION_PROPOSE` crea soltanto la proposta. `BRAIN_REVIEW kind=email-delegation` apre il riepilogo che il titolare deve approvare personalmente.
3. Per ciascun invio richiesto: `WORKSPACE_EMAIL_PREPARE` crea una proposta immutabile con destinatario, oggetto, testo e chiave idempotente.
4. Con delega attiva: `WORKSPACE_EMAIL_SEND` accoda l'esatta proposta usando ID e hash. Il server rilegge identita, permesso, livello AI e delega. La richiesta senza delega e rifiutata; non esiste un flag arbitrario per saltare la conferma.
5. `WORKSPACE_EMAIL_STATUS` controlla l'esito persistito. `WORKSPACE_EMAIL_HISTORY` restituisce solo lo storico chat del titolare.

Senza delega, rimane possibile approvare una singola proposta via `BRAIN_REVIEW kind=email`. Questa e un'alternativa esplicita, non una conferma da eseguire automaticamente.

## Sicurezza e affidabilita

La tabella generale conserva contenuto approvato, titolare, provenienza, hash, delega utilizzata e stato. Le email standalone sono indipendenti dalle task e visibili solo al titolare autorizzato. Il permesso `workspace.email.send` viene definito senza assegnarlo a ruoli o utenti. Le convenzioni amministratore Workspace esistenti restano applicate.

Il servizio impedisce la modifica del testo dopo preparazione, la conferma di email altrui, i duplicati con la stessa chiave e le transizioni dirette aggirando gli RPC autorizzati. L'attivazione delega usa una route umana con receipt firmata, identificativo attore derivato dalla sessione e controllo stato. Revoca e cambiamento dei permessi bloccano nuovi invii; la coda delegata rivaluta la delega prima del claim.

Il worker condiviso riusa Aruba PHP oppure SMTP, isolando il protocollo da ordini, DDT e report commerciali. Accodamento non e invio; `accepted` indica accettazione del server e non prova consegna. Gli esiti ambigui diventano `uncertain` e non sono mai rimessi automaticamente in coda.

## Rilascio e decisioni ancora necessarie

Questa implementazione locale non abilita da sola il servizio online. Occorrono:

- Approvazione del rilascio di backend/frontend e migrazioni nel Workspace scelto.
- Aggiornamento controllato del worker email, conservando mittente e configurazione segreta gia esistenti.
- Verifica del catalogo plugin; se obsoleto, aggiornare le azioni della connessione personale, non i permessi globali.
- Attivazione personale della delega mediante la pagina di consenso. L'assistente non puo eseguirla al posto del titolare.
- Eventuale destinatario e testo esplicitamente approvati per un test reale. Durante sviluppo si usano esclusivamente mock e fixture locali.

Nessun token o ruolo reale viene modificato, nessuna email reale e inviata, nessuna migrazione di produzione e applicata durante lo sviluppo.
