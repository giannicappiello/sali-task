# Assistente AI Workspace

## Attivazione

1. Applicare le migrazioni `20260818220000_workspace_ai_module.sql` e `20260818230000_workspace_ai_cost_reporting.sql`.
2. Assegnare il modulo **Assistente AI** ai reparti autorizzati.
3. Aprire **Impostazioni → Assistente AI** e scegliere le capacità del reparto.
4. Abilitare AI Gateway per il progetto Vercel. In produzione l'autenticazione usa automaticamente `VERCEL_OIDC_TOKEN`; `AI_GATEWAY_API_KEY` è opzionale e serve per esecuzioni esterne o locali. Il modello predefinito è `openai/gpt-5.6-luna` e può essere cambiato con `AI_MODEL`.

La chiave AI è usata esclusivamente dalla funzione server `/api/ai/assistant` e non viene mai inviata al browser.

## Sicurezza

- Il modulo viene verificato nel browser e nuovamente sul server.
- I dati interni vengono letti con la sessione dell’utente e filtrati per moduli, reparti e ambito ordini.
- La ricerca Web è una capacità separata e disattivata per impostazione predefinita.
- Le pianificazioni sono salvate come proposte con audit; l’approvazione è una capacità separata.
- Una proposta non eseguibile non può essere approvata dall’interfaccia.

## Rendicontazione

Ogni generazione viene registrata prima della chiamata al modello e completata con stato, funzione utilizzata, modello, token di input/output, identificativo del provider e costo in USD comunicato da AI Gateway. Anche gli errori restano tracciati.

Il riepilogo mensile viene aggiornato atomicamente per utente ed è disponibile agli amministratori in **Impostazioni → Assistente AI → Rendicontazione AI per utente**. L'identificativo utente e i tag della funzione vengono inviati anche ad AI Gateway per consentire il riscontro con il pannello Vercel.

## ProgreMES

Il Workspace attuale dispone di SSO e sincronizzazione del catalogo moduli ProgreMES, ma non ancora di un contratto per leggere e applicare il piano produttivo.

L’adattatore AI prevede due endpoint lato ProgreMES:

- `GET /api/workspace/ai/planning/context`: restituisce ordini di produzione, operazioni, risorse, capacità, calendari, materiali e vincoli autorizzati.
- `POST /api/workspace/ai/planning/apply`: riceve una proposta già approvata e restituisce l’esito applicativo.

Il contesto include anche `timeLearning.candidates`: proposte deterministiche basate su almeno tre produzioni concluse della stessa versione di formula, tempi netti con fermate escluse, lotti comparabili e variabilità controllata. Una verifica periodica in background genera le nuove proposte senza duplicarle. Le proposte compaiono nella sezione **AUTOPROGRAMMAZIONE**, con un contatore delle decisioni pendenti; non interrompono né aprono automaticamente la chat. L’assistente non modifica mai lo standard da solo: richiede l’approvazione e, dopo l’applicazione, ProgreMES ricalcola soltanto le lavorazioni non ancora avviate.

Lo stesso endpoint espone in sola lettura l’orizzonte del piano, gli ordini di produzione, le operazioni pianificate e il carico aggregato di ogni Station/impianto (`scheduledMinutes`, capacità disponibile e utilizzo). Questo consente richieste come “quale Station ha il maggior carico di lavoro?” usando dati ProgreMES correnti.

Entrambi accettano `X-Workspace-Secret`. Dopo la pubblicazione e il collaudo dell’endpoint ProgreMES impostare `PROGREMES_AI_PLANNING_ENABLED=true`; se resta `false`, le simulazioni funzionano ma l’approvazione viene registrata come `connettore_richiesto` senza modificare ProgreMES.

La sequenza operativa completa è descritta in `docs/AUTOPROGRAMMAZIONE_PRODUZIONE.md`.
