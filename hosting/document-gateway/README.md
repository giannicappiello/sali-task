# Gateway documentale Progre

Servizio di sola lettura destinato al desktop Windows connesso al NAS.

## Sicurezza

- ascolta solo su `127.0.0.1`;
- non espone directory listing;
- accetta esclusivamente URL HMAC con scadenza massima 15 minuti;
- permette solo PDF, immagini e formati video autorizzati;
- impedisce traversal e accesso fuori dalla cartella configurata;
- supporta HTTP Range per lo streaming video;
- non implementa upload, modifica o cancellazione.

## Avvio locale

1. Copiare `config.example.cmd` come `config.cmd`.
2. Generare un segreto casuale di almeno 32 caratteri e inserirlo solo in `config.cmd`.
3. Avviare `config.cmd` con l'utente Windows che dispone delle credenziali NAS di sola lettura.
4. Verificare `http://127.0.0.1:8787/health`.

Il file `config.cmd` non deve essere copiato nel repository né condiviso.
