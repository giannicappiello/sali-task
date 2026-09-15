# Revisione priorità: disimpegno articoli ed eccedenze

## Procedura

1. Aprire **Revisione priorità produzione** e selezionare l'OP esatto.
2. Leggere fabbisogno, fisico utilizzabile MES, prenotazioni totali, riserva della destinazione e minimo da disimpegnare.
3. Selezionare le origini e le quantità **da disimpegnare**. L'eccedenza è un avviso gestibile, non rende le origini indisponibili. Le origini avviate, consumate o prive di una prenotazione autorevole univoca restano protette.
4. Simulare. Il motore assegna alla destinazione solo il necessario; il resto elimina la sovraprenotazione o torna libero. Mostra bilancio fisico, scoperti, arrivi già attribuibili e conseguenze sul piano.
5. Confermare il riepilogo. MES applica impegni e planning in un'unica transazione, con hash e audit; Workspace riallinea i fabbisogni senza duplicare OP o acquisti.
6. Rigenerare e stampare i fogli interessati. L'avvio rimane manuale e soggetto ai controlli MES.

Il processo si applica agli articoli prenotabili della distinta senza filtri sul prefisso MP: materie prime, packaging, componenti e bulk fisico. Il bulk ancora da produrre internamente resta una dipendenza produttiva, non una scorta disponibile da inventare. La revisione non cambia formule, giacenze, lotti fisici o movimenti SL/CL. Eventuali vincoli di planning o dati non univoci rimangono espliciti.

## Calcolo

Con `P` fisico utilizzabile, `R` prenotazioni totali, `T` riserva attuale della destinazione e `Q` suo fabbisogno:

- eccedenza: `max(0, R - P)`;
- minimo disimpegno: `max(0, R + max(0, Q - T) - P)`;
- dopo aver liberato `D` dalle origini, la destinazione mantiene la sua riserva e riceve solo la quota necessaria fisicamente coperta;
- il totale prenotato risultante deve essere non superiore a `P`.

Esempio: `P=1924`, `R=2285`, `T=Q=83`: liberare almeno 361 dalle origini, mantenere 83 alla destinazione. Non assegnarle anche i 361 pezzi.

## IA

Percorso comune: `MES_PRIORITY_LOOKUP` → `MES_PRIORITY_MATERIALS` → `MES_PRIORITY_SIMULATE` → proposta `MES_PRIORITY_REVISE` → conferma utente. L'IA può proporre origini e quantità se richiesto, deve spiegare le conseguenze e non può applicare una semplice simulazione. `transfers.quantity` rappresenta il disimpegno dall'origine, anche quando `missing=0`. La disponibilità minima è indicata da `minimumRelease`.

Il trasferimento semplice non può aggirare il percorso coordinato per le eccedenze. Permessi, conferma esplicita, scadenza di 15 minuti, controllo hash e idempotenza restano invariati. In caso di esito incerto usare `MES_PRIORITY_STATUS`, non ripetere il trasferimento.

## Rilascio e verifiche

Richiede MES con `reservationReleaseVersion >= 2`. Aggiornare MES dopo il pull del main; finché risponde il motore precedente, UI e IA chiedono l'aggiornamento. Nessuna nuova migrazione DB per questa estensione.

Verifiche: suite MES Planning, test IA con `MES_SOURCE_ROOT` configurato, build Workspace, lint file modificati, controllo confine segreti e verifica browser locale con API simulate. I test non disimpegnano prenotazioni reali. La verifica applicativa sul server richiede il MES aggiornato e una scelta esplicita delle origini da parte dell'utente.
