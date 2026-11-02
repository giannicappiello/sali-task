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

Il recupero del PDF usa `POST /webapi/servizi` con comando
`stampa_movimento_magazzino` e `dati={sigla:BC,serie,numero,cod_conto,cod_modulo:F}`.
Il 2 novembre 2026 la prova in produzione su BC+1+23 ha restituito un PDF
di 564545 byte, SHA256 f22194398afbe0c3338106b08acaac74f925e28b7716aedb0a74ef6fb4b40065.
La verifica automatica legge un BC esistente, richiede il modulo F, valida il
PDF e registra evidenza e collegamento nella configurazione con controllo
concorrenza. Non emette nuovi documenti. Il catalogo reale conferma BCF
"Stampa Indirizzo" e BCS "Bolla senza Prezzi".

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

Il worker Aruba esistente supporta gia allegati multipli e conferma con token.
Per le richieste storiche `X-Worker-Source: aruba` senza `shipment_protocol`,
il backend registra `sending` prima di restituire il messaggio: una risposta
claim persa o un errore ambiguo resta `uncertain` senza reinvio automatico.
I worker aggiornati dichiarano `shipment_protocol=1` e registrano il marker
prima di chiamare `mail()`. Non occorre aggiornare il file Aruba per il flusso
compatibile. Anche il worker Node e la funzione Supabase utilizzano il dispatcher condiviso. Il cron
Aruba esistente recupera i retry quando è questo il trasporto attivo; non
installare più scheduler inutilmente.

## Stampa sulle stampanti configurate

Il servizio di stampa integrato Workspace/MES espone `GET /api/workspace/v1/printers`, `POST /api/workspace/v1/print` e `GET /api/workspace/v1/print/{id}`. Il gateway DDT riusa `PROGREMES_URL` e `PROGREMES_INTEGRATION_SECRET` sul server. Non occorre un secondo agente, SumatraPDF o un nuovo segreto.

Configurazioni DDT sincronizza le stampanti disponibili per stampa silenziosa dal MES. Le scelte DDT e packing restano in questo pannello. Il PDF DDT contiene gia tre copie; al MES viene inviata una copia del file. Ogni packing list contiene il solo bancale selezionato.

Il registro Workspace conserva PDF, SHA-256, richiesta, stampante ed esito MES. Un timeout viene riconciliato riusando identico PDF e requestId: non crea una nuova stampa. Dopo aver ricevuto l'identificativo MES si controlla lo stato tramite GET. Completed nel MES indica accettazione dallo spooler; Workspace lo espone come submitted, senza attestare l'uscita della carta. Le ristampe esplicite fanno riferimento al job MES originale.

L'invio al cliente e all'agente si abilita separatamente. Le preferenze entrano nell'hash dell'anteprima e nello snapshot confermato. Le anagrafiche disattivate non vengono richieste o validate. Gli invii gia preparati mantengono lo snapshot originale. Il backoffice resta obbligatorio per una nuova emissione.

Elimina rimuove collo e scansioni insieme, richiede conferma e motivo per colli pieni, invalida il riscontro e libera le riserve FIFO. Il registro conserva contenuto rimosso e operatore. Ordini completati o con emissione incerta restano protetti.

## Migrazioni e conservazione

Applicare, nell'ordine, le migrazioni di questo intervento:

- `20261102110000_preparation_dispatch_audit.sql`;
- `20261102111000_ddt_configuration_screen.sql`;
- `20261102112000_ddt_print_queue.sql`;
- `20261102120000_ddt_recipient_preferences.sql`;
- `20261102121000_ddt_mes_print_bridge.sql`.

Pubblicare backend/frontend/worker insieme dopo le verifiche sopra. Non modificare vecchie migrazioni
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
