# Cancellazione OCT da Mexal

La sincronizzazione OCT conferma la cancellazione con una lettura puntuale del documento Mexal. L'assenza da un elenco filtrato, un timeout o un errore di autorizzazione non sono prove di cancellazione.

Gli import legacy con `mexal_anno = 0` usano l'anno della data ordine sia nella verifica SQL del ritiro sia nel payload MES. Il controllo sull'ultimo aggiornamento resta attivo. La chiamata firmata identifica l'evento con l'UUID dell'OCT.

La coda viene ripresa anche dal worker periodico, senza aspettare una nuova importazione OCT. Ogni passaggio elabora al massimo cinque richieste con budget di 30 secondi, preservando la priorità degli aggiornamenti manuali e il tempo della funzione. I blocchi restano persistiti sulla scheda OCT e non avviano una catena immediata di retry.

Il ritiro locale accoda atomicamente l'identità OCT, le righe e le RdP collegate. Dopo la sincronizzazione il servizio invia al MES una richiesta firmata a `/api/workspace/v4/oct-deletions`. Se il MES non è aggiornato o la risposta è incerta, la richiesta resta persistita e viene ritentata al successivo aggiornamento OCT. Un errore su un OCT non impedisce di elaborare gli altri; gli errori sono visibili sulla scheda OCT. La coda comprende anche gli OCT ritirati prima di questo rilascio.

Il MES elimina fisicamente OP V4, lavorazioni preparate, pianificazioni e riferimenti batch non avviati; rilascia prenotazioni e ricalcola la cache degli impegni. Snapshot commerciali, conferme e versioni del piano restano come audit e identità per i retry. Le righe degli altri OCT e i loro OP non vengono eliminati.

Lavorazioni avviate, materiali consumati, documenti di magazzino, esiti batch esterni incerti e produzioni condivise restano da riconciliare. Una risposta parziale lascia la cancellazione in attesa e segnala i blocchi. Non vengono inviati comandi macchina né cancellati lotti o documenti Mexal. La propagazione include le allocazioni V2/V3 e gli ordini cliente legacy identificati dalla chiave Mexal e dall'anno sorgente, con gli stessi controlli.

Soltanto dopo la conferma MES l'OCT scompare dal Workbench anche se conserva collegamenti storici. Una RdP con più OCT viene annullata soltanto quando tutti i suoi OCT sono stati eliminati nel MES; preview e conferme con sorgenti eliminate vengono bloccate. Se Mexal ricrea un OCT, la nuova importazione invalida la richiesta locale precedente. L'installazione MES è necessaria per completare la propagazione.
