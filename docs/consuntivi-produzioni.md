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

- STATION: costo personale = operatori Miscelazione attivi × unico costo ora/uomo × (turni ordinari × ore economiche configurate per turno + ore straordinarie). Le presenze restano consultabili, ma non sono il moltiplicatore economico STATION. FILLING: invariato il costo delle presenze effettive.
- Turni/festività definiscono il calendario di confronto economico, senza alterare il planner APS. Le pause senza collocazione oraria sono proporzionate all'intervallo.
- Costo lavaggio escluso personale, evitando di ricontare la manodopera. I lavaggi reali non vengono desunti dai lavaggi pianificati.
- Gli orari/giorni dei turni sono definiti nel pannello; nessun turno 2 implicito. Le frazioni ordinarie arrotondano al mezzo turno superiore per ciascun turno occupato. Con turno 09:00–16:00: 09:00–17:00 = 1 turno + 1 ora straordinaria; 09:00–11:00 del giorno dopo = 1,5 turni. La notte senza turni non conta. Base economica iniziale 8 ore per turno, configurabile separatamente dagli orari; straordinari alla tariffa ora/uomo senza maggiorazione.
- Guadagno stimato STATION = turni ordinari × valore configurato per STATION. È un indicatore, non un costo né un ricavo. Lo straordinario resta separato e non genera un guadagno aggiuntivo implicito.
- Il preventivo conserva il primo foglio, versione formula, quantità materiali, packaging, piano e prezzi disponibili. Per confezionamenti senza foglio proprio viene conservato all'avvio.
- Alla conferma degli SL si conservano quantità, riferimenti lotto, documento e prezzi realmente inviati a Mexal. Il prezzo è il costo ultimo utilizzato nel payload SL, non un prezzo storico di acquisto del lotto inventato.
- Gli SL già esistenti non vengono riemessi per creare uno snapshot. I vecchi prezzi non conservati rimangono sconosciuti. Un prelievo pianificato non è presentato come pesata effettiva.
- Consumo e prezzo sono scostamenti distinti. Le aggiunte correttive confluite nei prelievi non vengono aggiunte una seconda volta.
- Il costo per pezzo buono comprende bulk attribuito, confezionamento e perdite. Il bulk condiviso usa il lotto comune e la quantità del suo SL; fonte mancante o ambigua impedisce di esporre un costo unitario certo.
- I totali economici di produzione sommano i costi diretti, non i trasferimenti interni del bulk. I margini del prodotto usano invece il costo attribuito. Non si sommano KG e PZ.
- OCT e fatture non si sommano. Il ricavo OCT usa la riga collegata; in assenza di prezzo si usa una stima configurata e compatibile con l'unità. Le fatture richiedono un collegamento confermato: non basta avere lo stesso cliente/articolo. IVA esclusa, note credito negative, margine proporzionato alla quantità fatturata.
- La configurazione assegnata non viene sostituita dalle sincronizzazioni. Il salvataggio delle tariffe associa automaticamente le produzioni ancora prive di versione, rispettando la decorrenza. L'opzione esplicita “Applica questa versione anche alle produzioni storiche prive di preventivo congelato” registra una rettifica economica, senza modificare snapshot originali o dati MES. Tariffe inserite dopo la lavorazione sono indicate come ricostruite.

## Recupero dello storico e aggiornamento settembre 2026

