# Sprint 3.1 - Serie documenti Mexal

Endpoint verificato dal file help Mexal:
`/webapi/risorse/dati-generali/serie-documenti`

Il precedente 404 dipendeva dall'assenza del prefisso `/risorse`.

Funzioni:
- sincronizzazione serie da Mexal tramite Vercel;
- salvataggio in Supabase;
- selezione Serie OCM e Serie OCX in Impostazioni > Ordini;
- configurazione centralizzata, senza variabili MEXAL_OCM_SERIE e MEXAL_OCX_SERIE.
