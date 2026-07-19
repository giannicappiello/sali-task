# Payload ordine cliente Mexal

## Endpoint

`POST /webapi/risorse/documenti/ordini-clienti`

La costruzione della richiesta è centralizzata in
`api/mexal/mexal-order-payload.js`. Il riferimento Workspace (`note_mexal` e
l'ID dell'ordine) resta nel database Workspace e nel log tecnico: non viene
mai serializzato nella richiesta Mexal.

## Contratto applicato

| Area | Campo Mexal | Origine Workspace | Note |
| --- | --- | --- | --- |
| Testata | `sigla` | costante `OC` | tipo documento ordine cliente |
| Testata | `serie` | configurazione OCM/OCX | obbligatorio |
| Testata | `conto` | `codice_cliente` | obbligatorio; non inviare anche `codice_cliente` |
| Testata | `data_documento` | `data_ordine` | obbligatorio |
| Testata | `codice_pagamento` | `codice_pagamento` | omesso se vuoto |
| Testata | `codice_agente` | `codice_agente_mexal` | omesso se vuoto |
| Riga | `articolo` | `codice_articolo` | obbligatorio |
| Riga | `descrizione` | `descrizione` | omessa se vuota |
| Riga | `quantita` | `quantita_ocm` o `quantita_ocx` | solo valori maggiori di zero |
| Riga | `prezzo` | `prezzo_netto` | valore numerico |
| Riga | `sconto` | `sconto_commerciale` | omesso se vuoto |
| Riga | `unita_misura` | `unita_misura` | `PZ` se assente |

Non sono inviati gli alias duplicati `codice_cliente`, `codice_articolo` e
`prezzo_netto`, né `sconto_pagamento`. `note` è escluso perché la risposta
reale Mexal 6001 lo identifica come campo non valido.

## Controlli e log

Prima della chiamata sono validati serie, conto, data documento e articolo di
ogni riga che abbia quantità positiva. Se manca uno di questi valori viene
restituito HTTP 422 e non parte alcuna richiesta verso Mexal. Le righe con
quantità zero non generano documenti.

Per un errore della WebAPI, il log `ordini_sync_mexal_log` conserva il tipo
OCM/OCX, il payload inviato, `status_http`, la risposta JSON e il testo raw;
non contiene l'header Authorization né credenziali.
