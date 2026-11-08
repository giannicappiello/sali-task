# Audit copertura Second Brain — 8 novembre 2026

## Esito e confini

Richiesta: ampliare le letture aziendali autorizzate, con priorità alla schermata **Consuntivi produzioni** (nome confermato dal richiedente). La copertura completa di tutti gli archivi Workspace/MES **non è attestabile**: il contratto pubblico espone solo risorse specifiche e diversi servizi non hanno un mapping dei record per ambiti propri/team/cliente. Nessun ruolo, grant SQL, policy RLS o permesso è modificato. Nessuna migrazione necessaria.

Codice esaminato: Workspace `a0144cf0304d41711a12767dafd74d0d44a50254`; MES `f1b14dc` da `origin/main`. Il deploy Workspace di produzione osservato è `dpl_7FT5smu2ykA6nyRKnXWVNTFYwyMX`, READY sul commit `a0144cf0`. Non equivale al rilascio delle modifiche di questo audit.

## Evidenze live

- BRAIN_STATUS: collegamento attivo dell'identità personale Workspace del richiedente; livello AI conferma, nessuna generazione esterna. Non implica diritti di scrittura generali.
- MES_READ status: contratto v1 in sola lettura, moduli clients, suppliers, articles, orders, productionSummary, inventory, planning attivi. È disponibilità di moduli, non prova di copertura record.
- PRODUCTION_CONSUNTIVI_READ: archivio di **115 record**, pagine 50 + 50 + 15 con lo stesso snapshot, 115 ID distinti, `nextOffset=null`. Sono i record filtrati ufficiali delle produzioni concluse, non tutte le produzioni MES. Riepiloghi globali letti una sola volta, mai sommati fra pagine.
- Il filtro 1–8 novembre restituisce zero record per la regola ufficiale avvio/data ordine; non dimostra assenza di attività in novembre.
- I record possono avere `provisional`, `reconstructed`, `costPartial` e avvisi di prezzi/tempi ricostruiti. Conservati senza trasformare null in zero.
- MES_RESOURCE_COSTS restituisce ancora la chiave tecnica `costoFissoProduzione`. Per STATION è il margine auspicato per lavorazione, non un costo. Nessun valore o hash alterato.
- Il catalogo diretto disponibile in questa sessione espone Consuntivi e logistica; il catalogo dell'app collegata osservato non li include. Il disallineamento è verificato fra cataloghi, la causa esatta (cache, versione o identità del collegamento) non è determinata.

Non sono stati esportati archivi aziendali, nomi operatori o dati economici nei file di audit. La paginazione live verifica il servizio già distribuito; non prova il funzionamento remoto delle nuove capacità prima del loro rilascio.

## Copertura e interventi

| Area | Contratto disponibile | Limite / intervento |
|---|---|---|
| Consuntivi produzioni | PRODUCTION_CONSUNTIVI_READ | Riusa `handleProductionCosts(..., {readOnly:true})`, `displayRecord`, ricerca e riepiloghi UI. Aggiunti quantità fatturata, confronti con margine obiettivo, subtotali disponibili e spiegazioni delle basi tempo. Nessun nuovo motore di calcolo. |
| Ore del turno | Campi ufficiali delle fasi | `personHoursInShifts`: ore/uomo entro turno; `actualStandardShiftHours`: base economica turni × 8; `actualHours`: ore macchina. Sono misure diverse: nessuna conversione automatica dagli estremi temporali. |
| Anagrafiche, produzione, materiali, magazzino, planning MES | MES_READ e strumenti di dominio | Esposti anche i filtri esistenti `active`, `updatedAfter`, `from`, `to`, `status`. Validazione per risorsa invariata: parametri incompatibili rifiutati. |
| Prodotti, documenti | WORKSPACE_SEARCH | Proiezioni fisse paginabili; i documenti sono metadati, non testo integrale/allegati. |
| Progetti, task, riferimenti CRM | BUSINESS_SEARCH | JWT personale e RLS, proiezioni fisse. |
| Rendicontazione costi task/progetti | Nuovo CRM_WORKSPACE_COSTS_READ | Archivio `crm_workspace_costs`, JWT personale, permesso schermata, filtri e pagine da 50. Restituisce importi registrati senza rifare ore × tariffa. Riferimenti diretti projectId/phaseId, nessuna aggregazione autonoma. |
| Clienti e KPI commerciali | CRM_CUSTOMER_SEARCH / COMMERCIAL_REPORT_DATA | RPC ufficiali; PR/PH e MyPharma distinti. |
| Ordini, e-commerce | WORKSPACE_ORDERS_SEARCH e COMMERCE_* | Cache e diagnostica, non KPI contabili o prova di esistenza sul provider. Nessuna importazione. |
| HR, calendario | HR_READ / COMPANY_CALENDAR_READ | Permessi del servizio; accordi economici soggetti al vincolo admin esistente. Nessun ampliamento dei diritti. |
| Fatture / riordini | SALES_INVOICES_READ / CUSTOMER_REORDERS_READ | Contesti riepilogativi con dettagli limitati. Non equivalgono all'intero archivio o alla contabilità generale. |
| Logistica | LOGISTICS_PREPARATIONS_READ / LOGISTICS_PREPARATION_REGISTER_READ | Servizi esistenti, filtri e registri; propri/team non mappati restano bloccati. |
| Inventario di copertura | Nuovo BRAIN_DATA_COVERAGE | Elenca letture e filtri del catalogo personale con lacune; strumento esposto non significa lettura riuscita o permesso generale. |

