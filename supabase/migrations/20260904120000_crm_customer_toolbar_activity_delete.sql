begin;

create or replace function public.crm_customer_cadence_details(
  p_crm_type text,
  p_to date
)
returns table (
  codice_cliente text,
  last_purchase date,
  average_gap_days numeric,
  expected_reorder_date date
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed_customers as (
    select classification.codice_cliente
    from public.crm_customer_classifications classification
    where classification.area_crm = p_crm_type
      and public.crm_customer_classification_visible(classification.codice_cliente, classification.area_crm)
  ), purchase_dates as (
    select distinct invoice.codice_cliente, invoice.data_documento purchase_date
    from public.mexal_fatture_vendita invoice
    join allowed_customers customer using (codice_cliente)
    where invoice.data_documento <= p_to
  ), intervals as (
    select purchase.codice_cliente, purchase.purchase_date,
      purchase.purchase_date - lag(purchase.purchase_date) over (
        partition by purchase.codice_cliente order by purchase.purchase_date
      ) gap_days
    from purchase_dates purchase
  ), cadence as (
    select customer.codice_cliente,
      max(intervals.purchase_date) last_purchase,
      round(avg(intervals.gap_days) filter (where intervals.gap_days > 0), 1) average_gap_days
    from allowed_customers customer
    left join intervals using (codice_cliente)
    group by customer.codice_cliente
  )
  select cadence.codice_cliente, cadence.last_purchase, cadence.average_gap_days,
    case when cadence.last_purchase is not null and cadence.average_gap_days is not null
      then cadence.last_purchase + ceil(cadence.average_gap_days)::integer
      else null
    end expected_reorder_date
  from cadence
  order by cadence.codice_cliente;
$$;

revoke all on function public.crm_customer_cadence_details(text,date) from public, anon;
grant execute on function public.crm_customer_cadence_details(text,date) to authenticated, service_role;

comment on function public.crm_customer_cadence_details(text,date) is
  'Frequenza e data di riordino della tabella clienti CRM, calcolate server-side sullo storico fatture visibile.';

create or replace function public.crm_delete_activity(p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.workspace_current_profile_id();
  v_activity public.crm_activities%rowtype;
  v_link_count integer := 0;
  v_detached_tasks integer := 0;
  v_detached_projects integer := 0;
begin
  if v_actor is null then
    raise exception 'Utente Workspace non riconosciuto';
  end if;

  select * into v_activity
  from public.crm_activities
  where id = p_activity_id
  for update;

  if not found then
    raise exception 'Attivita CRM non trovata';
  end if;

  if not public.crm_has_module_level(public.crm_module_for_type(v_activity.crm_tipo), 'scrittura')
     or not public.crm_row_visible(v_activity.responsabile_id, v_activity.reparto_id, public.crm_module_for_type(v_activity.crm_tipo)) then
    raise exception 'Permessi insufficienti per eliminare questa attivita CRM';
  end if;

  delete from public.crm_workspace_links
  where crm_entity_type = 'activity' and crm_entity_id = p_activity_id;
  get diagnostics v_link_count = row_count;

  update public.v4_fasi_progetto
  set crm_activity_id = null
  where crm_activity_id = p_activity_id;
  get diagnostics v_detached_tasks = row_count;

  update public.v4_progetti
  set crm_activity_id = null
  where crm_activity_id = p_activity_id;
  get diagnostics v_detached_projects = row_count;

  if v_activity.reminder_id is not null then
    delete from public.agenda_reminder where id = v_activity.reminder_id;
  end if;

  insert into public.crm_audit_log(utente_id, entita_tipo, entita_id, operazione, dettagli)
  values (
    v_actor,
    'activity',
    p_activity_id,
    'attivita_eliminata',
    jsonb_build_object(
      'crm_type', v_activity.crm_tipo,
      'title', v_activity.titolo,
      'activity_type', v_activity.tipo,
      'account_id', v_activity.account_id,
      'opportunity_id', v_activity.opportunity_id,
      'workspace_project_id', v_activity.workspace_project_id,
      'workspace_task_id', v_activity.workspace_task_id,
      'workspace_links_removed', v_link_count,
      'workspace_tasks_preserved', v_detached_tasks,
      'workspace_projects_preserved', v_detached_projects
    )
  );

  delete from public.crm_activities where id = p_activity_id;

  return jsonb_build_object(
    'activity_id', p_activity_id,
    'deleted', true,
    'workspace_tasks_preserved', v_detached_tasks,
    'workspace_projects_preserved', v_detached_projects
  );
end;
$$;

revoke all on function public.crm_delete_activity(uuid) from public, anon;
grant execute on function public.crm_delete_activity(uuid) to authenticated, service_role;

comment on function public.crm_delete_activity(uuid) is
  'Elimina atomicamente un attivita CRM autorizzata, rimuove reminder e link, preserva e scollega il lavoro Workspace gia creato e registra audit.';

commit;
