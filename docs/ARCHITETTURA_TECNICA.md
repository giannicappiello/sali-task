# Architettura tecnica — sali-task

## Panoramica

Sali-task è una SPA React 19 costruita con Vite 8 e distribuita su Vercel. Il client usa React Router per i moduli lazy-loaded, Supabase per autenticazione, dati e storage e API serverless Vercel per le operazioni Mexal che richiedono segreti. La PWA è configurata con `vite-plugin-pwa`.

## Front-end e navigazione

- `src/main.jsx` inizializza `BrowserRouter`, `StrictMode` e l'applicazione.
- `src/App.jsx` definisce il perimetro autenticato (`ProtectedRoute` + `Layout`) e carica in lazy loading i moduli Attività, Gestione Farmacie, Ordini e Integrazioni.
- `Layout` contiene menu, titolo contestuale, presenza e notifiche. La navigazione principale è filtrata da permessi e dalle abilitazioni in `integrazioni_utenti`.
- `Home` è la dashboard di accesso rapido ai moduli; mostra Integrazioni soltanto agli amministratori.
- Il modulo Attività raggruppa dashboard, planning, progetti, reminder e analisi; gli altri moduli principali sono Prodotti, Documenti, Messaggi, Team e Impostazioni.

## Autenticazione e autorizzazione

`AuthContext` usa Supabase Auth (`getSession`, `onAuthStateChange`, accesso con password) e collega ogni utente Auth a `utenti`. Carica ruolo, reparti e permessi dal grafo `utenti → ruoli → permessi_ruolo → permessi`; mantiene inoltre `ultimo_accesso` e `last_seen`.

I permessi sono valutati con `hasPermission`; gli amministratori sono riconosciuti per livello/nome ruolo. I moduli Gestione Farmacie e Ordini aggiungono un secondo livello di abilitazione tramite `integrazioni_utenti`. Le API amministrative e la sincronizzazione delle serie ripetono la verifica server-side del JWT e del ruolo, quindi non dipendono dal solo controllo UI.

## Moduli di dominio

### Gestione Ordini

`OrdersModule` espone Dashboard, Clienti, elenco Ordini, Nuovo ordine, dettaglio e Materiali. `useOrdersAccess` distingue admin, backoffice, area manager e agente, limitando clienti e ordini agli agenti visibili. Il motore prezzi (`priceEngine`) applica listini, sconti, particolarità e regole di pagamento; `orderFulfillment` invia gli ordini a Mexal e genera PDF; `orderSync` gestisce sincronizzazioni automatiche in background di prodotti, clienti e giacenze. Il pulsante di sincronizzazione manuale non è più presente nelle liste Prodotti e Clienti; i flussi automatici restano invariati.

### Gestione Farmacie (Beauty Days)

`PharmacyModule` ottiene il contesto dalla Edge Function `report-giornate-api`, costruisce un utente compatibile con le schermate legacy e limita le sezioni autorizzate. Include dashboard KPI, aperture/contatti, giornate, analisi, prodotti, farmacie e utenti. I servizi `reportSupabase` e le utility dashboard incapsulano accesso ai dati, filtri ed elaborazioni.

### Integrazioni

L'area amministrativa `IntegrationsModule` contiene il catalogo delle integrazioni e la console Mexal. La console monitora run, log e conteggi delle condizioni commerciali. La configurazione delle **Serie documenti Mexal** è collocata in questa area, in `Integrazioni → Serie documenti Mexal`, separata dagli Accessi Ordini.

## Database Supabase e migrazioni presenti

Il repository contiene migrazioni incrementali degli sprint 2B–3.1; esse presuppongono uno schema base già esistente per utenti, ruoli, ordini e cache Mexal.

| Migrazione | Effetto |
| --- | --- |
| `20260718195500_sprint_2b_commercial_sync_hardening.sql` | Indici per run di sync e view `v_ordini_condizioni_commerciali_conteggi`. |
| `20260718213000_sprint_2c_price_engine_audit.sql` | Audit del calcolo commerciale sulle righe ordine e view di lettura. |
| `20260718235500_fix_categorie_sconto_ordini.sql` | Corregge categorie sconto dalle cache e abilita lettura RLS delle condizioni commerciali. |
| `20260719090000_sprint_2d_commercial_engine.sql` | Consolida policy RLS e indici di lookup del motore commerciale. |
| `20260719130000_sprint_3_mexal_order_flow.sql` | Stato di invio Mexal su `ordini_testate` e log `ordini_sync_mexal_log`. |
| `20260719170000_sprint_3_1_document_series.sql` | Tabelle `ordini_serie_documenti` e `ordini_configurazione_documenti`, RLS e policy di gestione amministrativa. |

