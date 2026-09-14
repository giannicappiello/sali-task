# Riallocazione materie prime per priorità produttiva

Dal Workbench, il pannello **Priorità produzione · Rialloca materie prime impegnate**
permette di verificare una RdP completa e una MP, scegliere le quantità da liberare
da altri ordini e confermare il trasferimento. Richiede permessi operativi MES,
accesso IA e livello di proposta/conferma esistente; non modifica ruoli o aree.
La stessa operazione è disponibile all'assistente integrato tramite
`MES_MATERIAL_ALLOCATION_LOOKUP` e `MES_MATERIAL_REALLOCATE`.

## Comportamento

- Solo impegni MP V4 univoci; ordini origine/destinazione non avviati.
  Prenotazioni legacy/miste, SL/CL registrati, consumi e lavorazioni avviate
  sono segnalati e non vengono forzati.
- L'utente sceglie origini e quantità. L'IA non sceglie autonomamente gli ordini da penalizzare.
- L'anteprima mostra riserve residue e scoperti fisici sulle origini.
- MES ricontrolla dati e hash in transazione serializzabile prima di scrivere.
  Se cambia lo stato, serve una nuova anteprima e una nuova conferma.
- Revoca/storicizzazione delle vecchie prenotazioni, nuove riserve,
  aggiornamento impegni V4/scoperti e riallineamento coperture future.
  Nessuna modifica alla quantità fisica e nessun documento Mexal.
- I fogli coinvolti sono invalidati: rigenerarli e stamparli prima dell'avvio.
  L'avvio ordinario ricontrolla il foglio sotto lo stesso blocco delle riallocazioni.
- Audit MES persistente e idempotenza; in caso di timeout Workspace verifica
  l'esito nell'audit, senza ripetere automaticamente il trasferimento.

## Rilascio

1. Workspace: migrazione `20260914160000_mes_material_reallocation.sql` e deploy.
2. MES: fetch/pull di main e aggiornamento ordinario. Lo script applica
   `20260914105410_WorkspaceMaterialReallocationAudit` prima del riavvio.
3. Il gate MES `ConfirmV4Production` resta quello esistente.
   Non occorrono nuovi segreti o modifiche di autorizzazione.
4. Dopo l'aggiornamento verificare la RdP reale, scegliere i donatori,
   confermare, rigenerare/stampare il foglio e avviare con i normali controlli MES.
   Il rilascio non trasferisce materiali e non avvia alcuna lavorazione.

## Verifiche

14 test del servizio MES su trasferimenti, scoperti, futuro, consumi protetti,
stato obsoleto, duplicati, quantità e idempotenza; suite completa MES 360 test.
Test JS dedicati su identità, quantità, autorizzazioni e tunnel firmato.
Pannello provato nel browser su fixture locali: ricerca, proposta, conferma,
risultato e assenza di errori console. Applicazione reale su SQL Server da
verificare dopo l'aggiornamento MES, con le origini scelte dall'utente.
