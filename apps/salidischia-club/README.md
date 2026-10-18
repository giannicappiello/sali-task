# Sali di Ischia Club

App web installabile indipendente da Workspace, con accessi consumatori e negozi. Usa il database Supabase condiviso attraverso sole procedure Club. Il pannello amministrativo rimane in **CRM BtoC → SalidischiaClub**.

## Sviluppo

Da questa cartella: `npm ci`, poi `npm run dev`. Configurare in `.env.local` solamente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Non inserire chiavi service role nel frontend.

Logo, immagine e palette riprendono il catalogo Sali di Ischia fornito dal committente. Il pulsante **Scarica Fidelity** usa il prompt di installazione quando disponibile e mostra le istruzioni del dispositivo negli altri casi. Su Safari la disponibilità di Home/Dock dipende dalla versione del sistema.

## Accesso amministratori sul sito Club

Gli utenti attivi con ruolo Amministratore Workspace accedono anche al sito Club usando le stesse credenziali. Il server verifica il ruolo interno e i permessi CRM; non viene creata un’iscrizione cliente. La panoramica e gli elenchi mostrano dati reali di tutti i negozi, con accesso alle bozze dei documenti e approvazione delle richieste secondo i permessi già esistenti.

Il selettore **Esplora le schermate** apre le modalità Cliente, Negozio, Pagina di accesso e Modulo di iscrizione. Le prove riutilizzano i componenti effettivi con un adattatore locale senza accesso a Supabase. Il banner indica sempre i dati dimostrativi. Il contesto è condiviso tra Cliente e Negozio nella stessa pagina; ricaricare o scegliere Ripristina prova lo azzera. Le prove non verificano invio email o pagamenti esterni. Per il QR/fotocamera, la lettura effettiva richiede il permesso del dispositivo.

## Aggiornamenti dell’app installata

Il controllo avviene all’apertura, al ritorno alla pagina e periodicamente quando è visibile e connessa. Una nuova versione resta in attesa e mostra **Nuova versione disponibile**. **Aggiorna ora** la attiva e ricarica la pagina; **Più tardi** riduce l’avviso a un richiamo riapribile, conservando i moduli aperti. Un aggiornamento confermato in un’altra scheda non forza il ricaricamento delle altre schede.

## Profili staff e visibilità

Agenti, beauty, responsabili e backoffice usano gli account Workspace attivi. Occorrono i permessi già configurati sul modulo CRM BtoC e sulle schermate SalidischiaClub; il Club non assegna automaticamente nuovi privilegi. Menu e azioni riflettono i livelli lettura/scrittura/amministrazione. La visibilità dei negozi usa `crm_visible_canonical_customer_codes()`; gli iscritti sono collegati attraverso il negozio di fiducia o la visibilità della loro anagrafica CRM (`crm_row_visible`). Associazioni beauty, gerarchie e reparti rimangono quelli Workspace. Anche KPI, dettagli, elenchi del CRM e mutazioni sono filtrati sul server; acquisti e richieste mantengono il vincolo del negozio autorizzato.

HTTPS è servito da Vercel con redirect HTTP, HSTS e aggiornamento automatico delle richieste di risorse HTTP verso HTTPS. Non aggirare errori di certificato sul client.

## Apertura del programma

1. In **Negozi**, selezionare il responsabile CRM e l’email assistenza.
2. In **Regolamento**, completare i due documenti in bozza, rivederne i contenuti e pubblicarli. I campi `[[DA DEFINIRE]]` impediscono la pubblicazione. Regolamento e privacy sono consultabili in `/regolamento` senza accesso; ogni pubblicazione ha un URL permanente e i consensi registrano la versione mostrata.
3. In **Configurazione**, impostare cashback, rimborsi e consegne; salvare e pubblicare la decorrenza. Aggiungere i premi disponibili.
4. Abilitare i negozi CRM BtoB e generare inviti nominativi per gli operatori. Il link, valido sette giorni e una sola volta, va condiviso con il destinatario. Nessuna email viene inviata automaticamente dal CRM.
5. Verificare consegna delle email di conferma e recupero password sul dominio finale prima del lancio ai clienti.

