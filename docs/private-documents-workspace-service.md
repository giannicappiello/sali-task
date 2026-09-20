# Documenti PRIVATE: servizio Workspace

## Capitolati prodotti finiti

Ogni componente viene mostrato una sola volta con codice e descrizione; astuccio
e bugiardino hanno l'opzione Non previsto nella stessa tendina. I vecchi valori
descrittivi vengono conservati nei dati, senza righe duplicate nella schermata o nel PDF.
Le foto NAS appena selezionate sono visibili immediatamente e incluse anche nel PDF
di bozza, tramite `specifications/preview`: solo editor interni, file attivi indicizzati,
percorsi normalizzati e audit come per gli allegati salvati. Il PDF può leggere i byte
dal proxy Workspace se il NAS blocca richieste CORS (frammenti da 1 MiB, massimo 20 MiB).
I PDF allegati hanno un'anteprima nella schermata; nel capitolato sono elencati come documenti.

Entrambi i selettori Associa documento partono da `nas?articleCode=...`:
cartella con nome esatto del codice sotto Produzione, escludendo il cestino NAS.
In assenza di file indicizzati si apre Produzione/codice e si mostra un avviso,
senza creare o spostare cartelle sul NAS. Rimane disponibile la navigazione Su.

Il capitolato carica la foto dei codici IT da `prodotti.immagine_catalogo_url`,
la stessa fonte della sezione Workspace Prodotti. `specifications/sources`
riusa l'autorizzazione articolo e risolve i nomi clienti da `ordini_clienti_cache`,
filtrando i collegamenti per il cliente autorizzato. Non mostra codici cliente
al posto delle ragioni sociali mancanti.

La distinta corrente arriva da `workspace_finished_bom_revisions/lines`;
quando manca viene letta da Mexal tramite il connettore esistente, senza scritture.
La lettura risolve anche sottoprodotti IT, con controllo di cicli e limiti,
recupera descrizioni mancanti dall'anagrafica Mexal e compila i codici FP.
Le tendine componenti mostrano codice e descrizione; Altri componenti permette
di aggiungere ulteriori elementi della distinta. Un errore di lettura è visibile.

Visualizza capitolato genera nel browser un PDF scaricabile con logo Progré
originale su ogni pagina, foto di catalogo, foto NAS salvate, campi e descrizioni
dei componenti. Le bozze sono esplicitamente indicate; le immagini non recuperabili
sono segnalate sia nell'anteprima sia nel documento. Non occorrono migrazioni aggiuntive.

Il dettaglio dei prodotti finiti contiene il capitolato tra l'intestazione
dell'articolo e i documenti esistenti. La struttura della pagina, le categorie,
la ricerca e i fascicoli dei lotti restano quelli di Documenti Private.

Il capitolato contiene dati descrittivi, foto prodotto, packaging primario e
secondario, etichetta/lavorazioni, marcatura lotto, imballo, pallet e note.
Ogni sezione consente di collegare più file dalle cartelle già censite nel NAS;
per le foto prodotto sono ammessi JPG, PNG, WebP e GIF. Le immagini diventano
visibili dopo il salvataggio. Il limite è 40 allegati per capitolato. Rimuovere
un collegamento non elimina il file originale.

La lettura segue il perimetro articoli già autorizzato. La modifica richiede
il permesso esistente `documentation.private.upload` (o amministratore), ed è
sempre esclusa per gli utenti associati a clienti. Ogni apertura di un allegato,
incluse le anteprime, verifica nuovamente articolo e file attivo e registra
l'accesso prima di emettere un URL NAS firmato con validità 15 minuti.

Applicare `20260920120000_workspace_product_specifications.sql` e
`20260920121000_product_specification_conflict_status.sql` prima di distribuire
il codice. Creano tabelle riservate al servizio Workspace e la RPC
atomica `save_workspace_product_specification`. Un salvataggio incrementa la
revisione e ne conserva una copia completa; il controllo `expectedVersion`
impedisce a due editor di sovrascriversi. Il server risponde 409 se nel frattempo
è stata salvata una revisione diversa. La UI conserva la bozza e offre Ricarica,
con conferma prima di scartare modifiche locali. Lo storico mostra le ultime
50 revisioni con autore e data; le copie complete restano nel database.
Il conflitto usa SQLSTATE `PT409`, così PostgREST risponde subito con HTTP 409
senza ritentare il salvataggio come se fosse un errore di serializzazione SQL.

Le bozze sono in memoria per la sessione della pagina e restano disponibili
passando tra articoli; la chiusura/ricarica del browser avvisa se vi sono
modifiche non salvate. Non viene effettuato salvataggio automatico sul NAS.

API (attraverso `private_documents`):
- `specifications?articleCode=...`: legge il capitolato corrente.
- `specifications/save?articleCode=...`: salva dati, allegati e versione attesa.
- `specifications/file?articleCode=...&attachmentId=...`: autorizza un allegato salvato.
- `specifications/history?articleCode=...`: elenco delle revisioni.

Test: `node --test server/product-specifications.test.js`.

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
