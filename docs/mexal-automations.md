# Automazioni Mexal

## Architettura e sicurezza
Le sincronizzazioni manuali restano il percorso primario e chiamano gli endpoint Mexal esistenti: non usano timer React né duplicano mapping o credenziali. Le regole configurate risiedono in `mexal_automation_rules`; le esecuzioni e ciascuna fase vengono registrate in `mexal_automation_runs` e `mexal_automation_action_runs`.

Il dispatcher server-side `POST /api/mexal/automation-dispatcher` è invocato ogni 15 minuti da Vercel Cron. Richiede `Authorization: Bearer $MEXAL_AUTOMATION_SECRET`; non accetta chiamate anonime. Configurare inoltre `CRON_SECRET` (usato solo per delegare agli endpoint Mexal), `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` solamente nell'ambiente server. Non inserire nessuno di questi valori nel client.

## Regole, frequenze e azioni
Ogni regola è disabilitata per default e modificabile via RLS solo da amministratori. Le frequenze sono manuale, 15/30 minuti, 1/2/6/12 ore, giornaliera, settimanale e orario giornaliero personalizzato; il fuso è `Europe/Rome`. Il dispatcher acquisisce un lock ottimistico su `next_run_at`, crea una run e calcola la prossima esecuzione al termine.

Le azioni di sincronizzazione `clients`, `products`, `stocks`, `commercial_conditions` e `document_series` riusano `syncRegistry`. Le azioni ordini/PDF/e-mail sono predisposte ma restano `skipped` con “Configurazione incompleta” finché non esiste un endpoint Mexal verificato: non viene mai simulato un successo né inviato un ordine. Le catene sono ordinate; una fase bloccante fallita ferma la run. Le chiavi idempotenti impediscono la duplicazione delle action run; retry configurabili non sono ancora collegati agli endpoint ordini per evitare retry infiniti o invii duplicati.

## Deploy e operatività
1. Applicare la migrazione `20260721000000_mexal_automation_console.sql` in Supabase.
2. Configurare `MEXAL_AUTOMATION_SECRET` e `CRON_SECRET` in Vercel e nel chiamante cron.
3. Deployare: Vercel eseguirà il dispatcher con cron `*/15 * * * *`.
4. Un amministratore configura e abilita esplicitamente una regola dalla scheda Automazioni.

Per testare Clienti, creare/modificare un cliente in Mexal, usare **Sincronizza Clienti**, verificare `ordini_clienti_cache` e Nuovo Ordine, poi ripetere: l'upsert impedisce duplicati. In emergenza disabilitare tutte le regole: `update mexal_automation_rules set enabled = false where enabled = true;`.
