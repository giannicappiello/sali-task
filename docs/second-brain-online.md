# Second Brain Progrè: collegamento online

Il servizio riusa il catalogo e i controlli Second Brain già verificati, con trasporto MCP Streamable HTTP in Workspace. Non esegue chiamate a modelli generativi. Genera ordine con AI conserva il suo flusso API.

Endpoint: `https://workspace.progre.it/api/second-brain/mcp`.

Non occorrono Node.js, pacchetti o script sui PC. La prima associazione deve essere autorizzata nel proprio account OpenAI: aggiunta del server MCP personalizzato, oppure distribuzione del plugin da parte dell'amministratore OpenAI. Il pulsante Workspace apre la directory OpenAI; non installa o approva permessi al posto dell'utente. La disponibilità effettiva delle funzioni di collegamento dipende dal piano e dalle policy di quell'account, da verificare nella sua interfaccia.

## Identità e sessioni

- OAuth authorization code con PKCE S256, audience vincolata all'endpoint, risposta con `iss`, codice monouso di due minuti, token di accesso di 15 minuti, refresh monouso e connessione revocabile di 30 giorni.
- Sono accettati solo i documenti CIMD ufficiali e stabili di ChatGPT e Codex, recuperati senza redirect. I callback devono corrispondere ai metadati ufficiali; soltanto i callback loopback possono variare porta.
- Il consenso richiede un nuovo login Workspace dedicato al connettore. La sessione non viene condivisa con il browser, prevenendo conflitti nella rotazione del refresh token.
- Le credenziali di sessione sono cifrate sul server con AES-GCM e legate a connessione, utente e client. Le tabelle sono riservate al servizio; non sono leggibili dall'utente autenticato o dal modello. Nessuna password è conservata.
- Lo scambio dei codici e la rotazione dei token sono una singola transazione. Ogni chiamata ricontrolla identità e permessi Workspace correnti. La revoca interrompe l'uso del collegamento.
- Il client MCP riceve solo token opachi del connettore, mai i token Supabase. Non sono esposti strumenti SQL o di conferma diretta.

## Conferme

`BRAIN_REVIEW` restituisce una pagina Workspace. L'utente accede con la propria identità, legge l'intera proposta e conferma personalmente. La ricevuta resta nella pagina, è firmata, scade e si riferisce all'istantanea esatta. Iframe esterni non possono ospitare consenso o conferma. Errori o timeout richiedono verifica dello stato, senza ripetere la scrittura.

## Verifica

`node --test server/second-brain/online-auth.test.js server/second-brain/handler.test.js` verifica callback, isolamento della cifratura, esclusione SSRF, PKCE e delega allo scambio atomico.

`online-security-regression.sql` si esegue in una transazione con rollback dopo la migrazione dedicata: prova rifiuto di PKCE errato, riutilizzo di codici/refresh e connessioni revocate, e negazione dell'accesso alle sessioni dal ruolo authenticated.

Non dichiarare completato il collegamento nell'account OpenAI finché la sua autorizzazione e una lettura MCP reale non sono riuscite. Il connettore locale precedente resta una compatibilità transitoria; non è la procedura proposta agli utenti.

Verifica in produzione del 01-11-2026: il plugin privato ha completato OAuth con CIMD e PKCE; una chat OpenAI ha letto BRAIN_STATUS e BRAIN_MEMORY_SEARCH attraverso il trasporto remoto. Non sono state eseguite modifiche ai dati aziendali durante questa prova. Questa verifica riguarda l'account autorizzato, non gli account di altri utenti.

Il login Workspace riprende le sole pagine Second Brain di consenso e conferma conservando i parametri del collegamento. I refresh token Supabase sono opachi: non si assume una loro lunghezza minima. La migrazione `20261101210000_second_brain_memory_read_performance.sql` mantiene le stesse regole RLS e valuta identità e abilitazione una volta per query; evita il ricalcolo per ogni frammento importato. Il test SQL con rollback verifica ancora isolamento tra utenti, conferma e idempotenza.
