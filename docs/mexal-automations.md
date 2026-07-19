# Automazioni Mexal

Il dispatcher server-side `GET /api/mexal/automation-dispatcher` è invocato da Vercel Cron ogni 15 minuti. Vercel invia `Authorization: Bearer $CRON_SECRET`: il dispatcher confronta quel solo secret in timing-safe mode e risponde 401 se assente o errato. Non richiede `MEXAL_AUTOMATION_SECRET`. Il dispatcher delega agli endpoint Mexal server-side con lo stesso `CRON_SECRET`; `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` restano solo server-side.

Le regole sono in `mexal_automation_rules`; run e fasi in `mexal_automation_runs` e `mexal_automation_action_runs`. RLS permette le modifiche solo agli amministratori. Il salvataggio avviene da `/api/mexal/automation-rules`, che calcola `next_run_at`: manuale e disabilitata restano `null`; le regole abilitate hanno una prossima run calcolata server-side.

`custom_daily` cerca l'istante UTC il cui orario locale è Europe/Rome, quindi gestisce CET/CEST e il cambio di ora; può limitare i giorni (`Mon`…`Sun`). Le azioni clients/products/stocks/condizioni commerciali/serie riusano il registry. Ordini, PDF ed e-mail non hanno endpoint verificati e restano non configurati: non sono eseguiti né simulati.

## Deploy
1. Applicare `20260721000000_mexal_automation_console.sql`.
2. Configurare `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
3. Un admin abilita una singola regola nella console; per emergenza: `update mexal_automation_rules set enabled=false,next_run_at=null where enabled;`.
