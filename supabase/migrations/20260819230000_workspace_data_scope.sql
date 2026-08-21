begin;

create or replace function public.workspace_data_scope()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      u.id,
      u.reparto_id,
      u.mexal_agente_id,
      coalesce(r.amministratore_workspace, false) as is_admin,
      coalesce(r.ambito_dati, 'propri') as data_scope
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
    limit 1
  ), my_departments as (
    select ur.reparto_id
    from me
    join public.utenti_reparti ur on ur.utente_id = me.id
    where ur.reparto_id is not null
    union
    select reparto_id from me where reparto_id is not null
  ), effective_scope as (
    select
      case when is_admin or data_scope = 'tutti' then 'tutti' else data_scope end as value,
      id
    from me
  ), visible_departments as (
    select r.id
    from public.reparti r, effective_scope scope
    where r.attivo is not false and scope.value = 'tutti'
    union
    select reparto_id from my_departments, effective_scope scope
    where scope.value = 'team'
  ), visible_agents as (
    select a.id
    from public.mexal_agenti a, effective_scope scope
    where a.attivo_mexal is not false and scope.value = 'tutti'
    union
    select me.mexal_agente_id from me where me.mexal_agente_id is not null
    union
    select a.id
    from public.mexal_agenti a
    join me on a.responsabile_utente_id = me.id
    join effective_scope scope on scope.value in ('team', 'tutti')
    where a.attivo_mexal is not false
    union
    select iu.mexal_agente_id
    from public.integrazioni_utenti iu
    join me on iu.utente_id = me.id
    where iu.enabled is true and iu.mexal_agente_id is not null
  ), visible_users as (
    select u.id
    from public.utenti u, effective_scope scope
    where u.attivo is not false and scope.value = 'tutti'
    union
    select id from me
    union
    select distinct u.id
    from public.utenti u
    join effective_scope scope on scope.value = 'team'
    where u.attivo is not false
      and (
        u.reparto_id in (select reparto_id from my_departments)
        or exists (
          select 1 from public.utenti_reparti ur
          where ur.utente_id = u.id
            and ur.reparto_id in (select reparto_id from my_departments)
        )
      )
    union
    select a.workspace_utente_id
    from public.mexal_agenti a
    where a.id in (select id from visible_agents)
      and a.workspace_utente_id is not null
  )
  select jsonb_build_object(
    'mode', coalesce((select value from effective_scope), 'propri'),
    'user_ids', coalesce((select jsonb_agg(distinct id) from visible_users where id is not null), '[]'::jsonb),
    'department_ids', coalesce((select jsonb_agg(distinct id) from visible_departments where id is not null), '[]'::jsonb),
    'agent_ids', coalesce((select jsonb_agg(distinct id) from visible_agents where id is not null), '[]'::jsonb)
  );
$$;

revoke all on function public.workspace_data_scope() from public, anon;
grant execute on function public.workspace_data_scope() to authenticated, service_role;

commit;
