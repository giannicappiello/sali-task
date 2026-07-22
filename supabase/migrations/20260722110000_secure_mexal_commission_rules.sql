-- Commission rules are operational data: clients never write them directly.
alter table public.mexal_regole_provvigioni enable row level security;

drop policy if exists "admins read mexal commission rules" on public.mexal_regole_provvigioni;
create policy "admins read mexal commission rules" on public.mexal_regole_provvigioni
for select to authenticated using (
  exists (
    select 1 from public.utenti u left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid() and u.attivo is not false
      and (coalesce(r.livello, 0) >= 80 or lower(coalesce(r.nome, '')) in ('admin','administrator','amministratore','super admin','direzione'))
  )
);
-- No INSERT/UPDATE/DELETE policy is intentionally granted to authenticated users.
-- Server-side service_role bypasses RLS when a verified Mexal contract exists.
