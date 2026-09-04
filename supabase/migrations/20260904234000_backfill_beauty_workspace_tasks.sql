begin;

-- Recupera esclusivamente le visite Beauty rimaste senza task Workspace.
-- Se una task collegata esiste già, viene riutilizzata senza duplicarla.
do $$
declare
  visit_row record;
  task_id uuid;
begin
  for visit_row in
    select activity.id,activity.titolo,activity.descrizione,activity.data_attivita,
      activity.responsabile_id,activity.reparto_id,activity.customer_key,activity.creato_da,
      account.nome account_name
    from public.crm_activities activity
    left join public.crm_accounts account on account.id=activity.account_id
    where activity.tipo='visita_beauty' and activity.workspace_task_id is null
  loop
    select phase.id into task_id
    from public.v4_fasi_progetto phase
    where phase.crm_activity_id=visit_row.id
    order by phase.id
    limit 1;

    if task_id is null then
      insert into public.v4_fasi_progetto(
        progetto_id,titolo,descrizione,reparto_id,stato,priorita,assegnato_a,ordine,deadline,
        creato_da,modificato_da,source_type,source_id,crm_customer_key,crm_activity_id
      ) values (
        null,visit_row.titolo,
        coalesce(visit_row.descrizione,'Appuntamento Beauty per '||coalesce(visit_row.account_name,'contatto')),
        visit_row.reparto_id,'da_evadere','normale',coalesce(visit_row.responsabile_id,visit_row.creato_da),1,
        (visit_row.data_attivita at time zone 'Europe/Rome')::date,
        visit_row.creato_da,visit_row.creato_da,'crm_activity',visit_row.id,visit_row.customer_key,visit_row.id
      ) returning id into task_id;

      if visit_row.reparto_id is not null then
        insert into public.v4_fase_reparti(fase_id,reparto_id,completato)
        values(task_id,visit_row.reparto_id,false) on conflict do nothing;
      end if;
    end if;

    update public.crm_activities set workspace_task_id=task_id where id=visit_row.id;
    insert into public.crm_workspace_links(
      crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,metadati,creato_da
    ) values (
      'activity',visit_row.id,'task',task_id,
      jsonb_build_object('customer_key',visit_row.customer_key,'source_type','beauty_visit_backfill'),
      visit_row.creato_da
    ) on conflict do nothing;
    task_id := null;
  end loop;
end $$;

commit;
