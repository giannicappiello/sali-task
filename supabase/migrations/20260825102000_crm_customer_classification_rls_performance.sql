begin;

-- Calcola una sola volta per query l'insieme dei clienti canonici visibili.
-- Evita di ripetere la risoluzione utente/moduli/scope per ogni riga RLS.
create or replace function public.crm_visible_customer_classifications()
returns table(customer_code text, customer_area text)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      u.id,
      u.codice_agente_mexal,
      coalesce(r.amministratore_workspace, false) as is_admin,
      coalesce(r.ambito_dati, 'propri') as data_scope
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
    limit 1
  ), visible_agents as (
    select public.normalize_mexal_agent_code(code) as code
    from public.visible_mexal_agent_codes() code
  )
  select
    classification.codice_cliente::text as customer_code,
    classification.area_crm::text as customer_area
  from public.crm_customer_classifications classification
  join public.ordini_clienti_cache customer
    on customer.codice_cliente = classification.codice_cliente
  where
    auth.role() = 'service_role'
    or exists (
      select 1
      from me
      where
        me.is_admin
        or (
          classification.area_crm in ('conto_terzi', 'b2b', 'online')
          and public.crm_has_module_level(
            public.crm_module_for_type(classification.area_crm),
            'lettura'
          )
          and (
            me.data_scope = 'tutti'
            or (
              nullif(public.normalize_mexal_agent_code(customer.codice_agente_mexal), '') is not null
              and (
                (
                  me.data_scope = 'team'
                  and public.normalize_mexal_agent_code(customer.codice_agente_mexal)
                    in (select visible_agents.code from visible_agents)
                )
                or (
                  me.data_scope <> 'team'
                  and public.normalize_mexal_agent_code(customer.codice_agente_mexal) =
                    public.normalize_mexal_agent_code(me.codice_agente_mexal)
                )
              )
            )
          )
        )
    );
$$;

revoke all on function public.crm_visible_customer_classifications()
  from public, anon;
grant execute on function public.crm_visible_customer_classifications()
  to authenticated, service_role;

drop policy if exists "crm customer classifications scoped read"
  on public.crm_customer_classifications;
create policy "crm customer classifications scoped read"
on public.crm_customer_classifications
for select to authenticated
using (
  (codice_cliente::text, area_crm::text) in (
    select visible.customer_code, visible.customer_area
    from public.crm_visible_customer_classifications() visible
  )
);

comment on function public.crm_visible_customer_classifications() is
  'Insieme canonico clienti CRM visibili per area e scope, calcolato una volta per query RLS.';

commit;

