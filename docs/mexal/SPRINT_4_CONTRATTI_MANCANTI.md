# Sprint 4 — contratti Mexal ancora necessari

## Stato implementazione verificabile

Il flusso invia esclusivamente il payload radice/riga già validato nello Sprint
3. Sono operative l'estrazione del numero documento, il numero Workspace
progressivo/anno e la diagnostica per-documento. Il campo tentato
`stato_riga` è stato rimosso dal POST perché Mexal lo rifiuta come nome campo
non valido; OCM, OCX e OCI usano pertanto lo stato predefinito di Mexal.

La ricognizione dei materiali versionati non contiene JSON GET reali di
OCM/OCX/OCI con stato riga, `help.json`, né un esempio POST verificato per
l'endpoint documenti ordini clienti. Non è quindi possibile stabilire se lo
stato E/S sia una matrice radice, un elemento della struttura righe, una
conseguenza di `cod_modulo`/causale o un valore derivato automaticamente.
Il requisito stato riga E/S **non è completato**.

## Non implementato deliberatamente

Non sono disponibili nel repository né JSON diagnostici pubblicabili con il
contratto POST verificato per i punti seguenti. Le colonne Sprint 4 sono solo
predisposizione schema e non rendono queste funzioni operative.

| Requisito | Evidenza disponibile | Informazione necessaria |
| --- | --- | --- |
| Stato riga E/S | `stato_riga` è rifiutato da Mexal; nessun GET/help versionato espone il nome tecnico reale. | GET OCM/OCX/OCI con righe, `help.json` e POST controllata che specifichino nome, posizione, forma e regola di derivazione. |
| Causale Vendita Diretta | GET reale mostra `id_causale` come matrice. | POST controllata di un ordine Vendita Diretta: nome campo, indice e valore tecnico della causale. |
| Provvigione | Nessun campo provvigione nelle cache clienti, prodotti o condizioni sincronizzate. | Endpoint anagrafica agente/condizione commerciale o GET ordine con campo e contratto POST. |
| Trasporto | Cache cliente sincronizza solo indirizzo e codice indirizzo spedizione. | GET dettaglio cliente e GET scheda trasporto ordine con vettore, porto, cura, aspetto e struttura POST. |
| Pagamento | È verificato solo `GET /dati-generali/pagamenti` per codice/descrizione. | GET scheda pagamento ordine e POST controllata che indichi se rate/scadenze/importi sono automatici o obbligatori. |

Fino a tali evidenze il servizio non deve inserire `id_causale`, un campo stato riga ipotetico, provvigioni o schede accessorie nel POST: farlo trasformerebbe ipotesi in dati
ERP e rischierebbe di regredire il payload riga che oggi funziona.
