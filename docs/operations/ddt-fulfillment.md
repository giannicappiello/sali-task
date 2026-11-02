# Allestimento, BCF, email e stampa

## Flusso

La scansione accetta IT e MKT, anche da QR, preservando i controlli sui codici
ambigui. L'articolo deve essere presente in anagrafica; prodotti estranei,
eccedenze e mancanti impediscono il riscontro.

Nel capitolato si compilano **Pezzi per cartone** e **Colli per bancale**.
Pezzi/bancale è il loro prodotto, non un secondo valore indipendente. Se sono
compilati anche cartoni/strato e strati, il prodotto deve coincidere con il
numero di colli. Una lettura Bancale richiede un bancale vuoto con un solo
collo vuoto selezionato: crea atomicamente tutti i colli e le letture correlate.
Il retry con lo stesso eventId non duplica la lettura. Ogni lettura conserva
quantità, modalità e versione del capitolato usate; modifiche successive al
capitolato non riscrivono lo storico. MKT può avere un capitolato senza essere
riclassificato globalmente come prodotto finito.

Il riscontro chiude i colli. **Riapri e modifica** richiede un motivo, invalida
il riscontro e libera le riserve FIFO. L'editor mostra tutte le letture del
collo e permette rimozioni parziali/totali e aggiunte. Occorre poi riscontrare
nuovamente. Dopo emissione o esito Mexal incerto il contenuto non è modificabile.
La rettifica di un documento emesso resta un procedimento amministrativo separato.

## Configurazioni DDT

Nuova schermata **Impostazioni → Integrazioni → Configurazioni DDT**,
`/integrations/configurazioni-ddt`, codice `integrazioni.ddt`.
La lettura usa il catalogo schermate; la modifica e i recuperi richiedono
`integrations.configure` sulla schermata. Utenti cliente/portale sono esclusi
anche dal backend. Non vengono assegnati automaticamente nuovi permessi.

Il pannello gestisce indirizzi backoffice, oggetto/corpo email, collegamento
PDF Mexal, verifica contratto BCF, stampanti DDT/packing list, invii e stampe.
Le modifiche usano la versione della configurazione e conservano prima/dopo.
Il magazziniere non seleziona la stampante durante la stampa.

Cliente: email dell'anagrafica Mexal riletta prima dell'emissione. Agente:
`codice_agente` dell'OCM e `mexal_agenti.email`. Backoffice: elenco specifico
DDT del pannello, senza dedurre il modulo commerciale dall'OCM. Tutti e tre
i ruoli sono obbligatori; indirizzi identici sono deduplicati mantenendo i
ruoli. Il riepilogo emissione mostra i destinatari. Un hash vincola la conferma
allo snapshot corrente; variazioni richiedono un nuovo riepilogo.

## Contratto Mexal e attivazione

