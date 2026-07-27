begin;

alter table public.ruoli
  add column if not exists accesso_come_beauty boolean not null default false;

-- Mantiene attivi i profili Beauty già configurati prima dell'introduzione
-- dell'autorizzazione esplicita sul ruolo Workspace.
update public.ruoli r
set accesso_come_beauty = true
where exists (
  select 1
  from public.utenti u
  join public.integrazioni_utenti i
    on i.utente_id = u.id
  where u.ruolo_id = r.id
    and i.modulo = 'report_giornate'
    and i.enabled is true
    and i.external_role = 'beauty'
);

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
    r.livello_accesso,
    r.accesso_come_beauty,
    u.mexal_agente_id
  into role_config
  from public.utenti u
  left join public.ruoli r on r.id = u.ruolo_id
  where u.id = target_user_id;

  orders_role := case coalesce(role_config.ambito_dati, 'propri')
    when 'tutti' then 'backoffice'
    when 'team' then 'area_manager'
    else 'agente'
  end;

  beauty_role := case
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
    utente_id, modulo, enabled, ruolo_ordini
  )
  values
    (
      target_user_id,
      'gestione_ordini_pr',
      public.workspace_module_enabled_for_user(target_user_id, 'ordini_pr'),
      orders_role
    ),
    (
      target_user_id,
      'gestione_ordini_ph',
      public.workspace_module_enabled_for_user(target_user_id, 'ordini_ph'),
      orders_role
    )
  on conflict (utente_id, modulo) do update
  set enabled = excluded.enabled,
      ruolo_ordini = excluded.ruolo_ordini;

  insert into public.integrazioni_utenti (
    utente_id,
    modulo,
    enabled,
    access_level,
    external_role
  )
  values (
    target_user_id,
    'report_giornate',
    beauty_enabled,
    case coalesce(role_config.livello_accesso, 'scrittura')
      when 'amministrazione' then 'admin'
      when 'scrittura' then 'write'
      else 'read'
    end,
    beauty_role
  )
  on conflict (utente_id, modulo) do update
  set enabled = excluded.enabled,
      access_level = excluded.access_level,
      external_role = excluded.external_role;
end;
$$;

drop trigger if exists ruoli_sync_integrations on public.ruoli;
create trigger ruoli_sync_integrations
after update of ambito_dati, livello_accesso, accesso_come_beauty
on public.ruoli
for each statement execute function public.sync_all_workspace_integrations();

do $$
declare
  user_row record;
begin
  for user_row in select id from public.utenti loop
    perform public.sync_workspace_user_integrations(user_row.id);
  end loop;
end;
$$;

commit;
