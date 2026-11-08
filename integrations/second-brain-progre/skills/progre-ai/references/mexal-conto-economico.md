# Conto economico Mexal

Eseguire BRAIN_STATUS e verificare identità corrente. Usare l'azione personale
`MEXAL_CONTO_ECONOMICO_READ` per analisi economica Progre esclusivamente Mexal.
Periodo iniziale 2026-01-01–2026-10-31; year/from/to selezionabili, senza date future,
un esercizio per chiamata. Nessun MES, nuove credenziali o scritture contabili.

Distinguere `amount` per competenza (null se non attestabile), `registeredAmount`
di sole registrazioni e `observedClassifiedSubtotal` diagnostico anche parziale.
Non trasformare subtotali o differenza registrata A-B in EBITDA, EBIT o ante imposte.
Non inventare rimanenze, ammortamenti mancanti, saldi, competenza o valuta.

Leggere coverage, reconciliation, officialEndpoint e sources. `complete=false`
per conto economico per competenza non attestato è distinto dall'esaurimento
cursori. Conti sconosciuti, errori o giornali non quadrati bloccano i totali registrati.
Spiegare i limiti insieme ai numeri, non soltanto in un'appendice.

Paginare i dettagli con nextOffset e snapshot, senza sommare nuovamente gli aggregati.
409 richiede ripartenza per dati/periodo cambiati. Nessuna modifica ai permessi per
risolvere un diniego. Se il backend espone la funzione ma la chat non la elenca,
aggiornare le azioni della connessione esistente; non dichiararla invocabile prima
della verifica del catalogo e di una chiamata riuscita.
