# Sali di Ischia Club

App web installabile indipendente da Workspace, con accessi consumatori e negozi. Usa il database Supabase condiviso attraverso sole procedure Club. Il pannello amministrativo rimane in **CRM BtoC → SalidischiaClub**.

## Sviluppo

Da questa cartella: `npm ci`, poi `npm run dev`. Configurare in `.env.local` solamente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Non inserire chiavi service role nel frontend.

Logo, immagine e palette riprendono il catalogo Sali di Ischia fornito dal committente. Il pulsante **Scarica Fidelity** usa il prompt di installazione quando disponibile e mostra le istruzioni del dispositivo negli altri casi. Su Safari la disponibilità di Home/Dock dipende dalla versione del sistema.

## Accesso amministratori sul sito Club

Gli utenti attivi con ruolo Amministratore Workspace accedono anche al sito Club usando le stesse credenziali. Il server verifica il ruolo interno e i permessi CRM; non viene creata un’iscrizione cliente. La panoramica e gli elenchi mostrano dati reali di tutti i negozi, con accesso alle bozze dei documenti e approvazione delle richieste secondo i permessi già esistenti.

Il selettore **Esplora le schermate** apre le modalità Cliente, Negozio, Pagina di accesso e Modulo di iscrizione. Le prove riutilizzano i componenti effettivi con un adattatore locale senza accesso a Supabase. Il banner indica sempre i dati dimostrativi. Il contesto è condiviso tra Cliente e Negozio nella stessa pagina; ricaricare o scegliere Ripristina prova lo azzera. Le prove non verificano invio email o pagamenti esterni. Per il QR/fotocamera, la lettura effettiva richiede il permesso del dispositivo.

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

Le migrazioni richieste sono `20261017120000`, `20261017150000` `20261017151000` e `20261017160000`. Non applicare migrazioni estranee al Club durante un rilascio mirato.

## Confini dei dati

Le identità Club sono marcate sul server e non possono ottenere un profilo operatore Workspace. Le API sono limitate alle procedure Club e le policy restrittive proteggono i dati Workspace e gli oggetti Storage. Le tabelle Club non sono accessibili direttamente ai client. Il negozio vede esclusivamente i clienti attualmente associati; il cambio negozio revoca immediatamente l’accesso al precedente. Le richieste già inviate mantengono la destinazione originaria e possono richiedere gestione CRM dopo il cambio.

Acquisti, righe, movimenti wallet e cronologia CRM sono registrati atomicamente. Le chiavi di idempotenza evitano doppi accrediti o richieste duplicate. La consegna in negozio verifica il codice del cliente e utilizza la riserva una sola volta; lo storno non può sottrarre cashback già utilizzato o riservato.

## Verifica

Dal repository: `node --test test/club-model.test.mjs test/club-database.test.mjs test/club-public-database.test.mjs test/club-admin-access.test.mjs`, con `@electric-sql/pglite` disponibile o `PGLITE_MODULE` impostato al suo URL file. Sono coperti permessi, isolamento utenti/negozi, consensi/versioni, acquisti, storni, richieste, approvazioni, spedizioni e consegne. Eseguire inoltre le build di Workspace e dell’app Club e verificare nel browser desktop e mobile.
