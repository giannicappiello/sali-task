# Cron e automazioni Mexal

Vercel invoca una sola volta al giorno `GET /api/cron/mexal-dispatcher` (23:00 UTC).
La richiesta deve contenere `Authorization: Bearer $CRON_SECRET`.

Il dispatcher legge soltanto le regole abilitate in `mexal_sync_schedules`, le esegue
nell'ordine configurato e isola gli errori: il fallimento di una regola non impedisce
le successive. Prodotti e giacenze sono paginati fino al completamento della stessa
run, quindi i contatori finali includono tutti i batch.

Gli amministratori possono abilitare/disabilitare le regole con `automation-rules` e
avviare una regola (o `sync_all`) con `automation-run-now`. Gli ordini non sono inclusi
nell'avvio automatico per evitare reinvii non idempotenti.