Le principali tabelle applicative interrogate sono: `utenti`, `ruoli`, `reparti`, `permessi`, `permessi_ruolo`, `integrazioni_utenti`, `notifiche`, le entità attività/progetti, `prodotti`, le cache `ordini_clienti_cache`/`ordini_prodotti_cache`, `ordini_testate`, `ordini_righe`, le condizioni commerciali, i run/errori di sync e le tabelle delle serie documento.

## Edge Functions Supabase

| Funzione | Responsabilità |
| --- | --- |
| `admin-manage-user` | CRUD utenti Supabase Auth e profili Workspace; propaga la cancellazione al sistema Beauty Days quando configurato. |
| `mexal-sync-products` | Sincronizza catalogo Mexal, gerarchie, disponibilità e immagini nello storage Supabase. |
| `mexal-sync-commercial-conditions` | Importa matrice sconti, particolarità e, se configurate, regole di pagamento; registra run, dettagli ed errori. |
| `report-giornate-api` | Espone contesto e operazioni protette per Gestione Farmacie verso il database Beauty Days. |

## Integrazioni Mexal e API Vercel

Le API Vercel sono `sync-products`, `sync-clients`, `sync-commercial-conditions`, `submit-order`, `sync-document-series` e il cron notturno `mexal-products`. Le operazioni usano la service role Supabase solo sul server, verificano il bearer token dell'utente quando richiesto e parlano con Mexal tramite WebAPI.

L'autenticazione WebAPI standardizzata è `Authorization: Passepartout <base64(username:password)>`, con `Dominio=<MEXAL_DOMINIO>` opzionale, e header `Coordinate-Gestionale`. Per le serie documenti l'URL viene ora normalizzato a una sola base `/webapi/risorse`, sia che `MEXAL_BASE_URL` contenga già il prefisso sia che contenga l'host; si evita così il doppio prefisso che causava richieste non valide.

## Dipendenze

Dipendenze runtime: React/React DOM, React Router, Supabase JS, Lucide, jsPDF + AutoTable e SheetJS (`xlsx`). Sviluppo/build: Vite, plugin React, ESLint e plugin PWA. Il runtime Node dichiarato è la serie 24.

## Criticità tecniche rilevate

- Le migrazioni versionate non includono lo schema iniziale completo: una nuova installazione necessita della baseline esterna prima di applicarle.
- Esiste una copia legacy/non referenziata di una parte del modulo Ordini in `src/modules/modules/orders`; il routing usa `src/modules/orders`.
- Le API Mexal disabilitano la verifica TLS (`rejectUnauthorized: false` oppure equivalente) per compatibilità con installazioni ERP: va mantenuta solo su rete affidabile e sostituita con certificati validi quando possibile.

## Sprint 2 — robustezza sincronizzazioni Mexal

Le card **Prodotti** e **Clienti** della console Mexal sono operative esclusivamente per amministratori. Leggono i contatori reali rispettivamente da `prodotti` (`attivo_mexal` e `mostra_in_app`) e `ordini_clienti_cache` (`attivo_mexal`), e mostrano l'ultima run registrata.

`20260719190000_mexal_incremental_sync_runs.sql` aggiunge `mexal_sync_runs`, con i contatori e gli stati delle sincronizzazioni Prodotti e Clienti. La sincronizzazione prodotti Vercel è incrementale: usa `codice_mexal` come chiave logica, salva lotto per lotto e non esegue aggiornamenti globali all'avvio. Solo una run completa, con tutti i lotti registrati e senza errori, riconcilia i prodotti Mexal non aggiornati dopo `started_at`; una run fallita lascia quindi valida la sincronizzazione precedente.

Per le serie documento, `sync-document-series` normalizza `MEXAL_BASE_URL` fino a `/webapi/risorse`, usa `Authorization: Passepartout <base64(username:password)>` con `Dominio=<MEXAL_DOMINIO>` opzionale e `Coordinate-Gestionale`. Non disattiva più tutte le serie prima dell'upsert: restituisce JSON coerente con contatori e dettagli diagnostici non sensibili.

Per la procedura operativa e gli scenari di interruzione vedere [Sincronizzazione prodotti Mexal](mexal/SINCRONIZZAZIONE_PRODOTTI.md).
