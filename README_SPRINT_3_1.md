# Sprint 3.1 - Serie documenti Mexal

Endpoint verificato dal file help Mexal:
`/webapi/risorse/dati-generali/serie-documenti`

Il precedente 404 dipendeva dall'assenza del prefisso `/risorse`.

Funzioni:
- sincronizzazione serie da Mexal tramite Vercel;
- salvataggio in Supabase;
- selezione Serie OCM e Serie OCX in Impostazioni > Ordini;
- configurazione centralizzata, senza variabili MEXAL_OCM_SERIE e MEXAL_OCX_SERIE.

## Endpoint e diagnostica amministrativa

L'endpoint documentato nel repository/help per questa risorsa è
`/webapi/risorse/dati-generali/serie-documenti`. La sincronizzazione lo compone una
sola volta anche quando `MEXAL_BASE_URL` contiene già `/webapi/risorse`.

La forma effettiva restituita dall'installazione Mexal viene ora registrata, senza
segreti, in `mexal_sync_runs.metadata.diagnostics`: endpoint, stato HTTP, tipo e
chiavi root, array trovati, percorsi candidati e un campione limitato. L'amministratore
può aprirla e copiarla dalla pagina **Serie documenti**. Questo è intenzionalmente lo
strumento di verifica della forma reale quando la risposta JSON non contiene record
riconoscibili; la struttura reale resta da verificare con la prima chiamata in produzione e non vengono inventati alias per adattare oggetti estranei.
