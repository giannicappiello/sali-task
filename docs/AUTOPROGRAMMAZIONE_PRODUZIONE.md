# Attivazione AUTOPROGRAMMAZIONE

## Componenti predisposti

- ProgreMES espone `GET /api/workspace/ai/planning/context` in sola lettura, protetto da `X-Workspace-Secret`.
- Il contesto contiene orizzonte, Station/impianti, capacità, carico aggregato, ordini, operazioni pianificate e candidati di revisione tempi.
- ProgreMES espone `POST /api/workspace/ai/planning/apply`, sempre protetto dallo stesso segreto, per applicare esclusivamente proposte approvate e non obsolete.
- Workspace esegue ogni notte la verifica automatica e salva una sola proposta per la stessa evidenza.
- La sezione **AUTOPROGRAMMAZIONE** mostra il numero delle proposte in bozza e consente Approva/Rifiuta agli utenti autorizzati.

## Ordine di pubblicazione

1. Pubblicare e riavviare ProgreMES sul server MES conservando il suo `appsettings.json`.
2. Verificare dal server, senza stampare il valore del segreto, che il GET restituisca HTTP 200 e i nodi `resources`, `workloadSummary`, `productionOrders`, `operations`, `capacity` e `timeLearning`.
3. Pubblicare Workspace su Vercel.
4. Verificare che in produzione esistano `PROGREMES_URL`, `PROGREMES_INTEGRATION_SECRET` e `CRON_SECRET`.
5. Solo dopo il collaudo del GET e del POST impostare `PROGREMES_AI_PLANNING_ENABLED=true` in Production e ridistribuire Workspace.
6. Eseguire una verifica del processo notturno `/api/cron/mexal-dispatcher`, che include anche `autoplanning`, controllando soltanto esito e conteggi e mai i segreti.

## Collaudo funzionale

- Chiedere all’Assistente: “Quale Station ha il maggior carico di lavoro?”. La risposta deve indicare il criterio usato, normalmente i minuti pianificati nell’orizzonte.
- Con almeno tre consuntivi stabili della stessa versione di formula, verificare la comparsa del contatore su **AUTOPROGRAMMAZIONE**.
- Rifiutare una proposta di prova e verificare che non venga ricreata sulla stessa evidenza.
- Approvare una proposta autorizzata e verificare che cambino soltanto il tempo della versione interessata e il piano degli ordini non ancora avviati.
