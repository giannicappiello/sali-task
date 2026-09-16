# Modulo HR

## Attivazione

Applicare `supabase/migrations/20260916180000_workspace_hr.sql` al database Workspace prima di distribuire il frontend. La migrazione crea il reparto **Human Resources**, registra il modulo `/hr` nel menu e la schermata `/settings/hr` nelle Impostazioni. Non assegna automaticamente gli utenti esistenti al nuovo reparto (eventuali attribuzioni di un reparto Human Resources già presente vengono conservate).

1. **Utenti e accessi → Organizzazione → Reparti di appartenenza:** attribuire Human Resources agli utenti dipendenti, mantenendo gli eventuali reparti operativi.
2. **Impostazioni → Configurazioni HR → Sedi e timbrature:** inserire coordinate reali della sede. Valori iniziali: check-in 30 m, checkout di supporto 100 m.
3. **Schede dipendente:** impostare matricola, gestore HR se necessario e una versione degli accordi con decorrenza da oggi o futura: sede, orario, giorni, pausa, ore settimanali, compenso e periodicità, tariffa e maggiorazione straordinari oppure banca ore.
4. Il calendario genera i turni dagli accordi; i gestori HR possono assegnare turni specifici (anche notturni), chiusure e festività e gestire le richieste.

## Autorizzazioni

- **Dipendente:** proprie timbrature, turni, richieste di ferie, permessi, straordinari e correzioni delle uscite mancanti.
- **Gestore HR:** gestione operativa del personale, turni, approvazioni e correzioni con motivazione. Non può approvare le proprie richieste.
- **Admin Workspace:** configurazioni, accordi, dati economici e storico. Il livello operativo “amministrazione” di un altro ruolo non concede questo accesso.

L'appartenenza HR è un reparto reale del catalogo `reparti`, contrassegnato da `workspace_hr`. Le sue attribuzioni sono conservate in `workspace_hr_members` e combinate nella schermata Utenti e accessi. Non sono copiate in `utenti_reparti`, che determina anche i permessi su chat e dati commerciali. La funzione di salvataggio esistente aggiorna entrambe le attribuzioni atomicamente. La revoca del reparto disabilita il modulo HR senza eliminare lo storico delle presenze.

Contratti e compensi sono conservati separatamente. Le tabelle non consentono letture o scritture dirette dal client (solo l'elenco delle attribuzioni HR è leggibile dagli admin); le RPC verificano l'identità e i permessi ad ogni operazione. `workspace_hr_snapshot(..., false)` non restituisce contratti né importi. `p_config=true` richiede un admin anche in caso di chiamata diretta.

## Timbrature sulla PWA

Il check-in usa l'orario del server e una posizione rilevata da non oltre 30 secondi: distanza più margine di precisione deve rientrare nel raggio. Le pressioni ripetute sono idempotenti; è ammessa una sola presenza aperta per dipendente. Il checkout manuale funziona senza GPS, con connessione al server.

Il controllo di supporto resta montato anche navigando in altre schermate Workspace, solo durante una presenza aperta. Richiede due rilevazioni affidabili oltre la soglia, distanziate di almeno 30 secondi; un'interruzione di oltre 90 secondi azzera il candidato all'uscita. Il rientro nell'area azzera la conferma. Le coordinate della sede e le soglie sono fissate per la presenza al momento del check-in.

Il browser può sospendere la PWA a schermo spento: nessuna garanzia di checkout automatico in background. Posizione o connessione mancanti non costituiscono un'uscita e non producono timbrature offline fittizie. Dopo il checkout il watcher viene rimosso. Vengono conservati distanze e precisione delle timbrature, non un percorso continuo.

Le presenze aperte oltre la fine turno più 30 minuti vengono segnalate; senza turno, dopo 12 ore. La segnalazione non modifica l'orario. Il dipendente può richiedere una correzione, oppure un altro gestore HR può registrarla con motivazione. Gli orari sono riferiti a Europe/Rome anche se il dispositivo usa un altro fuso.

## Economia e calendario

Le nuove versioni degli accordi non sovrascrivono le precedenti. La vista dipendente non mostra ore pattuite settimanali, compenso o regole economiche. Mostra i turni operativi.

Il riepilogo economico admin valorizza lo straordinario **autorizzato** secondo tariffa e maggiorazione vigenti alla data della richiesta. È un riepilogo da confrontare con le timbrature effettive, non un cedolino né un pagamento automatico. Ferie e permessi approvati sono visibili nel calendario; chiusure/festività si configurano nel calendario aziendale. Un turno esplicito può derogare a una chiusura.

## Verifica locale

I test SQL usano PostgreSQL WASM isolato; non accedono alla produzione e non richiedono segreti. Installazione runtime di test senza modificare le dipendenze applicative:

```powershell
npm install --prefix .tmp/hr-test-runtime --no-save --package-lock=false --ignore-scripts @electric-sql/pglite@0.5.8
node --test server/hr.test.js server/hr-time.test.js server/department-members.test.js
npx eslint src/modules/hr/*.js src/modules/hr/*.jsx
npm run build
```

Verificati: isolamento dipendente/gestore/admin, attribuzione/revoca reparto, tabelle private, precisione e freschezza GPS, idempotenza, checkout manuale e automatico, turni notturni, chiusure, correzioni motivate, richieste e divieto di autoapprovazione. Verifica browser locale del componente reale con dati sintetici per desktop e smartphone, incluse le viste gestore e configurazioni admin.

Nota sul repository: il test legacy `test/user-department-assignment.test.mjs` contiene già in HEAD un'aspettativa non soddisfatta sul vecchio `Settings.jsx` (rimozione ruolo). Le attribuzioni correnti di `AccessUsers.jsx` sono verificate dai test SQL HR.
