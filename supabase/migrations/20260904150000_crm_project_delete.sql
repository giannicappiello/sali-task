begin;

update public.workspace_schermate
set nome = 'Progetti PRIVATE',
    descrizione = 'Elenco dei progetti commerciali per lo sviluppo prodotto e il percorso cliente.'
where codice = 'crm.conto_terzi.opportunita';

update public.workspace_moduli
set descrizione = 'Clienti, brief e progetti commerciali conto terzi.'
where codice = 'crm_conto_terzi';

create or replace function public.crm_delete_opportunity(p_opportunity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.workspace_current_profile_id();
  v_project public.crm_opportunities%rowtype;
  v_crm_type text;
  v_account_responsible uuid;
  v_account_department uuid;
  v_activity_count integer := 0;
  v_workspace_link_count integer := 0;
  v_activity_link_count integer := 0;
  v_detached_tasks integer := 0;
  v_detached_projects integer := 0;
begin
  if v_actor is null then
    raise exception 'Utente Workspace non riconosciuto';
  end if;

  select o.*
  into v_project
  from public.crm_opportunities o
  where o.id = p_opportunity_id
  for update;

  if not found then
    raise exception 'Progetto CRM non trovato';
  end if;

  select a.tipo, a.responsabile_id, a.reparto_id
  into v_crm_type, v_account_responsible, v_account_department
  from public.crm_accounts a
  where a.id = v_project.account_id;

  if not public.crm_has_module_level(public.crm_module_for_type(v_crm_type), 'scrittura')
     or not public.crm_row_visible(
       coalesce(v_project.responsabile_id, v_account_responsible),
       coalesce(v_project.reparto_id, v_account_department),
       public.crm_module_for_type(v_crm_type)
     ) then
    raise exception 'Permessi insufficienti per eliminare questo progetto CRM';
  end if;

  select count(*) into v_activity_count
  from public.crm_activities
  where opportunity_id = p_opportunity_id;

  delete from public.agenda_reminder
  where id in (
    select reminder_id
    from public.crm_activities
    where opportunity_id = p_opportunity_id and reminder_id is not null
  );

  delete from public.crm_workspace_links
  where crm_entity_type = 'opportunity' and crm_entity_id = p_opportunity_id;
  get diagnostics v_workspace_link_count = row_count;

  delete from public.crm_workspace_links
  where crm_entity_type = 'activity'
    and crm_entity_id in (
      select id from public.crm_activities where opportunity_id = p_opportunity_id
    );
  get diagnostics v_activity_link_count = row_count;
  v_workspace_link_count := v_workspace_link_count + v_activity_link_count;

  delete from public.crm_entity_tags
  where entity_type in ('opportunity', 'project') and entity_id = p_opportunity_id;

  update public.v4_fasi_progetto
  set crm_opportunity_id = null, crm_activity_id = null
  where crm_opportunity_id = p_opportunity_id
     or crm_activity_id in (
       select id from public.crm_activities where opportunity_id = p_opportunity_id
     );
  get diagnostics v_detached_tasks = row_count;

  update public.v4_progetti
  set crm_opportunity_id = null, crm_activity_id = null
  where crm_opportunity_id = p_opportunity_id
     or crm_activity_id in (
       select id from public.crm_activities where opportunity_id = p_opportunity_id
     );
  get diagnostics v_detached_projects = row_count;

  insert into public.crm_audit_log(utente_id, entita_tipo, entita_id, operazione, dettagli)
  values (
    v_actor,
    'project',
    p_opportunity_id,
    'progetto_eliminato',
    jsonb_build_object(
      'crm_type', v_crm_type,
      'title', v_project.titolo,
      'account_id', v_project.account_id,
      'activities_deleted', v_activity_count,
      'workspace_links_removed', v_workspace_link_count,
      'workspace_tasks_preserved', v_detached_tasks,
      'workspace_projects_preserved', v_detached_projects
    )
  );

  delete from public.crm_opportunities where id = p_opportunity_id;

  return jsonb_build_object(
    'project_id', p_opportunity_id,
    'deleted', true,
    'activities_deleted', v_activity_count,
    'workspace_tasks_preserved', v_detached_tasks,
    'workspace_projects_preserved', v_detached_projects
  );
end;
$$;

revoke all on function public.crm_delete_opportunity(uuid) from public, anon;
grant execute on function public.crm_delete_opportunity(uuid) to authenticated, service_role;

comment on function public.crm_delete_opportunity(uuid) is
  'Elimina atomicamente un progetto commerciale CRM autorizzato e le attivita collegate; preserva e scollega il lavoro Workspace e registra audit.';

commit;
