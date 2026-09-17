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

### Verifica rete aziendale (PC e smartphone)

Dal rilascio `20260917140000`, entrata e uscita **manuali** richiedono un IP pubblico autorizzato per la sede. Il GPS non sostituisce questo controllo. Lo smartphone deve utilizzare il Wi-Fi aziendale; la rete mobile viene rifiutata se il suo IP non corrisponde. Il controllo usa l’header di ingresso Vercel `x-vercel-forwarded-for`, validato sul server, e non accetta IP o identità dichiarati nel corpo della richiesta.

Gli admin gestiscono fino a 20 indirizzi IPv4/IPv6 singoli in Sedi e timbrature. “Usa IP attuale” rileva la connessione e la aggiunge al modulo: serve poi Salva. Usarlo solo dalla sede e senza VPN. Indirizzi locali, intervalli e IP non pubblici vengono rifiutati. Le sedi esistenti partono con elenco vuoto e le timbrature restano bloccate finché l’admin configura l’IP. Nessun indirizzo è stato dedotto dagli IP privati di Station 7 o dal PC remoto.

La API `/api/workspace/hr` convalida il token Supabase e invoca una RPC riservata al `service_role`. Le RPC GPS precedenti non permettono più entrate/uscite manuali dirette, anche da client obsoleti. Sede assegnata e appartenenza attiva vengono verificate nel database; l’uscita usa la sede della presenza aperta e gli IP attualmente autorizzati. La cronologia conserva IP d’ingresso/uscita senza inventare distanze GPS. La funzione server mantiene idempotenza e blocco delle presenze duplicate.

Il checkout automatico GPS già concordato resta un’eccezione di sicurezza; correzioni motivate e approvazioni HR restano disponibili. Una VPN che esca attraverso la sede o un PC aziendale controllato da remoto non sono distinguibili dalla sola verifica IP. Il controllo garantisce l’origine di rete, non la presenza fisica in questi casi.

La descrizione GPS seguente documenta la logica preesistente e il supporto automatico; il vincolo di rete sopra sostituisce il precedente requisito GPS per l’entrata manuale.

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

## Accordi a compilazione libera
La decorrenza può essere pregressa. Tutti gli altri campi possono essere vuoti o descrittivi: il testo originale resta riservato agli admin. Le colonne operative contengono solo valori riconosciuti; per generare i turni servono sede configurata, giorni numerici (1=lunedì), orari HH:MM e pausa valida. Gli importi con tariffa o maggiorazione mancanti risultano da definire. La pagina Configurazioni HR si aggiorna solo all’apertura, al cambio periodo, dopo il salvataggio o con Aggiorna: nessun polling o aggiornamento al ritorno alla finestra.

## Destinatari ed export presenze
Configurazioni HR contiene Destinatari richieste (elenco aziendale multiplo di utenti attivi) ed Esporta presenze. I destinatari ricevono una notifica per ogni nuova richiesta, possono valutarla una sola volta e non possono autoapprovarsi. Il ruolo di destinatario consente la consultazione delle richieste senza accesso agli accordi economici, alle presenze altrui o alla gestione dei turni. Non rende l’utente un dipendente né abilita il pulsante timbratura.
L’Excel mensile include dettaglio giornaliero, riepilogo, richieste e legenda: intervalli di presenza, ore dei turni, pause previste, ferie/permessi approvati, straordinari approvati e anomalie. I conteggi sono un supporto per il consulente e mantengono separate quantità rilevate e quantità retribuibili. Non vengono inseriti compensi o note libere delle richieste. Il codice catalogo human_resources è riconosciuto insieme al codice applicativo hr.

## Schede e foglio mensile
Le configurazioni presentano navigazione, periodo e azioni sulla stessa riga quando lo spazio lo permette. Dipendenti HR e scheda selezionata usano card azzurre della stessa altezza con scorrimento verticale indipendente; su smartphone si dispongono in colonna. Tutti gli elenchi HR e l’export seguono l’ordine alfabetico dei nomi visualizzati.

Modifica scheda apre un unico popup con matricola, ruolo operativo e accordi. `workspace_hr_save_employee` salva atomicamente, richiede un admin, evita duplicati sui tentativi ripetuti e rileva modifiche concorrenti agli accordi. Una modifica alla sola scheda non crea contratti. Una modifica agli accordi aggiunge una versione mantenendo lo storico e richiede la decorrenza, anche pregressa.

Il primo foglio Excel è una griglia mensile con riepiloghi a sinistra: giorni di presenza, ferie, assenze da verificare, permessi, ore straordinarie feriali e festive. F indica ferie approvate, P permessi approvati, A copertura mancante del turno passato da verificare, PR presenza e ? uscita mancante. I numeri giornalieri indicano ore straordinarie decimali. Le giornate parziali possono comparire in più conteggi; il dettaglio giornaliero conserva le quantità orarie.

Straordinario feriale: ore approvate lunedì–venerdì più presenza effettiva del sabato, escludendo festività. Straordinario festivo: presenza effettiva domenicale o nelle festività nazionali; una festività di sabato si conta solo come festivo. Calendario gregoriano con Pasqua/Pasquetta e San Francesco dal 2026 (legge 151/2025); feste patronali locali escluse. Le uscite mancanti non producono ore fittizie: i totali basati sulle presenze incomplete restano da verificare. Le pause non timbrate non vengono sottratte dalle presenze rilevate.

Il file mantiene colori, bordi, intestazioni bloccate e stampa A3 orizzontale. SheetJS genera i dati, poi `hrWorkbookStyles.js` applica gli stili OOXML tramite la dipendenza ZIP già esistente. Nessuna nuova dipendenza applicativa.
