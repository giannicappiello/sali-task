begin;

-- Role configuration, not person-specific exceptions. Existing department-wide
-- directors retain their scope; supervisors and consultants get explicit scopes.
alter table public.ruoli add column if not exists ambito_team text not null default 'reparti'
  check (ambito_team in ('reparti','gerarchia','associazioni'));
update public.ruoli set ambito_team = 'associazioni'
where accesso_come_beauty is true and amministratore_workspace is not true;
update public.ruoli set ambito_team = 'gerarchia'
where lower(btrim(nome)) = 'responsabile reparto' and amministratore_workspace is not true;

create or replace function public.workspace_data_scope()
returns jsonb language sql stable security definer set search_path = public
as $$
  with recursive me as materialized (
    select u.id, coalesce(r.amministratore_workspace, false) as admin,
      coalesce(r.ambito_dati, 'propri') as data_scope,
      coalesce(r.ambito_team, 'associazioni') as team_scope, l.customer_code
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    left join public.workspace_customer_user_links l on l.user_id = u.id
    where u.auth_user_id = auth.uid() and u.attivo is not false limit 1
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
    'commercial_mode', case when public.workspace_commercial_read_all() then 'tutti'
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

create or replace function public.crm_row_visible(owner_id uuid, department_id uuid, target_module text)
returns boolean language sql stable security definer set search_path = public
as $$
  with scope as materialized (select public.workspace_data_scope() as data)
  select coalesce(public.crm_has_module_level(target_module, 'lettura') and (
    data->>'mode' = 'tutti' or owner_id = public.workspace_current_profile_id()
    or (data->>'mode' = 'team' and (
      data->'user_ids' ? owner_id::text
      or data->'department_ids' ? department_id::text
    ))
  ), false) from scope;
$$;

-- All commercial readers use the same set of agents, including explicit
-- consultant associations. Existing customer-only and exclusion rules remain.
create or replace function public.crm_visible_canonical_customer_codes()
returns setof text language sql stable security definer set search_path = public
as $$
  with scope as materialized (select public.workspace_data_scope() as data),
  visible_agents as materialized (
    select public.normalize_mexal_agent_code(code) as code from public.visible_mexal_agent_codes() code
  )
  select customer.codice_cliente::text from public.ordini_clienti_cache customer cross join scope
  where customer.sync_excluded is false and (
    auth.role() = 'service_role'
    or (data->>'customer_code' is not null
      and upper(btrim(customer.codice_cliente)) = upper(btrim(data->>'customer_code')))
    or (data->>'customer_code' is null and (
      data->>'commercial_mode' = 'tutti'
      or nullif(public.normalize_mexal_agent_code(customer.codice_agente_mexal), '')
        in (select code from visible_agents)
    ))
  );
$$;

-- Role, department, profile and integration changes already invalidate sessions.
-- Also cover direct changes of an agent's manager/owner without a profile update.
drop trigger if exists workspace_agent_scope_changed on public.mexal_agenti;
create trigger workspace_agent_scope_changed after update of responsabile_utente_id,workspace_utente_id,attivo_mexal,codice on public.mexal_agenti
for each row when (old.responsabile_utente_id is distinct from new.responsabile_utente_id
  or old.workspace_utente_id is distinct from new.workspace_utente_id
  or old.attivo_mexal is distinct from new.attivo_mexal or old.codice is distinct from new.codice)
execute function public.workspace_touch_access_revision();
drop trigger if exists workspace_agent_scope_members_changed on public.mexal_agenti;
create trigger workspace_agent_scope_members_changed after insert or delete on public.mexal_agenti
for each statement execute function public.workspace_touch_access_revision();

update public.workspace_access_revision set revision = revision + 1 where id;
notify pgrst, 'reload schema';
commit;
