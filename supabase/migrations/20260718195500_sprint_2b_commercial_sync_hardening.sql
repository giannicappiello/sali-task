-- Sprint 2B - consolidamento sincronizzazione condizioni commerciali
-- Migrazione idempotente: può essere eseguita anche se lo Sprint 1 è già installato.

create index if not exists idx_ordini_sconti_listini_sync_run
  on public.ordini_sconti_listini (sync_run_id);

create index if not exists idx_ordini_particolarita_sync_run
  on public.ordini_particolarita (sync_run_id);

create index if not exists idx_ordini_regole_pagamento_sync_run
  on public.ordini_regole_pagamento (sync_run_id);

create index if not exists idx_ordini_sync_details_run_created
  on public.ordini_sync_run_details (run_id, created_at);

create index if not exists idx_ordini_sync_errors_run_created
  on public.ordini_sync_errors (run_id, created_at);

create or replace view public.v_ordini_condizioni_commerciali_conteggi as
select
  (select count(*) from public.ordini_sconti_listini where is_active = true) as matrice_sconti_attive,
  (select count(*) from public.ordini_particolarita where is_active = true) as particolarita_attive,
  (select count(*) from public.ordini_regole_pagamento where is_active = true) as regole_pagamento_attive,
  (select max(completed_at) from public.ordini_sync_runs
    where sync_type = 'commercial_conditions'
      and status in ('completed', 'completed_with_warnings')) as ultima_sincronizzazione;

comment on view public.v_ordini_condizioni_commerciali_conteggi is
  'Conteggi sintetici delle condizioni commerciali attive importate da Mexal.';
