begin;

-- Ricalcola soltanto enabled/access_level/external_role dai reparti e dai ruoli.
-- sync_workspace_user_integrations non modifica i collegamenti esistenti
-- mexal_agente_id, external_user_id, external_beauty_id o external_agent_id.
do $$
declare
  workspace_user record;
begin
  for workspace_user in select id from public.utenti loop
    perform public.sync_workspace_user_integrations(workspace_user.id);
  end loop;
end $$;

commit;