- La migrazione Workspace `20260913050000` associa le configurazioni mancanti senza cambiare quelle congelate.
- Dopo fetch/pull e aggiornamento MES, **Importa / aggiorna storico MES** recupera anche revisione formula collegata, dati della riga ordine cliente legacy e organico Miscelazione attivo. Nessuna scrittura su SL, lotti, magazzino o piano APS.
- Le quantità dei prelievi con scarico registrato sono recuperate già dagli import precedenti. Se manca il prezzo originale SL, vengono valorizzate al costo ultimo conservato nell'import e marcate **ricostruite**. Non si creano finti documenti SL; prelievi senza scarico non sono consumi effettivi.
- Il preventivo storico viene ricostruito soltanto dalla revisione formula fissata o da quella univoca dei prelievi. Prezzi e distinta packaging correnti sono dichiarati come tali; non si sostituisce la revisione con l'ultima formula attiva. Per prodotti finiti senza quantità bulk pianificata non si convertono arbitrariamente pezzi in kg.
- I valori disponibili sono esposti anche come **subtotali parziali**, senza trasformare i costi mancanti in zero. Il totale definitivo resta incompleto se manca una voce necessaria.
- Per bulk/packaging senza snapshot SL vengono esposti anche gli impegni V4 marcati consumati: fabbisogno e costo ultimo sono una stima esplicita, non vengono spacciati per quantità/prezzi della riga SL. Nessun impegno attivo viene presentato come consumo.
- Le righe OCT legacy sono attribuite economicamente soltanto con articolo/unità coincidenti e quantità complessive non superiori alla riga. I valori documentali non attribuibili restano visibili nel dettaglio Economia.
- Le fatture prive di un riferimento univoco alla produzione richiedono attribuzione esplicita; non vengono abbinate automaticamente solo per cliente o articolo. Lavaggi non registrati e prezzi storici assenti restano segnalati.
- Per cambiare gli orari anche sullo storico: caricare impianti/organico, impostare i turni, scegliere la decorrenza desiderata e selezionare l'applicazione allo storico prima del salvataggio.

## Definizione dei criteri con IA

Nella stessa **CONFIGURAZIONE COSTI PRODUZIONE** è disponibile «Definisci criteri e obiettivi con l’IA». Richiede scrittura sulla schermata e le abilitazioni IA già previste in Workspace, compresa l’analisi dati interni.

1. Caricare impianti e organico Miscelazione da MES se non sono ancora presenti.
2. Descrivere all’IA tariffa, turni, regole STATION/FILLING e margine desiderato per ciascuna STATION. Rispondere agli eventuali chiarimenti.
3. Verificare il confronto prima/proposta, le formule esplicite e gli esempi calcolati dal motore. Esempi fittizi e valori mancanti sono indicati.
4. Spuntare la conferma e premere **Trasferisci proposta confermata nel modulo**. Nessuna versione è ancora attiva.
5. Scegliere decorrenza e premere **Salva nuova versione**. Lo storico già assegnato resta invariato, salvo applicazione esplicita allo storico ricostruito. Le modifiche manuali successive alla proposta vengono salvate come versione manuale.

Le proposte sono conservate per autore e riapribili dallo storico o dal collegamento della pagina. La conferma viene verificata sul server contro la proposta conservata; l’IA non può scrivere configurazioni né eseguire codice/SQL. Richieste non rappresentabili restano da chiarire.

- **STATION:** base a turni oppure ore entro calendario; arrotondamento turno esatto, mezzo superiore o intero superiore; moltiplicatore straordinario esplicito. Organico Miscelazione attivo e unica tariffa ora/uomo.
- **FILLING:** preventivo operatori × ore entro calendario oppure durata del planning, includendo o escludendo la manodopera lavaggi pianificati. Consuntivo dalle presenze reali. Arrotondamento per intervallo esatto, 15, 30 o 60 minuti. Nessun uso dell’organico Miscelazione.
- **Margine obiettivo STATION:** dopo tutti i costi di produzione conteggiati, distinto da costi e ricavi. Il report mostra margine obiettivo e margine sopra/sotto obiettivo; il consuntivo fatturato viene proporzionato alla stessa quantità. Con più STATION senza criterio di attribuzione univoco il confronto non viene inventato.

Le versioni precedenti senza criteri espliciti mantengono i valori iniziali: mezzo turno superiore, straordinario senza maggiorazione, FILLING entro calendario con lavaggi pianificati e presenze esatte. La maggiorazione si applica solo alle nuove versioni configurate.

Questo rilascio richiede la migrazione Workspace **20260913110000_production_cost_ai_proposals.sql**; non aggiunge modifiche o migrazioni MES. Se l’aggiornamento MES del rilascio precedente è già installato, non occorre ripeterlo.

## Completezza dei dati

La migrazione importa i riferimenti MES già presenti nelle conferme V4 Workspace, senza dedurne uno stato operativo corrente. L'importazione MES aggiunge il dettaglio disponibile anche per ordini anteriori a V4.

Senza l'aggiornamento MES i riferimenti pregressi restano consultabili ma presenze, stato corrente e consumi dettagliati non sono ancora disponibili. Un valore mancante non è zero: totali/margini incompleti vengono segnalati e non presentati come definitivi.

I dati sono aggiornati solo su richiesta, senza polling e senza allegati documentali.
