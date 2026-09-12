-- Keep the existing SELECT grants and underlying customer RLS unchanged.
-- OFFSET 0 prevents EXISTS from becoming a hashed full customer-catalog scan:
-- each beauty link instead probes the customer's primary key before its RLS.
alter policy "workspace reads visible beauty clients"
on public.beauty_clienti_mexal
using (
  exists (
    select 1
    from public.ordini_clienti_cache c
    where c.codice_cliente = beauty_clienti_mexal.codice_cliente
      and (
        c.codice_agente_mexal in (select public.visible_mexal_agent_codes())
        or exists (
          select 1 from public.utenti u
          left join public.ruoli r on r.id = u.ruolo_id
          where u.auth_user_id = auth.uid()
            and u.attivo is not false
            and (
              coalesce(r.amministratore_workspace, false)
              or lower(coalesce(r.nome, '')) = any (
                array['admin', 'administrator', 'amministratore', 'super admin', 'direzione']
              )
            )
        )
      )
    offset 0
  )
);
