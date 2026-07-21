# Sprint 5 — documenti Mexal e PDF

## Esito della ricognizione

Sono stati esaminati gli adapter POST, il client WebAPI, le migrazioni degli
ordini, il frontend e i test. La cartella `diagnostics/mexal/` non contiene
JSON diagnostici versionati (solo il README che ne vieta il commit), e nel
repository non sono presenti `help.json` per `/documenti/ordini-clienti` o
`/documenti/ordini-clienti/righe`, né GET comparabili di OCM manuale in stato
E e OCM Workspace in stato S. Non è quindi possibile eseguire l'indagine live
richiesta senza credenziali/dati reali nell'ambiente di esecuzione.

Il campo `stato_riga` resta deliberatamente assente: l'errore Mexal già
documentato è `6001 - Nome campo 'stato_riga' non valido`. Non viene introdotto
alcun sinonimo ipotetico e non si dichiara completata la regola OCM=E/OCX=OCI=S.

Per raccogliere l'evidenza mancante esiste lo script locale (non esposto come
endpoint Vercel):

```sh
npm run mexal:capture-order-contract -- --ocm-e OC+1+16531 --ocm-s OC+1+16532 --ocx OC+1+16533 --oci OC+1+16534
```

Interroga i quattro documenti indicati e i due endpoint `help.json`; salva
`diagnostics/mexal/order-contract-sanitized.json`. Il file conserva solo nomi
dei campi, forma delle matrici e tipi primitivi: valori, dati personali,
credenziali e header non vengono scritti. I riferimenti forniti sono usati solo
per la richiesta e non sono inclusi nel file prodotto.

## PDF

`ordini_documenti_mexal.tipo_documento`, `serie` e `numero` sono l'unica fonte
del numero stampato. Per ogni record completo viene generato un PDF separato:
`ordine-OCM-1-16531.pdf`, ad esempio. Le righe sono filtrate con le stesse
quantità già usate per la classificazione: `quantita_ocm`, `quantita_ocx`, o
articolo `IMP*` per OCI. Il numero Workspace non è un numero documento e può
apparire solo nella cella `Riferimento Workspace`.

## Contratto POST realmente disponibile

| Gruppo | Stato | Campo Mexal | Fonte tecnica | Tipo / struttura | Esempio reale nel contratto repository |
| --- | --- | --- | --- | --- | --- |
| Numero PDF | IMPLEMENTATO E VERIFICATO | `tipo_documento`, `serie`, `numero` di `ordini_documenti_mexal` | Migrazione `20260720210000_mexal_order_document_state.sql`; POST legge body e header `Location` | testo, scalari DB | `OCM`, `1`, `16531` → `OCM 1/16531` |
| Righe articolo | IMPLEMENTATO E VERIFICATO | `id_riga`, `tp_riga`, `codice_articolo`, `quantita`, `prezzo`, `sconto`, `id_mag_riga`, `tp_um_articolo`, `cod_iva` | GET reale descritto in `ORDINI_CLIENTI_POST.md` | matrici radice indicizzate | `quantita: [[1, 8]]` |
| Pagamento | IMPLEMENTATO SOLO CON CAMPO GIÀ VERIFICATO | `id_pagamento` | payload e test esistenti; GET `/dati-generali/pagamenti` conferma codice/descrizione, non la scheda ordine | scalare numerico | `id_pagamento: 7` |
| Destinazione | IMPLEMENTATO SOLO CON CAMPI GIÀ VERIFICATI | `id_ind_sped`, `cod_anag_sped` | adapter POST corrente; nessun help POST versionato | scalare numero/testo | `id_ind_sped: 12` |
| Stato E/S | NON IMPLEMENTATO PER API MANCANTE | — | servono GET OCM E, OCM S, OCX/OCI S e i due `help.json` | — | `stato_riga` è rifiutato |
| Causale Vendita Diretta | NON IMPLEMENTATO PER API MANCANTE | `id_causale` è soltanto osservato in GET | `ORDINI_CLIENTI_POST.md` | matrice in GET; POST non verificata | non inviata |
| Agente/provvigione | NON IMPLEMENTATO PER API MANCANTE | `codice_agente` è già inviato; nessun campo provvigione verificato | adapter POST e `SPRINT_4_CONTRATTI_MANCANTI.md` | scalare testo per agente | `codice_agente: "A-01"` |
| Trasporto/economici/altre note | NON IMPLEMENTATO PER API MANCANTE | — | mancano GET/help/POST controllato | — | non inviati |

### Payload inviati oggi (sintesi)

```json
{
  "sigla": "OC",
  "serie": 1,
  "numero": 0,
  "cod_conto": "C1",
  "data_documento": "20260720",
  "cod_modulo": "M",
  "id_magazzino": 5,
  "id_riga": [[1, 1]],
  "quantita": [[1, 8]]
}
```

Questo esempio non contiene `stato_riga`, `id_causale`, provvigioni,
trasporto o scadenze: aggiungerli senza il contratto POST provato sarebbe una
regressione del flusso funzionante.
