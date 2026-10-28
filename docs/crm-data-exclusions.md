# Esclusioni dei dati CRM

Dal 28 ottobre 2026 tutte le letture CRM dei documenti Mexal usano le viste analitiche crm_sales_invoices, crm_sales_invoice_lines, crm_sales_orders e crm_sales_order_lines.

- Escludere le fatture con sigla FT e serie 4; non escludere altre serie né le note di credito della serie 4.
- Escludere il codice articolo ARTGEN esatto, ignorando maiuscole/minuscole e spazi esterni. ARTGEN2 rimane valido.
- Nei documenti misti mantenere le altre righe e sottrarre soltanto imponibile e IVA ARTGEN dai totali di testata. I valori netti delle righe includono già gli sconti.
- Non conteggiare come attività commerciale i documenti composti esclusivamente da ARTGEN. Conservare i documenti senza righe ancora disponibili.
- Le righe prive di UDM restano incluse.
- Non modificare le tabelle importate, le sincronizzazioni o i collegamenti contabili. In particolare invoice_refs e workspace_order_invoice_links devono vedere anche le fatture escluse dalle statistiche: un ordine già fatturato non torna aperto.

Le viste usano security_invoker e i permessi/RLS delle fonti originali. Le funzioni CRM mantengono firme e controlli di autorizzazione. Le nuove funzioni CRM che leggono documenti Mexal devono usare le stesse viste analitiche.

Verifica: server/crm/crm-exclusions.test.js; confronto transazionale in produzione di KPI B2B, PH, PR e MYPHARMA e degli ordini aperti prima/dopo.
