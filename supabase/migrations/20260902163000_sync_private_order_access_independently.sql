begin;

create or replace function public.sync_workspace_user_integrations(
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  role_config record;
  orders_role text;
  beauty_role text;
  beauty_enabled boolean;
begin
  select
    r.ambito_dati,
    r.accesso_come_beauty,
    r.amministratore_workspace,
    u.mexal_agente_id,
    coalesce(pr.livello_accesso, r.livello_accesso, 'lettura') as pr_access,
    coalesce(ph.livello_accesso, r.livello_accesso, 'lettura') as ph_access,
    coalesce(private_orders.livello_accesso, r.livello_accesso, 'lettura') as private_access,
    coalesce(beauty.livello_accesso, r.livello_accesso, 'lettura') as beauty_access
  into role_config
  from public.utenti u
  left join public.ruoli r on r.id = u.ruolo_id
  left join public.ruoli_moduli pr on pr.ruolo_id = r.id and pr.modulo = 'ordini_pr'
  left join public.ruoli_moduli ph on ph.ruolo_id = r.id and ph.modulo = 'ordini_ph'
  left join public.ruoli_moduli private_orders on private_orders.ruolo_id = r.id and private_orders.modulo = 'ordini_private'
  left join public.ruoli_moduli beauty on beauty.ruolo_id = r.id and beauty.modulo = 'beauty_days'
  where u.id = target_user_id;

  orders_role := case coalesce(role_config.ambito_dati, 'propri')
    when 'tutti' then 'backoffice'
    when 'team' then 'area_manager'
    else 'agente'
  end;

  beauty_role := case
    when coalesce(role_config.amministratore_workspace, false) then 'admin'
    when coalesce(role_config.ambito_dati, 'propri') = 'tutti' then 'admin'
    when coalesce(role_config.accesso_come_beauty, false) then 'beauty'
    else 'agent'
  end;

  beauty_enabled :=
    public.workspace_module_enabled_for_user(target_user_id, 'beauty_days')
    and (
      coalesce(role_config.accesso_come_beauty, false)
      or coalesce(role_config.ambito_dati, 'propri') in ('team', 'tutti')
      or role_config.mexal_agente_id is not null
    );

  insert into public.integrazioni_utenti (
    utente_id, modulo, enabled, ruolo_ordini, access_level
  )
  values
    (
      target_user_id,
      'gestione_ordini_pr',
      public.workspace_module_enabled_for_user(target_user_id, 'ordini_pr'),
      orders_role,
      case role_config.pr_access when 'amministrazione' then 'admin' when 'scrittura' then 'write' else 'read' end
    ),
    (
      target_user_id,
      'gestione_ordini_ph',
      public.workspace_module_enabled_for_user(target_user_id, 'ordini_ph'),
      orders_role,
      case role_config.ph_access when 'amministrazione' then 'admin' when 'scrittura' then 'write' else 'read' end
    ),
    (
      target_user_id,
      'gestione_ordini_private',
      public.workspace_module_enabled_for_user(target_user_id, 'ordini_private'),
      orders_role,
      case role_config.private_access when 'amministrazione' then 'admin' when 'scrittura' then 'write' else 'read' end
    )
  on conflict (utente_id, modulo) do update
  set enabled = excluded.enabled,
      ruolo_ordini = excluded.ruolo_ordini,
      access_level = excluded.access_level;

  insert into public.integrazioni_utenti (
    utente_id, modulo, enabled, access_level, external_role
  )
  values (
    target_user_id,
    'report_giornate',
    beauty_enabled,
    case role_config.beauty_access when 'amministrazione' then 'admin' when 'scrittura' then 'write' else 'read' end,
    beauty_role
  )
  on conflict (utente_id, modulo) do update
  set enabled = excluded.enabled,
      access_level = excluded.access_level,
      external_role = excluded.external_role;
end;
$$;

revoke all on function public.sync_workspace_user_integrations(uuid) from public, anon;
grant execute on function public.sync_workspace_user_integrations(uuid) to authenticated, service_role;

-- Riallinea gli utenti esistenti. Ogni flag viene calcolato esclusivamente dal
-- proprio modulo canonico, quindi OrdiniPrivate non abilita PR o PH.
do $$
declare
  workspace_user record;
begin
  for workspace_user in select id from public.utenti loop
    perform public.sync_workspace_user_integrations(workspace_user.id);
  end loop;
end $$;

commit;
