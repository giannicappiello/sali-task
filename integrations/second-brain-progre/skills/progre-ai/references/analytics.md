# Analisi aziendali

## Contratto dell'analisi

Traduci la richiesta in periodo, fuso Europe/Rome se pertinente, dominio, unità, confronto, filtri e granularità. Risolvi ambiguità che cambiano il risultato; per le altre dichiara l'assunzione. Usa solo risorse pubbliche esposte dal connettore. Una domanda su “tutti i dati” significa tutti quelli pertinenti, disponibili e autorizzati, non lettura indiscriminata.

Prima di calcolare: verifica fonte, data di aggiornamento, valuta, IVA, unità, paginazione e inclusione di annullati/bozze. Pagina fino all'indicatore finale ufficiale; se raggiungi limiti o errori indica risultato parziale. Una pagina vuota non prova assenza globale, né un campo mancante equivale a zero. Non sommare riepiloghi a righe che già includono. Distingui dati correnti da cache e storico.

Unisci per ID verificati e granularità compatibili (ordine, fase, lotto, articolo, cliente). Evita moltiplicazioni tra fasi, righe ordine e fatture. Mantieni ordini, prodotto e fase distinti. Non sommare kg e pezzi senza conversione esplicita.

## Fonti e metriche

| Dominio | Fonti da verificare | Regole |
|---|---|---|
| Produzione | MES_READ production-orders/production-progress/planning/inventory; lookup specifici | Quantità buona, scarti, stato, piano/consuntivo e ritardi solo se presenti. Non confondere produzione terminata, qualità conforme e rilascio. |
| Produttività | Avanzamento, tempi reali, calendario e HR_READ se autorizzato | kg buoni/ore o pezzi buoni/ore; specificare ore macchina, presenza o lavoro. OEE richiede disponibilità, prestazione e qualità con denominatori documentati. Se mancano fermi o standard non inventare OEE. |
| Costi | PRODUCTION_COST_CONFIGURATION, MES_RESOURCE_COSTS, formula/materiali e consuntivi disponibili | Usare versione valida alla data; separare bozza schermata da configurazione salvata. Configurazione non equivale a consuntivo. Esplicitare costi mancanti e allocazioni. |
| Commerciale | CRM_CUSTOMER_SEARCH, SALES_INVOICES_READ, CUSTOMER_REORDERS_READ | Ordini, fatturato e incassi sono metriche diverse. Per PR: type=b2b, orderModule=prof, customerGroup=regular; MyPharma separato; PH: orderModule=ph. Pagina CRM finché nextOffset=null. Mostra nome agente da agente_classificazione. |
| Finanza | Solo fonti contabili realmente esposte e autorizzate; fatture come fonte parziale | Non ricavare cassa, debiti o EBITDA dalle sole vendite. Se mancano costo del venduto/costi operativi, fornire solo analisi sostenibili e lista delle fonti mancanti. |
| Qualità | Stati qualità/rilascio, scarti, lookup lotti e documenti autorizzati | Non dedurre conformità da assenza di segnalazioni. Distinguere scarto, rilavorazione e non conformità; verificare denominatori e tracciabilità. |

WORKSPACE_ORDERS_SEARCH è cache documenti Mexal inclusiva di annullati/bozze, non il KPI Ordinato della dashboard. Per il KPI usa le metriche ufficiali CRM. Il dettaglio limitato di SALES_INVOICES_READ non rappresenta l'intero archivio. Diagnostica sincronizzazione con COMMERCE_CONNECTIONS_READ e COMMERCE_SYNC_RUNS_READ, senza avviare importazioni; una cache vuota non dimostra assenza sul provider.

FORMULA_READ: durate produzione/raffreddamento/maturazione in ore; confezionamento in minuti. Converti prima dei calcoli. Distingui lavoro effettivo e occupazione macchina; non addebitare due volte intervalli sovrapposti o trasferimenti Station/Filling.

Formule da esplicitare quando usate:
- Costo unitario = costi pertinenti attribuiti / quantità buona omogenea; se denominatore zero o mancante, non calcolabile.
- Costo manodopera = ore attribuite × tariffa applicabile, solo con basi e versione note.
- Scostamento = consuntivo − preventivo; percentuale sul preventivo se diverso da zero.
- Margine = ricavo netto − costo associato; indicare se industriale, di contribuzione o altro. Se costo parziale, chiamarlo margine parziale.
- Tasso scarto: dichiarare se scarti/(buoni+scarti) o altro standard ufficiale; non mescolare basi.

Previsioni e scenari sono stime separate dai consuntivi, con ipotesi e intervalli. Correlazione non dimostra causa. Per confronti operatori considera mix prodotti, turni, macchina e qualità; usa dettaglio nominativo solo se necessario e autorizzato.

## Consegna

Apri con risultato e limite principale, poi tabella KPI con unità, confronto e copertura; indica fonti/ID consultati, periodo dati, istante lettura, filtri, formule e dati mancanti. Distingui osservazioni, interpretazioni e azioni suggerite. Una raccomandazione non autorizza ad aggiornare piani o costi.
