# Permessi clienti Private — verifica del 28 settembre 2026

Stato: implementazione nella worktree `private-customer-permissions`. Nessun commit,
push, rilascio o applicazione della migrazione al database pubblico.

## Comportamento preparato

- Il collegamento ai clienti prevale sul nome del ruolo operativo.
- Progetti e task Private leggibili solo per i clienti associati, anche tramite
  identificativi `crm:` e task che ereditano il cliente dal progetto.
- Cambio stato tramite RPC dedicata, con controllo cliente/modulo, dipendenze e audit.
- Note aggiuntive tramite commenti; allegati aggiungibili. Campi originari,
  associazioni, creazione/cancellazione dei record e costi non modificabili.
- Dashboard Ordini Private: quantità ordinate/evase, riferimenti delle fatture
  riconciliate e ultimazione prevista; niente apertura dettagli o RdP.
- API dettagli negate ai clienti; la risposta dell'elenco usa campi espliciti e
  non contiene richieste, diagnostiche o dati MES interni.
- Modifiche/invio ordini negati anche dai percorsi API precedenti e dai trigger
  che controllano le RPC di conferma ordini.
- Utenti interni senza associazioni cliente conservano i percorsi preesistenti.

## Evidenze

Accesso di Antonio Capece riprodotto sul database reale con transazione **read only**:
ambito `cliente`, codici `501.01458` e `501.02281`, risultato attuale 0 progetti,
0 task, 0 costi. Il confronto del filtro proposto sui record reali individua
1 progetto, 8 task e 4 registrazioni di costo. Non sono stati cambiati record o permessi.

Le policy effettive di progetti, task, costi, commenti, allegati e storage sono
state lette e confrontate con la migrazione preparata.

- Build Vite: superata.
- 15 test Node: superati (nuovi permessi/API, associazioni multiple, rendicontazione).
- 9 test esistenti del Workbench Private: superati.
- Un test esistente nello stesso file fallisce: `calendario cliente riusa la
  riconciliazione reale Produzioni senza ampliare il cliente`, errore
  `Calendario aziendale non disponibile per la lavorazione`. Il test e i due
  moduli calendario coinvolti sono identici a HEAD e non sono stati modificati.
- PostgreSQL locale (PGlite): migrazione eseguita su fixture, lettura multipli clienti,
  esclusione estranei anche se creatore, stato/dependenze, commenti e allegati,
  negazione costi e ordini anche tramite SECURITY DEFINER, utente interno e anonimo.
- Browser con componenti reali e servizi fittizi: campi bloccati per il cliente,
  cambio stato invia solo ID/stato, nota invia solo il nuovo commento, riepilogo
  ordini senza pulsanti dettagli/RdP; comandi completi presenti per utente interno.

## Limiti e passaggio in esercizio

Il collaudo locale non equivale a un accesso reale di Antonio sulla versione nuova.
Non sono state eseguite modifiche di prova sulle sue task pubbliche. Non è stata
verificata questa versione su dispositivi fisici iOS/Android o sul PC Windows 7.
Non è quindi una garanzia assoluta di assenza di regressioni.

Per l'attivazione servono il rilascio del codice e della migrazione
`20260928150000_linked_customer_record_permissions.sql`, seguiti dal collaudo
dell'accesso reale e dal controllo della versione pubblica. Il test calendario
preesistente va tenuto distinto e segnalato nel gate di rilascio.

Ripetere i controlli locali:

```powershell
node --test server/linked-customer-record-permissions.test.js test/crm-workspace-costs.test.mjs server/private-multiple-customer-scope.test.js
npm install --prefix artifacts/permission-harness --no-save --package-lock=false @electric-sql/pglite
node scripts/verify-linked-customer-permissions.mjs
npm run build
```

Il controllo automatico ha respinto una semplificazione che avrebbe rimosso una
verifica di abilitazione modulo. La semplificazione non è stata applicata; la
verifica è mantenuta e il blocco cliente è aggiuntivo.
