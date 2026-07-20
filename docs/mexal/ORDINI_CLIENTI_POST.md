# POST ordini clienti Mexal

Non è presente nel repository né nei materiali di help disponibili un contratto POST ufficiale per
`/webapi/risorse/documenti/ordini-clienti`. I JSON reali letti con GET rappresentano le righe come
matrici indicizzate nella radice; l'adapter corrente invia quindi quella variante, senza introdurre un
contenitore `righe` non documentato.

Prima dell'uso in produzione il payload deve essere validato con una **POST controllata** su Mexal.
L'unico punto da modificare se Mexal conferma un contratto diverso è `buildRootMatrixRows` in
`server/mexal/order-documents.js`.

`nota` usa inizialmente `[[1, testo]]`, coerente con la GET reale. Per un contratto POST verificato
che richieda una stringa si può impostare `MEXAL_ORDER_NOTA_FORMAT=scalar`; il default è
`typed-array` e non blocca il deployment.
