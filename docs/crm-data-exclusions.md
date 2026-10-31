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

## Prestazioni e aggiornamento incrementale (30 ottobre 2026)

crm_invoice_rollups e crm_order_rollups conservano soltanto i riepiloghi numerici per documento. Le tabelle Mexal originali rimangono complete. Le viste CRM mantengono gli stessi nomi, colonne, esclusioni e criteri di visibilità.

I trigger di testata e i trigger di statement sulle righe aggiornano i soli documenti coinvolti, inclusi entrambi i documenti quando una riga cambia padre. I cambiamenti sono atomici con la sincronizzazione; non dipendono da un cron. La prima migrazione ricostruisce lo storico una sola volta. Non disabilitare questi trigger negli importatori. Le funzioni interne di aggiornamento non sono invocabili da utenti applicativi.

Il dettaglio clienti condiviso da tutti i CRM e le varianti PH/PR/MYPHARMA raggruppano una volta fatture e ordini per il gruppo autorizzato. Le pagine successive mantengono il conteggio globale e gli stessi filtri. I collegamenti contabili usati per escludere ordini già fatturati restano sulle fonti originali.

Il limite API di authenticated e authenticator passa a 15 secondi; anon mantiene il limite precedente. L’aumento non sostituisce la verifica dei tempi: le nuove query sono collaudate anche con il vecchio limite di 8 secondi. La migrazione notifica PostgREST per ricaricare la configurazione.

Test: server/crm/crm-rollups.test.js (equivalenza viste, aggiornamenti e cancellazioni, spostamento righe, RLS, divieto di modifica o ricostruzione dei riepiloghi da utenti applicativi). Benchmark ripetibile con rollback e ruolo autenticato: server/crm/crm-performance-verification.sql. Il confronto delle vecchie e nuove funzioni su dati reali copre B2B, Online, conto terzi, PH, PR, MYPHARMA e le seconde pagine.

## Fatturato IVA esclusa
Dal 31 ottobre 2026 card, elenchi, dettagli, confronti e contesto AI utilizzano il medesimo imponibile ufficiale di crm_invoice_financials.net_amount, dopo le esclusioni CRM. Lo zero e le note di credito sono conservati. Se manca l’imponibile, si usa totale documento meno IVA documentata, oppure il netto delle righe; mai il solo totale lordo o una divisione fissa per 1,22. I documenti originali conservano lordo e IVA per la contabilità.
I KPI digitali utilizzano solo importi netti comprovati. Le righe Amazon richiedono evidenza fiscale; in assenza il netto resta non disponibile, mentre il totale documento IVA inclusa resta esplicitamente identificato nel dettaglio. I dati originali necessari ai COX non vengono modificati.
I consuntivi Workspace collegati al MES attribuiscono il fatturato alle lavorazioni dalle righe fattura nette; il MES importa i valori commerciali netti. Nessuna modifica ai comandi macchina o ai parametri di produzione.
