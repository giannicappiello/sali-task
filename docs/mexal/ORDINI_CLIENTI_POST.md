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

## `stato_riga`

Lo stato delle righe usa il campo Mexal radice/matrice **`stato_riga`**, con la
stessa forma indicizzata delle altre proprietà riga: `[[1, "E"], [2, "E"]]`.
Il builder lo determina per ogni documento: `E` per OCM e `S` per OCX e OCI.
Perciò, quando una riga Workspace è divisa tra OCM e OCX, i due POST contengono
rispettivamente `stato_riga: [[1, "E"]]` e `stato_riga: [[1, "S"]]`.

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
