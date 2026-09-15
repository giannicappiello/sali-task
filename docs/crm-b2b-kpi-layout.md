# Scheda cliente e dashboard B2B

La scheda cliente usa la ragione sociale come titolo e tre sezioni di card:
fatturato/ordini/prodotti, relazione commerciale/riordini, attività/timeline/progetti/CRM.
Le card comprendono i conteggi documentali e Beauty Days. Anagrafica e azioni
restano disponibili in testata; i precedenti due riquadri inferiori sono rimossi.
La dashboard mantiene i suoi indicatori e li raccoglie nello stesso schema.

Ogni card contiene un pulsante informativo separato dall'apertura del dettaglio.
I dettagli si aprono in un dialogo centrale con gestione del focus, Escape e
blocco dello scroll sottostante. Le tabelle offrono ricerca, filtri combinati
per colonna, ordinamento numerico/data/testo, selezione colonne e pagine da 25 righe.
Filtri e ordinamenti precedono la paginazione. Nessun dato dimostrativo è incluso
nel codice applicativo.

## Dati e autorizzazioni

- KPI esistenti: RPC CRM correnti, senza cambiare le formule.
- Documenti cliente: lettura paginata delle fonti già utilizzate dai KPI.
- Prodotti: RPC `crm_customer_product_lines`, aggregazione esistente; quantità
  separate per UM e rispetto delle autorizzazioni alle schermate prodotto.
- Beauty Days: endpoint `report-giornate-api`, con gestione esplicita degli errori.
- Ciclo cliente: nuova RPC `crm_b2b_lifecycle_details`, security invoker e accesso
  solo autenticato. Stessi dati, data corrente e soglie di `crm_b2b_lifecycle_summary`.
- Le attività mantengono creazione tramite checklist B2B, storico ed eliminazione
  autorizzata. I progetti usano il dialogo Workspace già esistente.
- Note, documenti e sintesi AI conservano le capacità precedenti: non viene
  inventato un conteggio documentale quando la scheda non dispone di una fonte.

## Verifica

- Build Vite e lint dei file modificati.
- 22 test mirati (query del dettaglio, competenze CRM e integrazione Workspace).
- Test SQL in transazione con rollback: tutte le quantità del dettaglio ciclo
  cliente coincidono con lo snapshot KPI; accesso anonimo negato.
- Browser sui componenti reali con risposte isolate: 21 card cliente, 27 card
  dashboard, informazioni, popup, filtri, ordinamento numerico, paginazione,
  visibilità colonne, Escape e viewport mobile senza overflow/errori runtime.
- Il test browser usa fixture; non è una sessione autenticata in produzione.

## Creazione dalla scheda cliente

- Nuova attività apre `WorkspaceTaskDialog` / `PhaseChecklistModal`, con cliente
  già inserito e checklist filtrata B2B. Anche il dettaglio Attività usa questo
  ingresso; le task Workspace del cliente sono incluse senza duplicare le
  attività CRM già collegate.
- I progetti selezionabili nel popup task appartengono al CRM e al cliente
  iniziale. L'eventuale progetto di una fase esistente resta disponibile in modifica.
- Nuovo progetto mantiene il filtro B2B sui tipi. Entrambi i moduli caricano
  dall'anagrafica `prodotti` solo codici attivi IT, MKT e IMP, preservando gli UUID
  corretti per i vincoli dei collegamenti prodotto. Non usano gli ID della tabella
  separata degli impianti.
- La schermata Analisi B2B è rimossa da navigazione, rotte e catalogo Workspace.
  Analisi PRIVATE rimane disponibile.
