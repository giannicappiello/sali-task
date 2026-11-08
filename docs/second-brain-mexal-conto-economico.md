# MEXAL_CONTO_ECONOMICO_READ

Richiesta del titolare: conto economico Progre da soli dati Mexal, senza MES.
Progetto verificato: `giannicappiello/sali-task`, produzione `workspace.progre.it`.
Base di implementazione: `5bfaf8a7`, comprensiva delle funzioni finanziarie già rilasciate.

## Contratto verificato l'8 novembre 2026

BRAIN_STATUS collegato con identità personale Workspace; letture live riuscite di
MEXAL_FINANCE_CATALOG (GRE/2026), piano conti e prima nota. Catalogo privo di endpoint
GET bilancio o saldi. Piano conti letto integralmente: 717 conti, codici UE correnti
per conti economici e patrimoniali. La riuscita vale per questo utente, non per altri.

Solo GET `/help`, `/conti`, `/prima-nota/righe`, `/prima-nota` tramite
`buildMexalClient` e credenziali server esistenti. Nessuna API key aggiuntiva, scrittura
contabile, sincronizzazione, migrazione, memoria o modifica permessi. Rimane l'audit
tecnico delle chiamate Second Brain già previsto dal servizio.

La nuova azione riusa `canReadFinance` e `requireFinanceAdmin`: internal_data,
amministratore Workspace, verifica live `workspace_user_is_admin`, ambito `tutti`.
La revoca e gli errori bloccano prima di creare il client. Il catalogo personale
e il bridge MCP dinamico conservano i controlli originali. Non vengono concessi ruoli.

## Parametri

`year`, `from`, `to` facoltativi: inizialmente 2026-01-01–2026-10-31.
Se from è esplicito, può determinare l'anno; intervallo dentro un unico esercizio,
2000–2100, senza date future. Per anni diversi dal 2026 il termine predefinito è
31 dicembre: per l'anno corrente fornire un termine già trascorso.

Dettagli per conto: `limit` 1–100, `offset`, `snapshot`. Continuazioni richiedono
snapshot legato a identità, azienda, periodo e hash delle tre fonti; 409 su variazioni.
Ogni chiamata rilegge le fonti, non conserva cache finanziarie. Gli aggregati globali
non vanno sommati fra pagine dei dettagli.

## Significato dei valori

- `amount`: valore per competenza, attualmente **null** perché il contratto non
  attesta competenze, extracontabili e rettifiche complete. Vale per ricavi/costi,
  EBITDA, EBIT e ante imposte. Nessuna inferenza di margini ufficiali.
- `registeredAmount`: solo importi registrati per data registrazione, esposto quando
  tutte le fonti sono esaurite, testate e righe concordano, i giornali quadrano e ogni
  conto movimentato ha classificazione UE verificata. Altrimenti null.
- `observedClassifiedSubtotal`: somma diagnostica delle righe classificate lette;
  può essere parziale. Non è un conto economico completo. Nessun movimento di una
  categoria significa null, non zero; un conto movimentato con netto nullo resta zero.
- `registeredOperatingDifference`: sola differenza registrata A-B; non EBIT.
- `rimanenze`: saldi iniziale/finale e criterio sempre null; A2 e B11 mostrano solo
  eventuali variazioni registrate. Nessuna valorizzazione da costo ultimo o MES.
- `ammortamenti`: completezza non attestata; B10 conserva anche svalutazioni, senza
  rinominarle tutte ammortamenti. Nessun pro rata o estrapolazione annuale.
- Valuta non denominata dalle fonti: `currency.code=null`.

Associazioni dai soli `bil_34dir_ue_d/a`, normalizzati per confronto e conservati
originali nel dettaglio. Nessuna classificazione da nomi, prefissi conti o vecchi
codici CEE. Conti senza anagrafica/UE o codici non riconosciuti rimangono sconosciuti.
Conti patrimoniali e IVA esclusi dagli aggregati economici; IVA indetraibile già
contabilizzata a costo non viene sottratta nuovamente. Segni dare/avere originali,
storni e note credito conservati. Due associazioni usano il segno del netto del conto;
se una sola è valorizzata, viene conservata anche per gli storni.

AP/CH escluse, BA mantenuta come rettifica. Importi esatti a sei decimali, somme
intere senza floating point, nessun arrotondamento silenzioso.

## Completezza e riconciliazione

Paginazione tramite cursore ufficiale; stop su pagine/cursori ripetuti, errore,
formato non verificato, budget 200 secondi, 2.000 pagine o 1.000.000 righe per fonte.
Ogni stop resta visibile in `sources`, senza totali registrati completi.
Controlli di date, causali, identificativi, importi, anagrafiche duplicate, testate
duplicate/mancanti, testate senza righe, causali incoerenti, dare/avere per
data/progressivo. I dettagli mostrano ogni conto e la sua classificazione.

Lettura non transazionale. Hash e quadratura non provano completezza contabile né
assenza di righe duplicate bilanciate quando manca un identificativo di riga.
`complete=false` segnala che il conto economico per competenza non è attestato,
distinto da `recordedCoverageComplete` e `coverage.cursorsExhausted`.
Riconciliazione con bilancio ufficiale e scostamento ufficiale rimangono null.

## Gap e percorso ufficiale

Il manuale Mexal distingue prima nota, archivi extracontabili (anche ammortamenti)
e inclusione ratei/risconti/competenze nel bilancio di verifica. Questi dati non sono
coperti dalle risorse attualmente pubblicate. Serve una risorsa ufficiale di sola
lettura, con parametri di periodo e schema verificati, per attestare un risultato per
competenza. Nessun endpoint viene inventato. Se il catalogo pubblicherà nuove risorse
di bilancio/saldi, l'azione le segnalerà come candidate: occorrerà verificare e
implementare il relativo adattatore prima di usarne i valori. Nessun POST a programmi
contabili viene sostituito a una lettura.

Riferimenti primari:
- [Bilancio di verifica Mexal](https://www.edupass.it/manuali/manualistica-mexal/manuale-prodotto?a=manuale-prodotto/contabilita/stampe-contabili/bilanci/bilancio-di-verifica)
- [Saldi contabili e associazione codice UE](https://www.edupass.it/Resources/Edupass-Manuali/Manuali/pdf/pillole/Raccordo%20capitali.pdf)
- [Codici UE conto economico nel manuale Annuali](https://www.edupass.it/StreamFile/Resources/Edupass-Manuali/Manuali/pdf/Mexal-Businesspass/Annuali.pdf)

## Validazione

Test comportamentali su fonte paginata, errori, revoche, scope, date, classificazioni,
storni, IVA, AP/CH/BA, quadratura, snapshot, catalogo MCP e valori null. Test di
regressione finanziari e connettore, lint mirato e build. Evidenze effettive di rilascio
e letture di produzione vengono consegnate separatamente: fixture non equivale a
deploy o disponibilità nella sessione host.
