# Costi e consuntivi produzioni

## Schermate

- **CONFIGURAZIONE COSTI PRODUZIONE**: Configurazioni → Altre Impostazioni, percorso `/settings/costi-produzione`.
- **CONSUNTIVI PRODUZIONI**: Produzione → Analisi dati, percorso `/consuntivi-produzioni`.

Le autorizzazioni sono quelle delle due singole schermate. Non occorre autorizzare il modulo MES. Scritture e consultazione sono controllate anche dal server; gli account cliente restano limitati alle proprie anagrafiche.

## Attivazione

1. Aggiornare Workspace e applicare la migrazione Supabase `20260913040000`.
2. Nel repository MES eseguire fetch/pull di main e il normale **AGGIORNA-PROGREMES**. L'aggiornamento applica la migrazione additiva `20260913072858_AddProductionCostEvidence`; non abilitare migrazioni indiscriminate all'avvio.
3. Aprire **CONFIGURAZIONE COSTI PRODUZIONE**, caricare gli impianti da MES, inserire costo ora/uomo, turni, lavaggi e guadagno per turno di ciascuna STATION. Nessuna tariffa aziendale è precompilata o inventata.
4. Salvare la versione con la decorrenza appropriata.
5. Aprire **CONSUNTIVI PRODUZIONI** e premere **Importa / aggiorna storico MES**. L'importazione è paginata, ripetibile e non genera piani, lotti, SL o altri documenti.
6. Nel dettaglio confermare i lavaggi realmente eseguiti con la fonte del dato. Collegare le righe fattura non riconciliabili automaticamente.

## Regole

- Costo del personale = ore di presenza MES × unico costo ora/uomo. Le ore entro turni sono un indicatore distinto: non cancellano eventuali presenze straordinarie.
- Turni/festività definiscono il calendario di confronto economico, senza alterare il planner APS. Le pause senza collocazione oraria sono proporzionate all'intervallo.
- Costo lavaggio escluso personale, evitando di ricontare la manodopera. I lavaggi reali non vengono desunti dai lavaggi pianificati.
- Guadagno stimato per turno = ore macchina / ore del primo turno di riferimento × valore configurato per STATION. È un indicatore, non un costo né un ricavo. Una durata maggiore non dimostra un maggiore profitto.
- Il preventivo conserva il primo foglio, versione formula, quantità materiali, packaging, piano e prezzi disponibili. Per confezionamenti senza foglio proprio viene conservato all'avvio.
- Alla conferma degli SL si conservano quantità, riferimenti lotto, documento e prezzi realmente inviati a Mexal. Il prezzo è il costo ultimo utilizzato nel payload SL, non un prezzo storico di acquisto del lotto inventato.
- Gli SL già esistenti non vengono riemessi per creare uno snapshot. I vecchi prezzi non conservati rimangono sconosciuti. Un prelievo pianificato non è presentato come pesata effettiva.
- Consumo e prezzo sono scostamenti distinti. Le aggiunte correttive confluite nei prelievi non vengono aggiunte una seconda volta.
- Il costo per pezzo buono comprende bulk attribuito, confezionamento e perdite. Il bulk condiviso usa il lotto comune e la quantità del suo SL; fonte mancante o ambigua impedisce di esporre un costo unitario certo.
- I totali economici di produzione sommano i costi diretti, non i trasferimenti interni del bulk. I margini del prodotto usano invece il costo attribuito. Non si sommano KG e PZ.
- OCT e fatture non si sommano. Il ricavo OCT usa la riga collegata; in assenza di prezzo si usa una stima configurata e compatibile con l'unità. Le fatture richiedono un collegamento confermato: non basta avere lo stesso cliente/articolo. IVA esclusa, note credito negative, margine proporzionato alla quantità fatturata.
- La configurazione assegnata a una produzione non viene sostituita dalle sincronizzazioni successive. Tariffe inserite dopo la lavorazione sono esplicitamente indicate come ricostruite. Conferme lavaggio e attribuzioni fattura lasciano una traccia.

## Storico e completezza

La migrazione importa i riferimenti MES già presenti nelle conferme V4 Workspace, senza dedurne uno stato operativo corrente. L'importazione MES aggiunge il dettaglio disponibile anche per ordini anteriori a V4.

Senza l'aggiornamento MES i riferimenti pregressi restano consultabili ma presenze, stato corrente e consumi dettagliati non sono ancora disponibili. Un valore mancante non è zero: totali/margini incompleti vengono segnalati e non presentati come definitivi.

I dati sono aggiornati solo su richiesta, senza polling e senza allegati documentali.
