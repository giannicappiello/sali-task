begin;

create or replace function public.crm_beauty_check_out(
  p_activity_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_address text,
  p_outcome text,
  p_next_type text default null,
  p_next_topic text default null,
  p_next_at timestamptz default null,
  p_exception_reason text default null
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_actor uuid := public.workspace_current_profile_id();
  v_activity public.crm_activities%rowtype;
  v_visit public.crm_visit_details%rowtype;
  v_distance numeric;
  v_geofence text;
  v_next_id uuid;
  v_task_id uuid;
  v_customer_key text;
begin
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Coordinate GPS non valide';
  end if;
  select * into v_activity from public.crm_activities where id=p_activity_id for update;
  if not found or v_activity.crm_tipo <> 'b2b' or v_activity.tipo <> 'visita_beauty' then
    raise exception 'Visita Beauty non trovata o non autorizzata';
  end if;
  if not public.crm_has_module_level('crm_b2b','scrittura')
     or not public.crm_row_visible(v_activity.responsabile_id,v_activity.reparto_id,'crm_b2b') then
    raise exception 'Check-out non autorizzato';
  end if;
  select * into v_visit from public.crm_visit_details where activity_id=p_activity_id for update;
  if not found or v_visit.check_in_at is null then raise exception 'Eseguire prima il check-in'; end if;
  if v_visit.check_out_at is not null then
    select id,workspace_task_id into v_next_id,v_task_id
    from public.crm_activities
    where source_type='beauty_visit' and source_id=p_activity_id
    order by creato_il limit 1;
    return jsonb_build_object(
      'activity_id',p_activity_id,'check_out_at',v_visit.check_out_at,
      'next_activity_id',v_next_id,'next_task_id',v_task_id,'idempotent',true);
  end if;
  if nullif(btrim(p_outcome),'') is null then raise exception 'Esito della visita obbligatorio'; end if;
  if nullif(btrim(p_next_type),'') is null or nullif(btrim(p_next_topic),'') is null or p_next_at is null then
    raise exception 'Tipo, argomento e data della prossima attività sono obbligatori';
  end if;

  v_distance := public.crm_distance_meters(p_latitude,p_longitude,v_visit.target_latitude,v_visit.target_longitude);
  v_geofence := public.crm_beauty_geofence_result(p_accuracy_meters,v_distance);
  if v_geofence <> 'compatibile' and nullif(btrim(p_exception_reason),'') is null then
    raise exception 'Motivazione obbligatoria: rilevazione GPS %', replace(v_geofence,'_',' ');
  end if;

  v_customer_key := coalesce(
    nullif(v_activity.customer_key,''),
    case when v_activity.account_id is not null then 'crm:'||v_activity.account_id::text else null end
  );

  insert into public.crm_activities(
    crm_tipo,account_id,opportunity_id,activity_class,tipo,titolo,descrizione,stato,data_attivita,
    responsabile_id,reparto_id,customer_key,source_type,source_id,creato_da
  ) values (
    'b2b',v_activity.account_id,v_activity.opportunity_id,'semplice',btrim(p_next_type),btrim(p_next_topic),
    'Generata dalla chiusura della visita Beauty','pianificata',p_next_at,
    v_activity.responsabile_id,v_activity.reparto_id,v_customer_key,'beauty_visit',v_activity.id,v_actor
  ) returning id into v_next_id;

  insert into public.v4_fasi_progetto(
    progetto_id,titolo,descrizione,reparto_id,stato,priorita,assegnato_a,ordine,deadline,
    creato_da,modificato_da,source_type,source_id,crm_customer_key,crm_activity_id
  ) values (
    null,btrim(p_next_topic),'Attività successiva alla visita Beauty',v_activity.reparto_id,
    'da_evadere','normale',coalesce(v_activity.responsabile_id,v_actor),1,
    (p_next_at at time zone 'Europe/Rome')::date,v_actor,v_actor,'crm_activity',v_next_id,
    v_customer_key,v_next_id
  ) returning id into v_task_id;

  if v_activity.reparto_id is not null then
    insert into public.v4_fase_reparti(fase_id,reparto_id,completato)
    values(v_task_id,v_activity.reparto_id,false) on conflict do nothing;
  end if;

  update public.crm_activities set workspace_task_id=v_task_id where id=v_next_id;
  insert into public.crm_workspace_links(
    crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,metadati,creato_da
  ) values (
    'activity',v_next_id,'task',v_task_id,
    jsonb_build_object('customer_key',v_customer_key,'source_type','beauty_visit_follow_up'),v_actor
  ) on conflict do nothing;

  update public.crm_visit_details set
    visit_status='completata',check_out_at=now(),check_out_latitude=p_latitude,
    check_out_longitude=p_longitude,check_out_accuracy_meters=p_accuracy_meters,
    check_out_address=nullif(btrim(p_address),''),check_out_distance_meters=v_distance,
    check_out_geofence=v_geofence,check_out_exception_reason=nullif(btrim(p_exception_reason),''),
    outcome=btrim(p_outcome),updated_at=now()
  where activity_id=p_activity_id;

  update public.crm_activities set stato='completata',completata_il=now(),esito=btrim(p_outcome),
    prossima_azione=btrim(p_next_topic),aggiornato_il=now() where id=p_activity_id;

  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values(v_actor,'beauty_visit',p_activity_id,'check_out',jsonb_build_object(
    'accuracy_meters',p_accuracy_meters,'distance_meters',v_distance,'geofence',v_geofence,
    'next_activity_id',v_next_id,'next_task_id',v_task_id,'outcome',p_outcome));

  return jsonb_build_object(
    'activity_id',p_activity_id,'check_out_at',now(),'distance_meters',v_distance,
    'geofence',v_geofence,'next_activity_id',v_next_id,'next_task_id',v_task_id,'idempotent',false);
end $$;

revoke all on function public.crm_beauty_check_out(uuid,double precision,double precision,numeric,text,text,text,text,timestamptz,text) from public,anon;
grant execute on function public.crm_beauty_check_out(uuid,double precision,double precision,numeric,text,text,text,text,timestamptz,text) to authenticated,service_role;

-- Collega soltanto i follow-up Beauty esistenti rimasti senza task; non modifica task o progetti esistenti.
do $$
declare
  activity_row record;
  task_id uuid;
begin
  for activity_row in
    select activity.id,activity.titolo,activity.descrizione,activity.data_attivita,
      activity.responsabile_id,activity.reparto_id,activity.customer_key,activity.creato_da
    from public.crm_activities activity
    where activity.source_type='beauty_visit' and activity.workspace_task_id is null
  loop
    select phase.id into task_id
    from public.v4_fasi_progetto phase
    where phase.crm_activity_id=activity_row.id
    order by phase.id limit 1;

    if task_id is null then
      insert into public.v4_fasi_progetto(
        progetto_id,titolo,descrizione,reparto_id,stato,priorita,assegnato_a,ordine,deadline,
        creato_da,modificato_da,source_type,source_id,crm_customer_key,crm_activity_id
      ) values (
        null,activity_row.titolo,coalesce(activity_row.descrizione,'Attività successiva alla visita Beauty'),
        activity_row.reparto_id,'da_evadere','normale',coalesce(activity_row.responsabile_id,activity_row.creato_da),1,
        (activity_row.data_attivita at time zone 'Europe/Rome')::date,activity_row.creato_da,activity_row.creato_da,
        'crm_activity',activity_row.id,activity_row.customer_key,activity_row.id
      ) returning id into task_id;

      if activity_row.reparto_id is not null then
        insert into public.v4_fase_reparti(fase_id,reparto_id,completato)
        values(task_id,activity_row.reparto_id,false) on conflict do nothing;
      end if;
    end if;

    update public.crm_activities set workspace_task_id=task_id where id=activity_row.id;
    insert into public.crm_workspace_links(
      crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,metadati,creato_da
    ) values (
      'activity',activity_row.id,'task',task_id,
      jsonb_build_object('customer_key',activity_row.customer_key,'source_type','beauty_visit_follow_up_backfill'),
      activity_row.creato_da
    ) on conflict do nothing;
    task_id := null;
  end loop;
end $$;

comment on function public.crm_beauty_check_out(uuid,double precision,double precision,numeric,text,text,text,text,timestamptz,text)
is 'Completa il check-out Beauty e crea atomicamente attività CRM successiva e task Workspace collegata.';

commit;
