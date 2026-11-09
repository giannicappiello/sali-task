# Lettura inventario Mexal tramite Second Brain

Stato: calcolo implementato e collaudato via API il 09/11/2026 su candidato protetto. Il dominio operativo non è stato modificato.

`MEXAL_INVENTORY_READ` accetta `from`, `to` e, facoltativamente, `year`. È una lettura riservata all'amministratore personale verificato e al perimetro analitico tutti, con gli stessi controlli delle altre letture finanziarie.

Perimetro gestionale richiesto: azienda GRE, codici IT, magazzini 1–10. L'aggregazione deve precedere il filtro delle esistenze positive, coerentemente con la stampa inventario raggruppata. I negativi dei singoli lotti non vanno eliminati prima dell'aggregazione.

Le due ricerche POST sono consultazioni native `/articoli/ricerca` e `/documenti/movimenti-magazzino/righe/ricerca`, con filtro codice che inizia per IT, costruito sul server. Non vengono ammessi percorsi, comandi, filtri o servizi arbitrari. Nessuna scrittura, sincronizzazione, stampa fisica, email o modifica di permessi.

Il contratto live `/help` è controllato prima delle letture. Tutti i cursori delle collezioni vengono esauriti. I progressivi colonnari sono uniti per indice e verificati con `num_prog_art`. Una fonte incompleta, un filtro ignorato o un formato imprevisto blocca la lettura. I campi numerici omessi nelle matrici sparse rappresentano zero secondo il Manuale WebAPI 3.1, pagine 235–238; un costo articolo mancante non è invece uno zero.

Il calcolo conserva i segni e distingue carichi, scarichi, resi e trasferimenti. I documenti trasformati FT da BC, FF da BF e BS da BC mantengono la data del documento origine per il movimento fisico. I movimenti solo a valore non modificano le quantità. Le causali quantitative personalizzate e le unità alternative non ancora verificate producono una lacuna esplicita e bloccano i totali. Gli IN sono già compresi nella base iniziale Mexal, indipendentemente dalla data, e non vengono sommati una seconda volta.

Il costo ultimo anagrafico letto oggi è distinto dal costo ultimo storico. La base prezzi deve essere dichiarata e comune ai due valori; non è autorizzata una sostituzione silenziosa con `valore_inventa` o con `unit_cost` degli snapshot Workspace. Il collaudo richiesto è 01/09/2026–30/09/2026. Il risultato economico già confermato prima del magazzino è 59.222,10 EUR, da rettificare soltanto dopo verifica della variazione IT.

Fonte operativa ufficiale: https://www.edupass.it/manuali/manualistica-mexal/manuale-prodotto?a=manuale-prodotto/magazzino/stampe-di-magazzino/inventario

Verifiche locali: test di autorizzazione revocata, date, sole ricerche ammesse, segni negativi, paginazione, cursori ciclici, formato sparso, copertura, filtro IT e indisponibilità esplicita dei totali. Test esistenti finanziari e autenticazione eseguiti insieme.

Distribuzione: usare un candidato protetto senza assegnazione del dominio; verificare identità, progetto e azione di sola lettura prima del collaudo. Non usare lo script generico di rilascio che applica anche migrazioni. La revisione automatica ha richiesto approvazione esplicita per la pubblicazione del candidato con configurazione di produzione. Il titolare ha approvato la pubblicazione protetta di prova. Candidato verificato: https://sali-task-nj1r4b2ac-progre1.vercel.app . Nessuna promozione al dominio operativo è stata effettuata.

## Esito del collaudo settembre 2026

Lettura live 09/11/2026 15:33:41 UTC: 489 articoli, 35.965 righe di movimento (36 pagine) e 1.269 progressivi IT distribuiti sui magazzini 1–10. La riconciliazione separata carichi/scarichi passa su 791 posizioni articolo-magazzino, senza differenze o righe irrisolte. Nessun articolo con giacenza positiva senza costo. Una riga a solo valore è stata esclusa dal movimento quantitativo. Gli importi sono nella valuta contabile Mexal, senza conversione. Il codice ISO della valuta di conto non è attestato dal solo catalogo valute.

- Inventario IT a fine giornata 01/09/2026: 358.619,86 (323 articoli positivi).
- Inventario IT a fine giornata 30/09/2026: 329.257,38 (324 articoli positivi).
- Variazione: -29.362,48.
- Risultato prima del magazzino confermato in chat: 59.222,10.
- Risultato gestionale dopo variazione: 29.859,62.

Costi ultimi letti il 09/11/2026, comuni alle due date; non costi storici. Conteggi e importi verificati indipendentemente con aritmetica decimale. Test automatici eseguiti: 47 superati. Non è stata eseguita una comparazione con una stampa inventariale ufficiale alle stesse date. Nessuno snapshot transazionale Mexal è attestato.