Le iscrizioni nell’interfaccia rimangono chiuse finché responsabile CRM, regolamento e privacy non sono pubblicati. L’accredito degli acquisti richiede inoltre una configurazione pubblicata e già in vigore. I documenti iniziali sono bozze da completare; non certificano la qualificazione giuridica del programma.

## Hosting

Progetto Vercel dedicato `salidischia-club`, directory radice `apps/salidischia-club`, build `npm run build`, installazione `npm ci`, output `dist`, Node 24. Dominio previsto: `club.salidischia.it`.

Nel progetto Supabase gli URL di ritorno consentiti devono comprendere `https://club.salidischia.it/**` e `https://salidischia-club.vercel.app/**`. Preservare gli URL e le impostazioni degli altri servizi.

Le migrazioni richieste sono `20261017120000`, `20261017150000` `20261017151000` `20261017160000` e `20261017170000`. Non applicare migrazioni estranee al Club durante un rilascio mirato.

## Confini dei dati

Le identità Club sono marcate sul server e non possono ottenere un profilo operatore Workspace. Le API sono limitate alle procedure Club e le policy restrittive proteggono i dati Workspace e gli oggetti Storage. Le tabelle Club non sono accessibili direttamente ai client. Il negozio vede esclusivamente i clienti attualmente associati; il cambio negozio revoca immediatamente l’accesso al precedente. Le richieste già inviate mantengono la destinazione originaria e possono richiedere gestione CRM dopo il cambio.

Acquisti, righe, movimenti wallet e cronologia CRM sono registrati atomicamente. Le chiavi di idempotenza evitano doppi accrediti o richieste duplicate. La consegna in negozio verifica il codice del cliente e utilizza la riserva una sola volta; lo storno non può sottrarre cashback già utilizzato o riservato.

## Verifica

Dal repository: `node --test test/club-model.test.mjs test/club-database.test.mjs test/club-public-database.test.mjs test/club-admin-access.test.mjs test/club-staff-scope.test.mjs`, con `@electric-sql/pglite` disponibile o `PGLITE_MODULE` impostato al suo URL file. Sono coperti permessi, isolamento utenti/negozi, consensi/versioni, acquisti, storni, richieste, approvazioni, spedizioni e consegne. Eseguire inoltre le build di Workspace e dell’app Club e verificare nel browser desktop e mobile.

Per il ciclo di aggiornamento PWA, dopo la build Club eseguire `node test/club-pwa-updates.browser.mjs` dal repository, con Playwright disponibile oppure `PLAYWRIGHT_MODULE` impostato al suo URL file. La prova usa due versioni di service worker, due schede e moduli compilati; verifica rinvio, aggiornamento esplicito e assenza di ricaricamento forzato nell’altra scheda. Gli artefatti della prova rimangono nella cartella temporanea generata.

## Prodotti, novità e comunicazioni

In CRM BtoC → SalidischiaClub, **Prodotti** gestisce nome e descrizione pubblici, visibilità, categorie e materiali selezionati dalla stessa libreria documentale Workspace. Le foto principali rimangono collegate al prodotto Workspace. La tassonomia iniziale è stata acquisita dal sito ufficiale il 18 ottobre 2026 (41 categorie); solo le corrispondenze esatte SKU/codice Mexal sono classificate automaticamente. I prodotti non abbinati mostrano “Da classificare” nel CRM. Le modifiche successive delle categorie sul sito non vengono importate automaticamente.

**Novità e comunicazioni** permette di salvare bozze, collegare prodotti e file Workspace, impostare destinatari (tutti, clienti, negozi, staff), evidenza e periodo di visibilità. La pubblicazione e l’archiviazione richiedono amministrazione sulla schermata; la scrittura consente preparare bozze. Un contenuto pubblicato si modifica creando una copia in bozza e archiviando la versione precedente. I controlli usano le schermate `crm.online.club.catalogo` e `crm.online.club.contenuti`, senza assegnare nuovi privilegi ai ruoli.

