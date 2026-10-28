begin;

-- Preserve the complete installed session envelope (including multi-customer,
-- direct and private commercial flags introduced by later migrations).
do $migration$
declare definition text;
begin
  if to_regprocedure('public.workspace_own_data_scope()') is not null then
    raise exception 'Beauty area scope is already installed';
  end if;
  definition := pg_get_functiondef('public.workspace_data_scope()'::regprocedure);
  definition := replace(definition, 'FUNCTION public.workspace_data_scope()',
    'FUNCTION public.workspace_own_data_scope()');
  if definition = pg_get_functiondef('public.workspace_data_scope()'::regprocedure) then
    raise exception 'Unexpected scope function header';
  end if;
  execute definition;
end $migration$;

create or replace function public.workspace_data_scope_for_profile(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  with recursive me as materialized (
    select u.id, coalesce(r.amministratore_workspace, false) as admin,
      coalesce(r.ambito_dati, 'propri') as data_scope,
      coalesce(r.ambito_team, 'associazioni') as team_scope, l.customer_code
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    left join lateral (select min(customer_code) as customer_code from public.workspace_customer_user_links where user_id = u.id) l on true
    where u.id = p_profile_id and u.attivo is not false limit 1
  ), effective_scope as (
    select id, customer_code, team_scope,
      case when customer_code is not null then 'cliente'
        when admin or data_scope = 'tutti' then 'tutti' else data_scope end as mode
    from me
  ), departments as materialized (
    select d.id from public.reparti d cross join effective_scope s
    where d.attivo is not false and (s.mode = 'tutti'
      or (s.mode = 'team' and s.team_scope = 'reparti' and exists (
        select 1 from public.utenti_reparti ur where ur.utente_id = s.id and ur.reparto_id = d.id
      )))
  ), management_edges as materialized (
    select u.responsabile_utente_id as parent_id, u.id as child_id
    from public.utenti u where u.attivo is not false and u.responsabile_utente_id is not null
    union
    select a.responsabile_utente_id, u.id from public.mexal_agenti a
    join public.utenti u on u.id = a.workspace_utente_id or u.mexal_agente_id = a.id
    where a.attivo_mexal is not false and u.attivo is not false
      and a.responsabile_utente_id is not null
  ), base_members(id) as (
    select u.id from public.utenti u cross join effective_scope s
    where u.attivo is not false and (u.id = s.id or s.mode = 'tutti'
      or (s.mode = 'team' and s.team_scope = 'reparti' and exists (
        select 1 from public.utenti_reparti ur where ur.utente_id = u.id
          and ur.reparto_id in (select id from departments)
      )))
    union -- UNION (not ALL) also terminates malformed/cyclic hierarchies.
    select edge.child_id from base_members parent
    join management_edges edge on edge.parent_id = parent.id
    cross join effective_scope s where s.mode = 'team' and s.team_scope = 'gerarchia'
  ), agents as materialized (
    select a.id from public.mexal_agenti a cross join effective_scope s
    where a.attivo_mexal is not false and s.customer_code is null and (
      s.mode = 'tutti' or a.workspace_utente_id in (select id from base_members)
      or a.id in (select u.mexal_agente_id from public.utenti u where u.id in (select id from base_members))
      or exists (select 1 from public.integrazioni_utenti i
        where i.utente_id in (select id from base_members) and i.enabled is true and i.mexal_agente_id = a.id)
      or (s.mode = 'team' and s.team_scope = 'gerarchia'
        and a.responsabile_utente_id in (select id from base_members))
      or (s.mode = 'team' and s.team_scope = 'reparti' and a.responsabile_utente_id = s.id)
    )
  ), members as materialized (
    select id from base_members
    union
    -- An explicitly linked agent contributes their CRM records, but their own
    -- associations do not recursively grant unrelated agents or managers.
    select u.id from public.utenti u cross join effective_scope s
    where s.mode = 'team' and u.attivo is not false and exists (
      select 1 from public.mexal_agenti a where a.id in (select id from agents)
        and (a.workspace_utente_id = u.id or u.mexal_agente_id = a.id)
    )
  )
  select jsonb_build_object(
    'commercial_mode', case when exists (
      select 1 from public.utenti u
      join public.workspace_commercial_read_rules rule on rule.role_id = u.ruolo_id
      join public.utenti_reparti ur on ur.utente_id = u.id and ur.reparto_id = rule.department_id
      join public.reparti d on d.id = ur.reparto_id and d.attivo is not false
      where u.id = p_profile_id and u.attivo is not false
        and not exists (select 1 from public.workspace_customer_user_links l where l.user_id = u.id)
    ) then 'tutti'
      else coalesce((select mode from effective_scope), 'propri') end,
    'mode', coalesce((select mode from effective_scope), 'propri'),
    'team_scope', (select team_scope from effective_scope),
    'user_ids', coalesce((select jsonb_agg(id order by id) from members), '[]'::jsonb),
    'department_ids', coalesce((select jsonb_agg(id order by id) from departments), '[]'::jsonb),
    'agent_ids', coalesce((select jsonb_agg(id order by id) from agents), '[]'::jsonb),
    'customer_code', (select customer_code from effective_scope),
    'customer_codes', coalesce((select jsonb_build_array(customer_code)
      from effective_scope where customer_code is not null), '[]'::jsonb)
  );
$$;

-- Evaluate each profile independently. Inheritance affects commercial agents only;
-- it never grants a manager's operational role, departments or user ownership.
create or replace function public.workspace_data_scope()
returns jsonb language sql stable security definer set search_path = public
as $$
  with me as materialized (
    select u.*, coalesce(r.accesso_come_beauty, false) as beauty
    from public.utenti u left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid() and u.attivo is not false limit 1
  ), own_scope as materialized (
    select public.workspace_own_data_scope() as data
  ), linked_profiles as (
    select u.responsabile_utente_id as id from me u where u.beauty
    union
    select manager.id from me u
    join public.integrazioni_utenti i on i.utente_id = u.id
      and i.modulo = 'report_giornate' and i.enabled is true
    join public.mexal_agenti a on a.id = i.mexal_agente_id and a.attivo_mexal is not false
    join public.utenti manager on manager.id = a.workspace_utente_id or manager.mexal_agente_id = a.id
    where u.beauty
  ), inherited_scopes as materialized (
    select public.workspace_data_scope_for_profile(manager.id) as data
    from linked_profiles link join public.utenti manager on manager.id = link.id
    cross join own_scope own
    where manager.attivo is not false and manager.id <> (select id from me)
      and own.data->>'customer_code' is null
  ), agents as (
    select value::uuid as id from own_scope, jsonb_array_elements_text(data->'agent_ids')
    union
    select a.id from public.mexal_agenti a
    where a.attivo_mexal is not false and exists (
      select 1 from inherited_scopes s where s.data->>'customer_code' is null
        and (s.data->>'commercial_mode' = 'tutti' or s.data->'agent_ids' ? a.id::text)
    )
  )
  select data || jsonb_build_object('agent_ids',
    coalesce((select jsonb_agg(id order by id) from agents), '[]'::jsonb)) from own_scope;
$$;

-- The parameterized evaluator must not be callable by clients for other users.
revoke all on function public.workspace_own_data_scope() from public, anon, authenticated, service_role;
revoke all on function public.workspace_data_scope_for_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function public.workspace_data_scope() from public, anon;
grant execute on function public.workspace_data_scope() to authenticated, service_role;
update public.workspace_access_revision set revision = revision + 1 where id;
notify pgrst, 'reload schema';
commit;
