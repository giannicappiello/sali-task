# Sprint 4 — contratti Mexal ancora necessari

## Stato implementazione verificabile

Il flusso invia esclusivamente il payload radice/riga già validato nello Sprint
3. Sono operative l'estrazione del numero documento, il numero Workspace
progressivo/anno e la diagnostica per-documento. Per una riga divisa tra OCM e
OCX, il rispettivo stato richiesto (`E` e `S`) viene conservato nel log del
documento, non in `ordini_righe.stato_riga_mexal`: un singolo campo sulla riga
Workspace non può rappresentare entrambi i valori.

## Non implementato deliberatamente

Non sono disponibili nel repository né JSON diagnostici pubblicabili con il
contratto POST verificato per i punti seguenti. Le colonne Sprint 4 sono solo
predisposizione schema e non rendono queste funzioni operative.

| Requisito | Evidenza disponibile | Informazione necessaria |
| --- | --- | --- |
| Causale Vendita Diretta | GET reale mostra `id_causale` come matrice. | POST controllata di un ordine Vendita Diretta: nome campo, indice e valore tecnico della causale. |
| Stato riga | Valori di business E/S richiesti, nessun nome campo GET. | GET ordine OCM/OCX/OCI con righe e relativo nome/forma della matrice. |
| Provvigione | Nessun campo provvigione nelle cache clienti, prodotti o condizioni sincronizzate. | Endpoint anagrafica agente/condizione commerciale o GET ordine con campo e contratto POST. |
| Trasporto | Cache cliente sincronizza solo indirizzo e codice indirizzo spedizione. | GET dettaglio cliente e GET scheda trasporto ordine con vettore, porto, cura, aspetto e struttura POST. |
| Pagamento | È verificato solo `GET /dati-generali/pagamenti` per codice/descrizione. | GET scheda pagamento ordine e POST controllata che indichi se rate/scadenze/importi sono automatici o obbligatori. |

Fino a tali evidenze il servizio non deve inserire `id_causale`, stato riga,
provvigioni o schede accessorie nel POST: farlo trasformerebbe ipotesi in dati
ERP e rischierebbe di regredire il payload riga che oggi funziona.
