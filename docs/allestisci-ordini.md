# Allestisci Ordini

Schermata autonoma: **Logistica > Magazzino > Allestisci Ordini**, percorso `/magazzino/allestisci-ordini`, codice catalogo `magazzino.allestisci_ordini`.

## Funzionamento

- Mostra esclusivamente OC con modulo M e frase `consegnato mgz` nelle note, senza distinzione tra maiuscole/minuscole e spazi ripetuti.
- Ogni OCM ha una sola preparazione persistente, riprendibile tramite URL o elenco. La versione impedisce sovrascritture da un altro dispositivo; gli eventi impediscono di duplicare una lettura ritentata dopo una risposta persa.
- Barcode come testo, preservando zeri iniziali. Anagrafica Mexal/cache o configurazione esplicita; codici ambigui bloccati. Modalità Pezzo = 1; Cartone = pezzi configurati per articolo. Non si deduce automaticamente la confezione da un barcode che identifica soltanto il prodotto.
- Colli numerati, contenuto per collo, associazione a bancali numerati. Se esistono bancali tutti i colli devono essere assegnati. Colli/bancali vuoti impediscono il riscontro.
- Riscontro sulle quantità aggregate delle righe ripetute: mancanti, prodotti estranei e quantità eccedenti. Nessun DDT se non corrisponde tutto.
- FIFO per articolo e magazzino della riga OCM: data carico poi ID; solo lotti caricati, validi, non scaduti e con quantità positiva. Le riserve degli altri allestimenti verificati vengono sottratte e controllate nella stessa transazione DB. Le modifiche successive invalidano il riscontro e liberano la riserva.
- L'operatore deve confermare il prelievo dei lotti proposti: il barcode prodotto non certifica il lotto fisico. Il riscontro rilegge Mexal; quantità o lotti cambiati richiedono un nuovo controllo.
- POST nativo BC con riferimenti alle testate e ID delle righe originali, righe descrittive conservate, prezzi/sconti/IVA originali e assegnazioni lotto esplicite. Nessun azzeramento manuale dell'OCM o secondo documento scollegato.
- La richiesta DDT viene acquisita in modo irreversibile prima della chiamata remota. Una sola POST; dopo timeout si consente soltanto riconciliazione tramite lettura del marcatore univoco e verifica di origine, prodotti, quantità e lotti. Non riprovare manualmente l'emissione in caso di esito incerto.
- Packing list PDF generata dopo conferma DDT e riscaricabile dallo storico: contenuto e lotti di ogni collo, pezzi per collo, totale colli/pezzi/bancali e cartoni per bancale. Prima del DDT, anteprima marcata BOZZA.

## Installazione e configurazione

1. Applicare esclusivamente la migrazione `20261030163000_warehouse_order_preparation.sql` con il processo di rilascio del progetto. Non applicare indiscriminatamente altre migrazioni locali non correlate.
2. Pubblicare backend e frontend insieme. Riusa la configurazione Supabase/Mexal esistente, senza nuove credenziali o servizi MES.
3. Configurare nella schermata la serie BC esistente in Mexal: intenzionalmente non esiste una serie preimpostata per emettere documenti. Configurare pezzi/cartone e gli eventuali barcode sostitutivi.
4. Gestire la schermata nel catalogo/ruoli/esclusioni utente esistente: lettura, scrittura e amministrazione configurazione. L'accesso può essere assegnato alla singola schermata. I portali cliente sono esclusi anche sul server. Le tabelle e RPC operative sono riservate al service_role; nessun accesso diretto dal browser.
5. Fotocamera su HTTPS o localhost, con autorizzazione del dispositivo. Lettore USB/tastiera e inserimento barcode disponibili. La lettura continua dello stesso barcode inquadrato non conta più pezzi: allontanarlo prima di ripresentarlo.

Per questa prima versione sono ammessi articoli con unità principale in pezzi e quantità intere; righe sospese, unità alternative o quantità frazionarie bloccano l'allestimento con messaggio esplicito. La riapertura di una preparazione annullata conserva le scansioni e richiede nuovo riscontro.

## Verifiche del 30 ottobre 2026

- Build Vite di produzione e lint dei nuovi componenti/backend.
- Test dominio, autenticazione, API e SQL: `node --test test/order-preparation.test.mjs test/order-preparation-auth.test.mjs`. I due test SQL richiedono `PGLITE_MODULE` impostato al modulo locale PGlite; senza variabile sono esplicitamente saltati.
- Flusso browser reale contro API e PostgreSQL locali con Mexal sintetico: cartone + pezzo, mancanti, due colli, un bancale, riscontro, DDT simulato, PDF e ripresa dopo ricaricamento. Controllato viewport mobile 390x844 senza overflow dell'intera pagina. PDF renderizzato e verificato visivamente.
- Letture reali Mexal del formato OCM/DDT e servizio non modificante `totali_documento`: payload BC con righe esplicite accettato. Nessuna emissione reale, movimento di magazzino, migrazione o pubblicazione in produzione eseguiti durante lo sviluppo.
- Da completare prima dell'uso operativo: prova della fotocamera sui dispositivi effettivi e prima trasformazione controllata di un OCM reale, verificando in Mexal evasione dell'origine, DDT e scarico dei lotti. Il servizio di calcolo non dimostra da solo l'effettiva trasformazione nativa.

Con esito DDT incerto senza documento rintracciabile serve verifica amministrativa su Mexal; non è previsto un pulsante che azzeri il blocco e rischi di emettere un duplicato. Le riserve Workspace non sono prenotazioni globali Mexal: altri operatori/integrazioni possono modificare i progressivi tra una lettura e l'emissione, che resta soggetta ai controlli del gestionale.
