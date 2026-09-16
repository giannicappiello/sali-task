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
- Per MP e Altro, tutti i nomi file nella cartella del codice articolo vengono
  riconosciuti: non è necessario che inizino per MP.
- Ogni file è generale dell'articolo, salvo il riconoscimento di un lotto esatto.
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

MP e Altro mostrano direttamente documenti generali e documenti dei lotti,
senza le schede Lotti disponibili e Genealogia. Prodotti finiti e Bulk mantengono
entrambe le schede. Sincronizza documenti è a destra di Aggiorna archivio nella
barra di ricerca. Aggiorna archivio rilegge i dati già indicizzati, senza avviare
una scansione NAS.

### Prestazioni (confronto backend, 16 settembre 2026)

Stesso progetto, stesse tre operazioni in sola lettura, stesso percorso di rete:

| Operazione | Prima | Dopo | Richieste DB prima/dopo |
| --- | ---: | ---: | ---: |
| Catalogo 3.835 articoli | 9.714 ms | 1.176 ms | 18 / 18 |
| Dettaglio MP2033 | 6.461 ms | 126 ms | 18 / 5 |
| Non associati | 6.426 ms | 912 ms | 19 / 19 |

I tempi non comprendono autenticazione, rete browser e rendering. Il dettaglio
legge solo l'articolo richiesto; le pagine del catalogo vengono lette con ordine
stabile e parallelismo limitato a quattro. Gli indici vuoti non ricadono più
nella scansione completa di tutti i lotti. Ricerca e filtri usano il catalogo
già autorizzato ricevuto dal browser, senza richieste per ogni digitazione.
La cache dei dettagli dura 30 secondi, è limitata a 30 articoli e viene svuotata
da aggiornamento, sincronizzazione e associazione manuale. I download vengono
sempre riautorizzati dal server.

`node --test server/private-documents.test.js server/private-documents-layout.test.js server/private-documents-store.test.js server/private-documents-matching.test.js`

La migrazione `20260916120000` conserva i collegamenti esistenti, recuperando il
codice articolo dalla genealogia e il percorso dall'inventario NAS già censito
solo quando il riscontro è univoco. Non richiede un aggiornamento MES.

### Bulk e prodotti finiti: fascicolo del lotto

`Produzione/CoaPROGRE/{codice articolo}` contiene i file di bulk e prodotti finiti.
I file generici sono collegati all'articolo; un nome uguale al lotto o con il
prefisso `lotto_` viene collegato esclusivamente a quel lotto. Un nome numerico
senza lotto corrispondente rimane non associato, evitando di distribuirlo come
documento generale. I prefissi ambigui restano da verificare.

Apri lotto carica `/lots/documents?articleCode=...&lotCode=...` solo su richiesta.
La risposta separa documenti generali, specifici e materiali impiegati. La
genealogia Workspace viene attraversata per coppia articolo/lotto, anche tramite
bulk intermedi, considerando scarichi con quantità positiva e deduplicando cicli
e percorsi ripetuti. Ogni materiale espone i propri documenti generali e quelli
del solo lotto consumato. Nessuno scarico disponibile produce un messaggio
esplicito; non si ricorre alla distinta base teorica.

L'accesso parte da un lotto autorizzato; i download conservano quel contesto e
il server ricalcola la catena prima di firmare il collegamento NAS e registrare
l'accesso. La lettura non amplia l'accesso diretto agli altri lotti delle MP.
I file non vengono duplicati. Nessuna richiesta aggiuntiva viene fatta al MES.

Verifica: `node --test server/private-documents-lineage.test.js` copre cartelle,
lotto esatto, risalita PF/bulk/MP, duplicati, cicli, file inattivi e isolamento
tra clienti. Prova di lettura sul lotto FP123L/112310016: 447 ms per ricostruire
11 coppie articolo/lotto (esclusi autenticazione e rendering browser).

### Elenco documenti nelle righe e Scarica tutti

La colonna Azioni è sostituita da Documenti disponibili: nomi cliccabili,
raggruppati in generali articolo, specifici lotto e materiali/lotto consumato.
Le vecchie azioni Apri lotto, Associa documento ed Emetti CoA non compaiono più
nelle righe. La richiesta `lots/documents?articleCode=...&all=true` ricostruisce
insieme i soli lotti autorizzati dell'articolo, senza una richiesta per riga.
Verifica FP123M: 31 lotti in 924 ms nel servizio, prima di autenticazione e rendering.

Scarica tutti è disponibile per ogni lotto e per i documenti dell'articolo,
incluse MP e Altro. Il browser crea uno ZIP deduplicato per documento, con
cartelle articolo/lotto. I file vengono letti dal NAS tramite Workspace in
frammenti di massimo 1 MiB, con tre file contemporanei; ogni richiesta mantiene
la verifica di accesso e l'audit. Nessun archivio viene salvato sul server o
sul NAS. Le letture incomplete interrompono lo ZIP con un errore visibile.
Il limite per singolo archivio nel browser è 256 MiB non compressi.

`node --test server/private-documents-zip.test.js` verifica byte, omonimi,
deduplicazione, contesto autorizzato e gestione dei frammenti incompleti.
