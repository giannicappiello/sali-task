# Capacità: evidenza e limiti

Snapshot del 7 novembre 2026. Non è una whitelist permanente né una concessione di accesso. Aggiornare con schema e letture correnti per ogni utente. Nessuna proposta, simulazione persistita o scrittura è stata eseguita nella preparazione della Skill.

## Letture effettivamente riuscite

| Verifica | Evidenza | Limite |
|---|---|---|
| BRAIN_STATUS | connected=true, online=true, identità Workspace presente, roleAiLevel=conferma, externalModelCalls=false | Identità omessa dal pacchetto condivisibile. Nessuna lista di permessi specifici restituita. |
| MES_READ resource=status | source ProgreMES.APS, apiVersion=1, readOnly=true; moduli clients, suppliers, articles, orders, productionSummary, inventory, planning attivi | Moduli esposti, non prova di copertura di ogni record. |
| MES_READ resource=production-progress, page=1, pageSize=1 | Lettura riuscita, pagina con totale e dati di fase, quantità, scarto, qualità e rilascio | Campione di una riga, non analisi completa né prova di diritti di chiusura. |
| PRODUCTION_COST_CONFIGURATION | Configurazioni versionate STATION/FILLING, calendario, canWrite=true, screenDraft=null | canWrite vale per quel contesto; non dimostra accesso generale o permesso di forzatura. Nessun valore economico è incorporato nella Skill. |
| SALES_INVOICES_READ | Riepiloghi e dettagli campionati di fatture sincronizzate da Mexal | Non contabilità completa; il dettaglio è limitato e la copertura deve essere letta. |

MES_READ status con page/pageSize ha restituito INVALID_ARGUMENT “Parametro non consentito: page.” La chiamata senza paginazione è riuscita. Usare parametri compatibili con la singola risorsa, non tutti quelli dello schema indiscriminatamente.

## Strumenti esposti ma non eseguiti in questa verifica

- CRM_CUSTOMER_SEARCH, WORKSPACE_ORDERS_SEARCH, CUSTOMER_REORDERS_READ, BUSINESS_SEARCH, WORKSPACE_SEARCH: letture commerciali/Workspace; permessi e copertura da verificare sul caso concreto.
- MES_RESOURCE_COSTS, FORMULA_LOOKUP/READ, HR_READ: possibili fonti complementari; non sono una prova di costo industriale completo. HR economico richiede configuration=true e admin secondo il contratto; non tentare per eludere un diniego.
- MES_PRODUCTION_LOOKUP, MES_PRODUCTION_CLOSURE_STATE e MES_PRODUCTION_START_PREVIEW/STATUS: letture specifiche, da usare con identificativi reali.
- MES_PRODUCTION_FORCE_CLOSE, MES_PRODUCTION_RESUME_CLOSE, MES_PRODUCTION_START e altri strumenti di proposta: schema disponibile, esecuzione e autorizzazione non collaudate.
- BRAIN_REVIEW, ACTION_STATUS, BRAIN_ACTION_STATUS: revisione e lettura esiti esposte; flusso completo non provato perché non sono state create proposte.

## Implementazione successiva allo snapshot

Sono stati aggiunti al codice Workspace MES_PRODUCTION_PERMISSIONS, MES_PRODUCTION_FORCE_START, MES_PRODUCTION_REOPEN, MES_PRODUCTION_REOPEN_PREVIEW e MES_PRODUCTION_FORCE_CLOSE_PREVIEW. Il database controlla autorizzazioni esplicite su proposta e conferma; il gateway le rilegge e non considera admin un sostituto. Nessuna assegnazione agli utenti è automatica.

Il codice MES include anteprima di riapertura, applicazione con hash/audit/idempotenza e verifica SL/CL in Mexal prima della chiusura forzata. Compilazione e 25 test MES, oltre a 56 test Workspace, sono passati nella preparazione del rilascio. Questo prova il codice locale, non l'installazione del MES dell'utente. Workspace e MES devono essere aggiornati; verificare gli strumenti effettivamente presenti a ogni uso.

Avvio forzato: supportata soltanto l'eccezione carenze della miscelazione già prevista dal backend; gli altri blocchi restano. Riapertura: soltanto conclusioni non contabilizzate, senza movimenti/giacenze o dipendenze bloccanti; ritorno in Sospeso con storico conservato. Per dettagli usare [production.md](production.md).

## Gap dello snapshot iniziale e verifica richiesta al momento dell'uso

1. Nessuno strumento dedicato alla chiusura ordinaria esposto nello snapshot. Non sostituirlo con FORCE_CLOSE o RESUME_CLOSE. Gli operatori sono abilitabili alla chiusura ordinaria secondo la regola richiesta, ma l'effettiva configurazione per operatori non è stata verificata.
2. Il permesso specifico **Autorizza chiusura forzata**, non esposto nello snapshot iniziale, è ora identificato nel codice da `progremes.production.force_close`. Verificare la sua effettiva assegnazione con MES_PRODUCTION_PERMISSIONS. Il livello AI conferma non basta.
3. Gli strumenti di apertura, assenti nello snapshot iniziale, sono implementati nel codice del rilascio. Non presumere che un backend non aggiornato li supporti. START resta ordinario; RESUME_CLOSE non riapre una produzione. Le riaperture contabilizzate restano escluse.
4. Nessuna risorsa esplicita di contabilità generale, banche, scadenziari, cash flow, budget o EBITDA nel contratto osservato. Fatture vendita non bastano a calcolare EBITDA o liquidità.
5. Qualità disponibile nel campione avanzamento; archivio completo non conformità, misure e controlli non verificato. Fermi macchina, consumi energetici e consuntivi manodopera completi non verificati.
6. L'accesso di questo utente non prova quello di operatori o altri utenti. Serve verifica nella loro sessione, senza impersonazione.

Per risolvere gap backend, consegnare una specifica all'amministratore/manutentore. Non usare API private, SQL, credenziali condivise o modifiche ai ruoli come scorciatoia. Nessuna modifica al backend o ai permessi è inclusa nel pacchetto.
