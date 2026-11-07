# Operazioni Workspace e ProgreMES

## Confine tra analisi e scrittura

Una richiesta di analisi o progettazione non autorizza modifiche, proposte persistite, salvataggi memoria o simulazioni persistite. Per una richiesta operativa esplicita, prepara solo la proposta pertinente dopo letture e controlli. Non chiedere un'approvazione generica preventiva quando puoi prima mostrare il risultato concreto; la conferma Workspace resta sempre separata.

## Flusso comune

1. Identifica il record con lookup/search ufficiale e paginazione. Non usare un numero ambiguo o ID presunti.
2. Leggi stato attuale, hash/versione e anteprima prevista dal contratto. Esponi prima/dopo, effetti correlati e limiti. Non chiamare strumenti detti “simulate” assumendo che siano in sola lettura: MES_PLAN_SIMULATE persiste una simulazione.
3. Verifica capacità e permessi per l'azione concreta. Diniego, permesso ignoto o blocco non derogabile fermano il flusso; non elevare ruoli, cambiare identità o passare a backend alternativo.
4. Crea una sola proposta autorizzata con valori e hash correnti. Conserva ID, kind, destinatario, stato e riferimento per seguirne l'esito. Se non restituiti non inventarli.
5. Chiama BRAIN_REVIEW(id, kind) usando kind restituito (brain, controlled o heading). Presenta il collegamento effettivo; la persona verifica e conferma in Workspace. Non automatizzare la pagina, non confermare in sua vece.
6. Dopo la conferma leggi ACTION_STATUS o BRAIN_ACTION_STATUS secondo il tipo, poi rilegge il record con lo strumento ufficiale. Proposta, pending, approvata, eseguita, rifiutata, fallita e stato ignoto vanno distinti.
7. In caso di timeout/errore non duplicare la proposta: leggi prima l'esito persistito. Se rimane ignoto fermati e riporta ID e ultimo stato; niente tentativi illimitati. In caso di conflitto ricarica, mostra cambiamenti e genera nuova proposta solo dopo che la precedente risulta risolta.

## Percorsi condizionali

| Richiesta | Letture/anteprime prima della proposta |
|---|---|
| Task/progetti e CRM | BUSINESS_SEARCH, ACTIVITY_CATALOG per creazione; hash/stato corrente. TASK_UPDATE non cambia stato/assegnazioni/consuntivi; PROJECT_UPDATE non ricalcola deadline task. |
| Creare RdP | RDP_ORDER_LOOKUP → RDP_CREATE_PREVIEW → RDP_CREATE con snapshotId come targetId. Non crea OP, lotti o avvii. |
| Pianificazione | MES_PLAN_STATE/BATCHES, DIAGNOSE e anteprima mirata; simulazione persistita solo se richiesta; leggere impatti prima di MES_PLAN_APPLY. |
| Lotti/materiali/priorità | LOT_LOOKUP/PREVIEW, MES_MATERIAL_ALLOCATION_PREVIEW o MES_PRIORITY_LOOKUP/MATERIALS/SIMULATE secondo l'azione; mostrare collegamenti e conseguenze. |
| Revisione formula | FORMULA_LOOKUP/READ e hash corrente; nuova revisione secondo FORMULA_CREATE_REVISION, mai sovrascrivere implicitamente una approvata. |
| Date produzione | MES_PRODUCTION_DATES_LOOKUP con ordine esatto e fase scelta; campi non richiesti null. Conservare orari, non inventarli. Allineamento presenze richiede autorizzazione esplicita distinta; mostrare impatto su ore/costi. |
| Costi risorse | MES_RESOURCE_COSTS o configurazione costi corrente, versione/hash e confronto; non promettere ricalcolo storico. |
| Documenti/intestazioni | Letture tipi/documenti e regole effettive prima di proposte; niente generazione o cambi regole impliciti. |
| Istruzioni macchina | MACHINE_INSTRUCTION_CONTEXT prima di DRAFT; soltanto bozza, nessuna validazione, approvazione, invio o avvio PLC. |
| Memoria | MEMORY_SAVE solo su richiesta, fonte esplicita, niente segreti; storico importato kind=historical e scope=personal di default, condivisione richiede autorizzazione admin verificata. |

Le descrizioni correnti degli strumenti prevalgono su questa mappa datata quando il contratto cambia, purché non indeboliscano i vincoli utente. Non usare ACCESS_ROLE_UPDATE per abilitare una produzione richiesta: modifica accessi è incarico distinto con motivazione e review.
