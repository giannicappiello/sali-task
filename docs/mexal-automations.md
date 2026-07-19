# Automazioni Mexal

## Stato scheduler
Il precedente deploy Vercel falliva perché il piano del progetto non accetta il cron `*/15 * * * *`. Per non bloccare il deploy, `vercel.json` non dichiara alcun cron: le sincronizzazioni manuali continuano a funzionare. Per riabilitare le automazioni programmate configurare **Supabase Cron** o un piano Vercel compatibile, chiamando `GET /api/mexal/automation-dispatcher` ogni 15 minuti con `Authorization: Bearer $CRON_SECRET`.

Il dispatcher confronta `CRON_SECRET` in timing-safe mode e risponde 401 se assente o errato. Il secret resta server-side; browser e UI usano soltanto il token Supabase per endpoint amministrativi. Le regole sono in `mexal_automation_rules`; run e fasi in `mexal_automation_runs` e `mexal_automation_action_runs`.

Le regole abilitate ricevono `next_run_at` dall'endpoint amministrativo server-side; manuali e disabilitate lo ricevono `null`. Il calcolo `custom_daily` usa Europe/Rome e gestisce CET/CEST e giorni settimanali. Le azioni disponibili riusano il registry: Clienti, Prodotti, Giacenze, Condizioni commerciali/Modalità pagamento e Serie documenti. Agenti, Sync tutto, ordini, PDF ed e-mail sono **Non configurato** quando manca l’endpoint verificato: non vengono simulati né attivati.

## Deploy
1. Applicare `20260721000000_mexal_automation_console.sql`.
2. Configurare `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` esclusivamente lato server.
3. Configurare Supabase Cron o Vercel compatibile prima di abilitare automazioni programmate.
4. Emergenza: `update mexal_automation_rules set enabled=false,next_run_at=null where enabled;`.