Il payload nuovo usa `sigla=BC`, `cod_modulo=F`. Il terzo carattere è un modulo
di stampa aziendale, non una dichiarazione di stato fatturato/sospeso.
Riferimento: [manuale Passepartout](https://www.edupass.it/manuali/manualistica-mexal/manuale-prodotto?a=manuale-prodotto/magazzino/emissione-differita-documenti/ristampa-documenti).

**Il contratto aziendale F e il suo endpoint PDF non sono stati verificati live
in questo intervento.** L'emissione nuova è bloccata per impostazione iniziale.
Non esiste un endpoint di stampa inventato o un fallback a BCS. Prima di attivare:

1. Leggere help WebAPI e una BCF aziendale esistente; verificare F, serie,
   riferimenti origine, causale, righe, lotti ed evasione nativa dell'OCM.
2. Verificare il servizio PDF sul documento esistente. Configurare il percorso
   relativo `/documenti/...` con un solo `{reference}`, sostituito col riferimento
   BC URL-encoded. Il client richiede `application/pdf`, controlla firma e dimensione.
3. Registrare evidenza della verifica e abilitare il contratto nel pannello.
4. Verificare cliente, agente e backoffice reali e configurazione del worker email.
5. Solo con autorizzazione operativa eseguire una prima trasformazione controllata,
   verificando origine evasa, BCF e movimenti dei lotti direttamente in Mexal.

La POST di emissione rimane unica e viene preceduta dal claim persistito.
Un timeout consente solo riconciliazione tramite marcatore ALL e controlli
di origine/quantità/lotti. La riconciliazione delle vecchie BCS conserva il
cod_modulo del payload storico. Errori successivi di PDF/email non riaprono
l'emissione: **Completa documenti e invii** recupera esclusivamente gli artefatti.

## PDF e email

Una transazione archivia BCF originale, PDF DDT con tre copie complete,
packing list completa e una packing list per ciascun bancale. Quelle per
bancale includono solo i relativi colli/lotti e i suoi totali/pesi, conservando
la numerazione originale. Gli allegati email sono soltanto BCF originale e
packing list completa, dallo stesso snapshot definitivo. Non vengono ricostruiti
da dati correnti al momento del retry.

File, SHA-256 e snapshot sono immutabili. Per mantenere compatibilità con i
limiti del worker HTTP, BCF+packing list per l'invio non devono superare circa
3 MB. File troppo grandi bloccano l'invio con errore visibile, senza riemettere BCF.

La coda DDT è distinta dalle conferme commerciali. Claim con lease e token,
massimo cinque tentativi e ritardo crescente. Il worker salva `sending`
prima di chiamare il servizio email. Dopo un esito di accettazione incerto
non si riprova automaticamente: il pannello richiede verifica, motivo e
conferma esplicita dell'esito o di un nuovo tentativo. `sent` significa
accettazione dal servizio email, non consegna nella casella finale.

Aggiornare `hosting/aruba-order-email/worker.php` insieme al backend: solo
worker che dichiarano `shipment_protocol=1` ricevono invii DDT. Anche il worker
Node e la funzione Supabase utilizzano il nuovo dispatcher condiviso. Il cron
Aruba esistente recupera i retry quando è questo il trasporto attivo; non
installare più scheduler inutilmente.

## Stampa sulle stampanti configurate

Il repository MES espone stampe dei fogli produzione, non un contratto generico
per questi PDF. Il nuovo agente Windows `workers/ddt-print/index.mjs` espone
l'inventario delle stampanti Windows e preleva una coda dedicata. Impostare
nell'ambiente dell'agente:

- `DDT_WORKSPACE_URL`: origine HTTPS di Workspace;
- `DDT_PRINT_WORKER_SECRET`: segreto dedicato di almeno 32 caratteri,
  uguale a quello configurato sul backend; mai nel frontend;
- `DDT_PRINT_STATION`: identificativo stabile della postazione;
- `SUMATRA_PDF_PATH`: percorso dell'eseguibile SumatraPDF installato e verificato.

Avvio: `node workers/ddt-print/index.mjs`; `--once` per un giro singolo.
Configurare l'avvio nella postazione con l'account che vede le stampanti.
L'agente non è installato né avviato automaticamente da questa modifica.
La [stampa a stampante nominata](https://www.sumatrapdfreader.org/docs/Command-line-arguments)
usa argomenti separati, senza shell e senza finestre interattive. Non viene
mai aperto il selettore stampanti del browser. Il PDF DDT contiene già le tre
copie; all'agente viene richiesta una sola copia del file.

Selezionare DDT e packing list nel pannello dopo che l'agente ha comunicato
l'inventario. Stampante assente o postazione non aggiornata bloccano il job.
La richiesta mantiene lo stesso identificativo durante retry/verifica;
un crash dopo l'avvio della stampa produce `uncertain`, senza ristampa automatica.
`submitted` indica l'accettazione dal programma di stampa: verificare la carta.
Il pannello permette una ristampa motivata dopo verifica di un errore/esito incerto.

## Migrazioni e conservazione

Applicare, nell'ordine, soltanto le tre nuove migrazioni di questo intervento:

- `20261102110000_preparation_dispatch_audit.sql`;
- `20261102111000_ddt_configuration_screen.sql`;
- `20261102112000_ddt_print_queue.sql`.

Pubblicare backend/frontend/worker insieme dopo le verifiche sopra. Non è stata
applicata alcuna migrazione in produzione. Non modificare vecchie migrazioni
già installate. Il rollback applicativo non deve eliminare eventi, PDF o invii;
non ripristinare un vecchio backend che emetta BCS sulle nuove preparazioni.

Registro: identità stabile, nome operatore al momento dell'evento, timestamp DB,
versioni, snapshot e riferimenti a scansioni/correzioni/lotti/colli/bancali,
documenti, invii e stampe. Nessun timestamp storico sconosciuto viene ricostruito.
UPDATE/DELETE/TRUNCATE di eventi e documenti sono bloccati anche al service role;
gli amministratori proprietari del database restano un confine di fiducia.
Per protezione anche da amministratori occorrono copie esterne con retention
immutabile, non una semplice catena di hash nel medesimo database.

## Verifica automatica

Le suite `order-preparation*`, `preparation-dispatch`, `preparation-pdf`,
`preparation-weights`, `product-scan-camera`, `product-specifications` e le
regressioni email verificano il flusso con PostgreSQL/PGlite e Mexal sintetico.
Per le suite DB impostare `PGLITE_MODULE` al modulo PGlite disponibile localmente.
Queste prove non inviano email reali, non stampano e non movimentano Mexal.
Il modulo Genera ordine con AI rimane nel proprio flusso Workspace.
