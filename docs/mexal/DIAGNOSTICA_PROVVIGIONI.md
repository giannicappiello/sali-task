# Diagnostica provvigioni Mexal

## Correzione del catalogo

La diagnostica introdotta dalla PR #82 interrogava sette percorsi che terminavano in `help.json`. Erano percorsi relativi errati: il client Mexal costruisce sempre `{MEXAL_BASE_URL}/webapi/risorse{path}`, quindi `getJson("/help.json")` chiedeva `/webapi/risorse/help.json` e riceveva `404 / 1004`.

Il catalogo verificato è invece `/webapi/risorse/help`. La diagnostica usa prima, e soltanto per la lettura del catalogo, `client.getJson("/help")`; l'URL finale risulta quindi `/webapi/risorse/help`.

## Funzionamento

Il JSON `/help` non viene restituito né registrato integralmente. La diagnostica lo scansiona ricorsivamente (oggetti e array), includendo chiavi e valori testuali di risorse, URL, metodi, descrizioni, parametri, proprietà, schemi ed esempi. Le corrispondenze includono i termini relativi a provvigioni, commissioni, agenti, condizioni e ai campi tecnici elencati nella UI.

Da quel catalogo estrae esclusivamente endpoint documentati, deduplicati per endpoint e metodo. Per ogni risorsa mostra endpoint, metodo, descrizione, termini, parametri obbligatori/optional, campi schema, percorso JSON e affidabilità. Non aggiunge percorsi manuali.

## Prove controllate e limiti

Sono interrogati solo endpoint documentati `GET`, senza parametri obbligatori. POST, PUT, PATCH e DELETE e le risorse con parametri non disponibili sono mostrate come **documentato ma non interrogato**. Le risposte sono ridotte a struttura, campi e massimo tre record, con profondità quattro e scalari di 80 caratteri; i campi sensibili sono oscurati e non si registrano payload completi.

Il report JSON scaricabile contiene solo questa sintesi. La route rimane riservata agli amministratori, usa solo GET e non scrive in Supabase o in Mexal.

`endpointVerified` resta `false` finché una singola risposta (o una sequenza documentata) non dimostra la relazione tra **categoria cliente**, **categoria prodotto** e **percentuale provvigione**. La presenza separata di `cod_cat_pr`, `id_categoria_pr` o `perc_provv` non è una prova. Il report indica risorse e campi trovati, dati mancanti e il prossimo test necessario; non avvia alcuna sincronizzazione automatica.

Nessuna percentuale viene inventata. Il motore esistente e la regola verificata `2 + 3 = 7,5%` restano invariati, così come EVADIBILE/SOSPESO e la serializzazione degli ordini.
