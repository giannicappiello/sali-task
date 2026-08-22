# Fase 1B - client read-only ProgreMES

## Confine architetturale

Il browser Workspace chiama esclusivamente endpoint same-origin sotto
`/api/progremes/*`. Un rewrite Vercel inoltra le richieste alla funzione Node
consolidata `api/mexal/automation.js`, che:

1. valida la sessione Supabase dell'utente;
2. verifica che il profilo sia attivo e abbia accesso al modulo Workspace
   `progremes` tramite `workspace_module_enabled_for_user`;
3. valida risorsa, paginazione e filtri con allow-list esplicite;
4. chiama l'API MES aggiungendo `X-Workspace-Secret` solo server-side;
5. valida e proietta la risposta sui soli DTO pubblici previsti.

Non sono presenti operazioni `POST`, `PUT`, `PATCH` o `DELETE` verso
ProgreMES. Anche `suppliers` appartiene all'allow-list read-only.

## Configurazione Vercel

La Fase 1B riusa esclusivamente le variabili server-side gia usate da catalogo,
SSO e integrazione AI:

- `PROGREMES_URL`: origine ProgreMES condivisa, senza il path della singola API;
- `PROGREMES_INTEGRATION_SECRET`: secret machine-to-machine condiviso;
- `PROGREMES_API_TIMEOUT_MS`: opzionale, default `10000`, intervallo
  consentito `1000-30000` millisecondi.

La base read-only viene derivata come
`${PROGREMES_URL}/api/workspace/v1/`. Non servono nuove variabili o modifiche a
Vercel. Le variabili restano esclusivamente server-side: non usare il prefisso
`VITE_`, non copiarne i valori in file versionati e non inserirli nei log. In
assenza dell'URL o del secret condiviso il client rifiuta la richiesta.

## Endpoint interni predisposti

Tutti gli endpoint richiedono `Authorization: Bearer <sessione Workspace>`.

| Endpoint Workspace | Endpoint MES | Filtri consentiti |
| --- | --- | --- |
| `GET /api/progremes/status` | `/status` | nessuno |
| `GET /api/progremes/clients` | `/clients` | `page`, `pageSize`, `search`, `active`, `updatedAfter` |
| `GET /api/progremes/suppliers` | `/suppliers` | `page`, `pageSize`, `search`, `active`, `updatedAfter` |
| `GET /api/progremes/articles` | `/articles` | `page`, `pageSize`, `search`, `active`, `updatedAfter` |
| `GET /api/progremes/production-orders` | `/production-orders` | `page`, `pageSize`, `search`, `status`, `from`, `to` |
| `GET /api/progremes/production-progress` | `/production-progress` | `page`, `pageSize`, `search`, `status`, `from`, `to` |
| `GET /api/progremes/inventory` | `/inventory` | `page`, `pageSize`, `search`, `status`, `updatedAfter` |
| `GET /api/progremes/planning` | `/planning` | `page`, `pageSize`, `search`, `status`, `from`, `to` |

`pageSize` e limitato a 500, `page` a 100000, `search` a 200 caratteri e
`status` a 64 caratteri. Parametri sconosciuti, ripetuti o non validi vengono
rifiutati. Il browser non puo specificare URL o path MES arbitrari.

L'endpoint anagrafico `/articles` mantiene l'esclusione applicativa MES degli
articoli il cui codice inizia per `FP`. I codici `FP*` possono invece comparire
nei dati operativi di ordini, avanzamento e planning.

## Toolchain e controlli statici

La Fase 1B resta allineata alla toolchain JavaScript gia presente e non aggiunge
dipendenze dirette da TypeScript o `@types/node`. Il controllo usa:

- annotazioni JSDoc `@ts-check` nei moduli server;
- dichiarazioni DTO in `server/progremes-readonly-types.d.ts`;
- ESLint mirato tramite `pnpm lint:progremes`;
- import e test runtime Node dei moduli, oltre alla build Vite completa.

Il file `.d.ts` documenta il contratto per i consumer, ma non viene compilato da
un compilatore TypeScript aggiuntivo al progetto.

## Baseline test globale

Il confronto isolato sul commit `b9edd2a` di `main` ha prodotto:

- `main`: 206 test, 188 superati, 18 falliti;
- branch Fase 1B: 236 test, 218 superati, 18 falliti.

I nomi delle 18 failure sono identici nei due ambienti. La Fase 1B aggiunge 30
test tutti superati e non introduce nuove failure nella suite globale.

## Collegamento di rete

Il collegamento Workspace -> ProgreMES e gia operativo con questo percorso:

`https://mes.progredocumenti.it -> Cloudflare Tunnel -> localhost:5050 -> ProgreMES`

La Fase 1B usa lo stesso hostname e lo stesso secret gia impiegati dalle API di
catalogo moduli, SSO e pianificazione AI.

La verifica pubblica di `/api/workspace/v1/status` senza secret restituisce
`401`, confermando che l'origine richiede l'autenticazione machine-to-machine.

Questa modifica non installa o configura tunnel, Cloudflare, Vercel, DNS o
firewall e non aggiunge ulteriori header di rete: continua a inviare soltanto
`X-Workspace-Secret` dal backend Workspace.