Il Club espone `/prodotti`, `/novita` e `/comunicazioni`; home cliente, negozio, staff e pagina iniziale includono ricerca e sezioni editoriali. La ricerca supporta nome, codice, EAN, parole nella descrizione e categorie (comprese sottocategorie).

I documenti della libreria restano privati finché selezionati in un prodotto visibile o in un contenuto pubblicato, nel suo periodo e per i destinatari autorizzati. Il ponte same-origin `/api/club-media` inoltra solo ID al servizio documentale Workspace; la firma NAS e le credenziali restano nel backend Workspace. Gli URL durano 15 minuti. Non vengono esposti percorsi NAS, dati economici interni o l’intera libreria al pubblico. Non attivare cache pubbliche per questo endpoint.

Migrazione aggiuntiva: `20261018100000_salidischia_club_catalog_content.sql`. Verifiche: `node --test test/club-catalog-content.test.mjs server/club-media.test.js server/document-section-scope.test.js`. Per la prova completa CRM → pubblicazione → Club, usare `node test/club-catalog-content.browser.mjs` con `PGLITE_MODULE` e `PLAYWRIGHT_MODULE` se i moduli non sono disponibili nel progetto. La prova usa un database isolato; non inserisce contenuti o clienti in produzione.

## Offerte del negozio e prezzi

Il riferimento al pubblico è `prodotti.prezzo_listino`, ossia il listino Mexal 1 sincronizzato da Workspace, usato **senza aggiungere IVA**. Non viene sostituito dal prezzo del sito o da altri listini. Se manca un prezzo valido, il Club non inventa un valore e richiede di verificarlo in negozio; un prezzo di vendita esplicito del negozio può comunque essere mostrato.

Nell’area negozio **Offerte → Crea Offerta**, l’operatore prepara e pubblica promozioni relative solo al proprio negozio: percentuale o prezzo di vendita diretto su tutti i prodotti, una categoria (comprese le sottocategorie) o un prodotto; acquisto combinato di prodotti e quantità minime con omaggio oppure ulteriore percentuale. Sono disponibili bozze, programmazione, scadenza e sospensione. La pubblicazione usa l’ultima versione salvata; per modificare una promozione attiva si duplica in bozza oppure la si sospende. La cronologia delle versioni è conservata nel database.

Per ciascun prodotto viene scelto il prezzo più conveniente fra le promozioni semplici attive del negozio. In assenza di promozioni vale il listino Mexal. Il riferimento barrato e il risparmio percentuale compaiono solo quando il prezzo finale è inferiore al listino; un prezzo di vendita superiore non viene presentato come sconto. Lo sconto aggiuntivo delle offerte combinate è sequenziale, si applica solo ai prodotti richiesti e solo al raggiungimento di tutte le quantità minime. Non si sommano più offerte combinate. Gli omaggi rimangono condizionati e non vengono presentati come un prezzo zero automatico nel catalogo.

La home mostra **Sconti e Offerte dal tuo negozio**; il catalogo applica soltanto le promozioni del negozio di fiducia attualmente scelto dal consumatore. Il cambio negozio, la sospensione o la scadenza revocano il vantaggio alle letture successive. Lo staff Workspace può consultare e sospendere le offerte in **Negozi → Offerte**, entro gli stessi ambiti e permessi della schermata Negozi. I consumatori non possono scegliere un codice negozio arbitrario nelle richieste del catalogo.

Il calcolo delle offerte combinate nel Club è una simulazione: non invia ordini, non riserva stock o omaggi e non sostituisce lo scontrino. La registrazione dell’acquisto continua a usare gli importi realmente pagati, dopo gli sconti; solo questi generano cashback. Le prove amministratore rimangono simulate senza scritture reali.

Migrazione: `20261018110000_salidischia_club_store_offers.sql`. Verifiche: `node --test test/club-store-offers.test.mjs`; `node test/club-store-offers.browser.mjs` con gli stessi moduli PGlite/Playwright descritti sopra. Il percorso completo copre creazione, pubblicazione, prezzi barrati, prezzo diretto, condizioni, isolamento tra negozi, sospensione e cambio del negozio di fiducia.
