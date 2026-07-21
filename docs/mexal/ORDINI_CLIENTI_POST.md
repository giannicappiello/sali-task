# POST ordini clienti Mexal

Non è presente nel repository né nei materiali di help disponibili un contratto POST ufficiale per
`/webapi/risorse/documenti/ordini-clienti`. I JSON reali letti con GET rappresentano le righe come
matrici indicizzate nella radice; l'adapter corrente invia quindi quella variante, senza introdurre un
contenitore `righe` non documentato.

`id_causale` compare come matrice nella risposta GET di un documento reale, ma
il repository non contiene un contratto POST che ne confermi l'uso. Per evitare
di inviarlo nella forma scalare non verificata, l'adapter lo omette finché il
contratto POST non verrà validato.

Prima dell'uso in produzione il payload deve essere validato con una **POST controllata** su Mexal.
L'unico punto da modificare se Mexal conferma un contratto diverso è `buildRootMatrixRows` in
`server/mexal/order-documents.js`.

`nota` usa inizialmente `[[1, testo]]`, coerente con la GET reale. Per un contratto POST verificato
che richieda una stringa si può impostare `MEXAL_ORDER_NOTA_FORMAT=scalar`; il default è
`typed-array` e non blocca il deployment.

## Stato della riga articolo — hotfix

`stato_riga` è stato **rimosso completamente** dai payload POST: Mexal lo
rifiuta con `6001 - errore gestionale` e `Nome campo 'stato_riga' non valido`.
Non è stato introdotto alcun nome alternativo ipotetico.

La ricognizione del repository non fornisce il contratto tecnico reale: non sono
versionati JSON GET di OCM, OCX o OCI con il campo stato riga, né `help.json` o
esempi POST verificati per l'endpoint ordini clienti. Le GET già considerate
confermano soltanto che le proprietà delle righe possono essere matrici
indicizzate alla radice; non confermano un campo E/S, la sua posizione, né una
dipendenza da `cod_modulo` o da causale.

Di conseguenza OCM, OCX e OCI continueranno temporaneamente con lo stato
predefinito determinato da Mexal. Il requisito dello stato riga E/S **non è
completato** e potrà essere ripreso soltanto dopo aver acquisito GET reali delle
righe e un contratto POST/`help.json` che indichi nome tecnico, struttura e
regole di derivazione.

## `data_documento`

`data_ordine` deve essere una data di calendario valida nel formato rigoroso `YYYY-MM-DD`.
Per compatibilità con Mexal, `data_documento` viene convertita per default in `DD/MM/YYYY`.

Per cambiare esclusivamente la serializzazione in uscita, impostare l'opzionale
`MEXAL_ORDER_DATE_FORMAT` su uno dei valori seguenti:

- `dd/mm/yyyy` (default): `20/07/2026`;
- `yyyymmdd`: `20260720`;
- `iso`: `2026-07-20`;
- `typed-array-dd/mm/yyyy`: `[[1, "20/07/2026"]]`.

Valori non supportati e date non valide bloccano la creazione del documento, evitando di inviare a
Mexal un `data_documento` ambiguo o malformato.
