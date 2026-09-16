# Documenti PRIVATE: servizio Workspace

La schermata usa `/api/workspace/documents`, gestito dalle funzioni Workspace.
Autenticazione, permessi, inventario, collegamenti e tracciamento download sono in
Supabase Workspace. Non vengono emessi ticket MES e non vengono chiamate API MES.

Il connettore NAS esistente (`DOCUMENT_GATEWAY_URL` e
`DOCUMENT_GATEWAY_SECRET`) fornisce il manifest e i file originali tramite URL
firmati. La sincronizzazione non copia, sposta o modifica file sul NAS.

I codici articolo provengono da `ordini_prodotti_cache`; i lotti vengono letti
direttamente dall'anagrafica Mexal e conservati in
`workspace_private_document_lots`. La genealogia SL già presente in Workspace
rimane consultabile. Le quantità non disponibili non vengono mostrate come zero.

Il worker Workspace verifica la sincronizzazione ogni ciclo ordinario, con una
distanza minima di cinque minuti e un lock condiviso. Il pulsante Sincronizza
documenti avvia una verifica immediata. In caso di errore NAS non si svuota
l'inventario; se Mexal non è disponibile si mantengono i lotti già acquisiti e si
mostra un avviso.

## Associazione

- Solo `produzione/Documentazione Mp/{codice}` viene associata automaticamente.
- `MP2022.pdf` e `MP2022_*.pdf` sono documenti generali dell'articolo.
- `12345.pdf` e `12345_*.pdf` richiedono un lotto 12345 esistente di quell'articolo.
- Codici e percorsi vengono confrontati senza distinzione maiuscole/minuscole.
- I numeri di lotto conservano gli zeri iniziali. I casi ambigui restano da verificare.
- I collegamenti manuali hanno precedenza e non vengono sovrascritti.
- COA PROGRE e gli altri percorsi restano disponibili per associazioni manuali.
- I documenti già associati a un prodotto nel catalogo documentale Workspace
  non compaiono tra i non associati.

I clienti vedono solo gli articoli/lotti del proprio perimetro, i documenti
generali di tali articoli e quelli dei lotti autorizzati. Ogni download viene
autorizzato sul server e registrato prima di generare il collegamento NAS.

## Verifica

`node --test server/private-documents.test.js server/private-documents-layout.test.js server/private-documents-store.test.js server/private-documents-matching.test.js`

La migrazione `20260916120000` conserva i collegamenti esistenti, recuperando il
codice articolo dalla genealogia e il percorso dall'inventario NAS già censito
solo quando il riscontro è univoco. Non richiede un aggiornamento MES.