## Sicurezza e semantica

1. Le letture amministrative ora rispettano anche un eventuale `allowed_modules` esplicito. Nessun cambiamento ai ruoli o alla funzione che assegna le capacità.
2. Il proxy MES usa una connessione condivisa senza mapping dei record per utente. Nel connettore le risorse aziendali globali sono bloccate per ambiti propri/team/cliente e quando il servizio di scope fallisce. Status/diagnostica mantengono le rispettive verifiche esistenti. Nessun tentativo di bypass dopo un diniego.
3. Consuntivi conserva il servizio ufficiale, che ricontrolla schermata e perimetro cliente; ambiti propri/team non supportati restano rifiutati prima della lettura privilegiata.
4. `costoFissoProduzione` resta invariato per compatibilità e hash. La descrizione chiarisce il significato STATION: margine di guadagno auspicato per singola lavorazione, indipendente dai turni. I totali `plannedWithObjective`/`actualWithObjective` già includono l'obiettivo: nessun secondo addebito. Calcoli UI, snapshot e storici invariati.
5. Proposte, firme, concorrenza, BRAIN_REVIEW e conferma umana separata non sono modificati. Le nuove capacità hanno effetto `read`. Il log tecnico delle chiamate esistente rimane attivo.

## Gap da chiudere per una copertura completa

### Mexal e memoria

La connessione API Mexal esistente alimenta già archivi Workspace letti da Second Brain (ordini, fatture e dati commerciali). Non è necessario duplicare credenziali o aggiungere un secondo motore di calcolo. Nuove letture dirette devono passare da servizi ufficiali autenticati, con filtri e perimetro personale; la sola connessione tecnica non concede accesso a tutte le entità Mexal.

`MEMORY_SAVE` è già implementato per conservare fatti, analisi o decisioni con fonte, data e visibilità, mediante proposta e conferma umana in BRAIN_REVIEW. Non è una sincronizzazione automatica degli archivi Mexal e non rende una copia storica dato corrente. Importazioni e aggiornamenti persistiti sono scritture: non sono inclusi nell'ampliamento in sola lettura. Per una futura sincronizzazione automatica occorre definire esplicitamente entità, frequenza, retention, deduplicazione e autorizzazioni senza ampliare i ruoli.

### Lacune residue

- Mapping record per ambiti propri/team/cliente sul contratto MES condiviso. Richiede un servizio ufficiale con filtri verificabili; non basta il modulo abilitato. Non concedere nuovi permessi per aggirare il problema.
- Alcune letture di formula/macchina/piano sono ancora subordinate ai permessi operativi dei servizi esistenti. Separare lettura e proposta richiede verifiche MES dedicate; questo audit non allarga quei permessi.
- Contabilità generale, banche, scadenziari, qualità completa/non conformità e manutenzione: manca una lettura dedicata completa verificata. Servono adattatori espliciti per fonti e autorizzazioni esistenti.
- Documenti e allegati: copertura del contenuto integrale non verificata; non esporre archivi NAS o memorie personali altrui tramite un lettore generico.
- Il database RLS di produzione non è stato collaudato impersonando altri ruoli: prove negative locali e sessione corrente non attestano l'accesso degli altri utenti.
- Dopo il rilascio aggiornare il catalogo dell'app collegata e confrontarlo con il connettore diretto usando la stessa identità. Non dichiarare il nuovo schema visibile finché non è verificato.

## Verifica

- 93 test Node superati: connettore, conferma umana, OAuth, catalogo, scope, accesso alle schermate, paginazione, parità consuntivi, assenza di scritture dati nei servizi di analisi, validazione filtri e propagazione errori.
- Build Vite/PWA riuscita con `--configLoader runner`; il caricatore standard non può scrivere nella directory temporanea delle dipendenze condivise in questa sandbox.
- Lint mirato riuscito. Nessuna modifica a schema SQL o database.

Riferimento di controllo RLS: [documentazione ufficiale Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security). Le prove effettive sono quelle del codice e dei test, non la sola conformità dichiarata alla documentazione.
