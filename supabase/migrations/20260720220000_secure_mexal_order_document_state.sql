-- This table is exclusively written/read by the Vercel backend using service_role.
-- No client policy is intentionally granted: users see aggregate status through ordini_testate.
alter table public.ordini_documenti_mexal enable row level security;

alter table public.ordini_documenti_mexal
  drop constraint if exists ordini_documenti_mexal_stato_check;
alter table public.ordini_documenti_mexal
  add constraint ordini_documenti_mexal_stato_check check (stato in (
    'pending', 'created', 'reconciled', 'failed', 'auth_error', 'temporary_error', 'missing', 'mismatch'
  ));
