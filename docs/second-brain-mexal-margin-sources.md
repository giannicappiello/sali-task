# Lettura fonti marginalità Mexal

`MEXAL_MARGIN_SOURCES_READ` è una lettura amministrativa GRE autorizzata da Giovanni il 9 novembre 2026. Mantiene la verifica live dell'identità personale amministratore e dello scope `tutti` prima di contattare Mexal. Non registra dati, non modifica gestionali e non invia comunicazioni.

Il dataset `accounting` legge piano conti, testate con data statistica e righe prima nota con soli GET verificati nel catalogo live. La selezione mensile usa data statistica se presente, altrimenti registrazione. I codici UE non attestano gli abbinamenti allo schema ADP personalizzato: i conti aggiuntivi richiedono riconciliazione.

Il dataset `SL` legge le testate dei documenti SCARICO LAVORAZIONE e i totali originali (documento e IVA), con paginazione di massimo 100 documenti e snapshot delle chiavi. Il chiamante deve esaurire tutti i cursori e controllare identità, validità dei totali, valuta e copertura. Non ricostruisce prezzi dalle righe. Nessun percorso arbitrario o scrittura è esposto.

Verificati in anteprima tutti i 1.853 SL gennaio–ottobre 2026. Successiva approvazione esplicita della pubblicazione produttiva e promozione del candidato `dpl_A2Exr6jt5teQbdopKt26rE9HVbMH` il 9 novembre. Verifica sul dominio operativo: 213 documenti settembre e primo SL 13010, con azione `read` e identità personale confermate.

I prezzi articolo assenti non sono zero validati. La rettifica del solo report per Espositore IT0002 a 0,2172 è autorizzata separatamente in chat, fondata sul costo precedente e sulla riga SL 12344 dell'11 maggio. Non viene scritta in Mexal né applicata automaticamente dallo strumento inventario. Diffusore IT0555: costo assente, distinta ancora da compilare; totale valorizzazione non attestato. Nessuna pianificazione periodica è stata attivata.
