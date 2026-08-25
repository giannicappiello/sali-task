begin;

create or replace function public.crm_visible_customer_areas()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select
      coalesce(r.amministratore_workspace, false) as is_admin
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
    limit 1
  )
  select case
    when auth.role() = 'service_role' then array['conto_terzi', 'b2b', 'online']::text[]
    when coalesce((select is_admin from me), false) then array['conto_terzi', 'b2b', 'online']::text[]
    when not exists (select 1 from me) then '{}'::text[]
    else array_remove(array[
      case when public.crm_has_module_level('crm_conto_terzi', 'lettura') then 'conto_terzi' end,
      case when public.crm_has_module_level('crm_b2b', 'lettura') then 'b2b' end,
      case when public.crm_has_module_level('crm_online', 'lettura') then 'online' end
    ]::text[], null)
  end;
$$;

create or replace function public.crm_visible_canonical_customer_codes()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select
      u.codice_agente_mexal,
      coalesce(r.amministratore_workspace, false) as is_admin,
      coalesce(r.ambito_dati, 'propri') as data_scope
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
    limit 1
  ), visible_agents as materialized (
    select public.normalize_mexal_agent_code(code) as code
    from public.visible_mexal_agent_codes() code
  )
  select customer.codice_cliente::text
  from public.ordini_clienti_cache customer
  where auth.role() = 'service_role'
  union
  select customer.codice_cliente::text
  from public.ordini_clienti_cache customer
  cross join me
  where
    me.is_admin
    or me.data_scope = 'tutti'
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
    );
$$;

revoke all on function public.crm_visible_customer_areas() from public, anon;
revoke all on function public.crm_visible_canonical_customer_codes() from public, anon;
grant execute on function public.crm_visible_customer_areas() to authenticated, service_role;
grant execute on function public.crm_visible_canonical_customer_codes() to authenticated, service_role;

drop policy if exists "crm customer classifications scoped read"
  on public.crm_customer_classifications;
create policy "crm customer classifications scoped read"
on public.crm_customer_classifications
for select to authenticated
using (
  area_crm::text = any(public.crm_visible_customer_areas())
  and codice_cliente::text in (
    select customer_code
    from public.crm_visible_canonical_customer_codes() customer_code
  )
);

comment on function public.crm_visible_customer_areas() is
  'Aree CRM leggibili dal caller, calcolate senza accedere alla tabella classificazioni.';
comment on function public.crm_visible_canonical_customer_codes() is
  'Codici cliente canonici leggibili per scope propri/team/tutti, senza ricorsione RLS.';

commit;
