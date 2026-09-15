# Revisione priorità produzione

Schermata Workspace autonoma `/revisione-priorita-produzione`, catalogo `produzione.revisione_priorita`, area Produzione, modulo Gestione produzione (`progremes`). Una sola intestazione fornita dal layout Workspace.

## Uso

1. Dal Workbench o da OP, planning e foglio MES scegliere **Anticipa produzione**. Cercare l'OP completo, inclusi i suffissi; per OCT non confermati generare prima gli OP dal normale Workbench.
2. Selezionare materiali, origini non avviate e quantità. Inserire avvio desiderato e motivazione, oppure usare **Proponi con IA**.
3. **Simula revisione** mostra prenotazioni prima/dopo, scoperti, arrivi assegnati e conseguenze sulle date, preservando le lavorazioni estranee e avviate.
4. Dopo aver esaminato il riepilogo, confermare esplicitamente. La revisione conserva gli OP/RdP originali: non genera produzioni duplicate. I fabbisogni non documentati vengono aggiornati o creati; gli ordini senza copertura tornano da pianificare.
5. Rigenerare e stampare i fogli interessati. L'avvio produzione resta un'azione manuale distinta.

La simulazione scade dopo 15 minuti; una variazione di materiali, ordine, calendario o piano impone una nuova simulazione. Le produzioni avviate/consuntivate e i movimenti SL/CL sono protetti. Giacenze fisiche e documenti Mexal non sono modificati dalla revisione.

## Coerenza tra sistemi

MES applica la revisione in una transazione serializzabile, sotto lo stesso blocco usato dagli avvii, e conserva un esito durevole. Workspace aggiorna atomicamente i propri fabbisogni dal risultato MES. **Da riconciliare** non equivale a fallimento del trasferimento: usare **Verifica esito / completa allineamento**, senza ripetere la riallocazione.

Le successive rigenerazioni APS rivalutano la copertura degli OP revisionati su impegni, scorte realmente libere e arrivi assegnati. Non possono pianificarli scoperti con la generica opzione “materiali mancanti”. I nuovi arrivi/scorte permettono di recuperare fattibilità, sempre secondo calendario e capacità.

Il preflight verifica i mirror V4 e protegge gli acquisti già documentati: un fabbisogno documentato con scoperto residuo richiede prima riconciliazione degli arrivi, non un ordine fornitore duplicato. Distinte V4 mancanti o ambigue richiedono riconciliazione prima di confermare.

## IA e permessi

Strumenti `MES_PRIORITY_LOOKUP`, `MES_PRIORITY_MATERIALS`, `MES_PRIORITY_SIMULATE`, `MES_PRIORITY_REVISE`, `MES_PRIORITY_STATUS`. L'IA può proporre e simulare; applica solo attraverso il normale audit di conferma, con evidenza riletta dal server e permessi MES operativi già previsti. Nessuna assegnazione a utenti/ruoli viene modificata dal rilascio.

## Rilascio

Workspace: migrazione `20260914180000_workspace_priority_revisions.sql` e deploy frontend/API.
MES: migrazione `20260914171352_WorkspacePriorityRevisions`, inclusa nel target di aggiornamento. L'utente esegue fetch, pull e AGGIORNA-PROGREMES. Fino all'aggiornamento, Workspace segnala che MES deve essere aggiornato.

Verifiche: suite MES (371 test), regressioni AI/permessi (50 test), build Workspace, controllo schema/preflight SQL in transazione annullata; browser con fixture locale (desktop e mobile, conferma esplicita, nessun dato reale modificato). La riallocazione reale non viene usata come test di pubblicazione.
