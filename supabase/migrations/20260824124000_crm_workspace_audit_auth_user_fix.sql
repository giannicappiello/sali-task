begin;

create or replace function public.crm_apply_ai_decision(target_brief_id uuid,target_decision_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor_id uuid;
  brief_row public.crm_briefs%rowtype;
  decision_row public.crm_ai_decisions%rowtype;
  plan jsonb;
  project_id uuid;
  phase_id uuid;
  reminder_id uuid;
  phase jsonb;
  task jsonb;
  phase_deadline date;
  task_deadline date;
  department_id uuid;
  phase_ids uuid[] := '{}'::uuid[];
  reminder_ids uuid[] := '{}'::uuid[];
  phase_order integer := 0;
  phase_title text;
begin
  select u.id into actor_id from public.utenti u
  where u.auth_user_id=auth.uid() and u.attivo is not false limit 1;
  if actor_id is null then raise exception 'Profilo Workspace non valido.' using errcode='42501'; end if;

  select * into decision_row from public.crm_ai_decisions
  where id=target_decision_id and brief_id=target_brief_id for update;
  if not found then raise exception 'Decisione AI non trovata.' using errcode='P0002'; end if;
  select * into brief_row from public.crm_briefs where id=target_brief_id;
  if not found then raise exception 'Brief non trovato.' using errcode='P0002'; end if;

  if not public.crm_has_module_level('crm_ai','scrittura')
    or not public.crm_has_module_level(public.crm_module_for_type(brief_row.crm_tipo),'scrittura')
    or not public.crm_row_visible(brief_row.responsabile_id,brief_row.reparto_id,public.crm_module_for_type(brief_row.crm_tipo)) then
    raise exception 'Decisione CRM non autorizzata.' using errcode='42501';
  end if;
  if not public.crm_has_module_level('attivita','scrittura') then
    raise exception 'Per creare il progetto serve il livello scrittura nel modulo Attivita.' using errcode='42501';
  end if;

  if decision_row.stato='applicata' and decision_row.progetto_id is not null then
    return jsonb_build_object(
      'projectId',decision_row.progetto_id,
      'phaseIds',coalesce((select jsonb_agg(workspace_entity_id order by creato_il) from public.crm_workspace_links where crm_entity_type='brief' and crm_entity_id=target_brief_id and workspace_entity_type='fase_progetto'),'[]'::jsonb),
      'reminderIds',coalesce((select jsonb_agg(workspace_entity_id order by creato_il) from public.crm_workspace_links where crm_entity_type='brief' and crm_entity_id=target_brief_id and workspace_entity_type='reminder'),'[]'::jsonb),
      'alreadyApplied',true,'message','La decisione era gia stata applicata; nessun duplicato creato.'
    );
  end if;
  if decision_row.stato<>'proposta' then raise exception 'La decisione e gia stata gestita.' using errcode='P0001'; end if;

  plan := decision_row.piano;
  if coalesce((plan->>'readyForApproval')::boolean,false) is not true then
    raise exception 'Il piano contiene ancora informazioni mancanti.' using errcode='P0001';
  end if;
  if jsonb_typeof(plan->'phases')<>'array' or jsonb_array_length(plan->'phases')=0 then
    raise exception 'Il piano approvato deve contenere almeno una fase.' using errcode='P0001';
  end if;

  department_id := brief_row.reparto_id;
  insert into public.v4_progetti(titolo,descrizione,deadline,creato_da,modificato_da)
  values (
    left(coalesce(nullif(btrim(plan->'project'->>'title'),''),decision_row.titolo),240),
    concat_ws(E'\n',nullif(plan->'project'->>'description',''),(
      select string_agg('• '||value,E'\n') from jsonb_array_elements_text(coalesce(plan->'project'->'objectives','[]'::jsonb))
    )),
    case when coalesce(plan->'project'->>'deadline','') ~ '^\d{4}-\d{2}-\d{2}$' then (plan->'project'->>'deadline')::date else null end,
    actor_id,actor_id
  ) returning id into project_id;
  if department_id is not null then
    insert into public.v4_progetto_reparti(progetto_id,reparto_id) values(project_id,department_id);
  end if;

  for phase in select value from jsonb_array_elements(plan->'phases') loop
    phase_order := phase_order+1;
    phase_deadline := case when coalesce(phase->>'deadline','') ~ '^\d{4}-\d{2}-\d{2}$' then (phase->>'deadline')::date else null end;
    phase_title := left(coalesce(nullif(btrim(phase->>'title'),''),'Fase operativa'),240);
    insert into public.v4_fasi_progetto(progetto_id,titolo,descrizione,reparto_id,stato,ordine,deadline,creato_da,modificato_da)
    values(project_id,phase_title,nullif(phase->>'description',''),department_id,'da_evadere',phase_order,phase_deadline,actor_id,actor_id)
    returning id into phase_id;
    phase_ids := array_append(phase_ids,phase_id);
    if department_id is not null then insert into public.v4_fase_reparti(fase_id,reparto_id) values(phase_id,department_id); end if;
    if phase_deadline is not null then
      insert into public.agenda_reminder(utente_id,titolo,descrizione,deadline,progetto_id,stato)
      values(actor_id,phase_title,'Generato dal Brief AI: '||brief_row.titolo,phase_deadline,project_id,'Aperto')
      returning id into reminder_id;
      reminder_ids := array_append(reminder_ids,reminder_id);
    end if;

    for task in select value from jsonb_array_elements(coalesce(phase->'tasks','[]'::jsonb)) loop
      phase_order := phase_order+1;
      task_deadline := case when coalesce(task->>'deadline','') ~ '^\d{4}-\d{2}-\d{2}$' then (task->>'deadline')::date else phase_deadline end;
      phase_title := left(coalesce(nullif(btrim(phase->>'title'),''),'Fase')||' · '||coalesce(nullif(btrim(task->>'title'),''),'Attivita'),240);
      insert into public.v4_fasi_progetto(progetto_id,titolo,descrizione,reparto_id,stato,ordine,deadline,creato_da,modificato_da)
      values(
        project_id,phase_title,
        concat_ws(E'\n',nullif(task->>'description',''),(
          select string_agg('☐ '||value,E'\n') from jsonb_array_elements_text(coalesce(task->'checklist','[]'::jsonb))
        )),
        department_id,'da_evadere',phase_order,task_deadline,actor_id,actor_id
      ) returning id into phase_id;
      phase_ids := array_append(phase_ids,phase_id);
      if department_id is not null then insert into public.v4_fase_reparti(fase_id,reparto_id) values(phase_id,department_id); end if;
      if task_deadline is not null then
        insert into public.agenda_reminder(utente_id,titolo,descrizione,deadline,progetto_id,stato)
        values(actor_id,phase_title,'Generato dal Brief AI: '||brief_row.titolo,task_deadline,project_id,'Aperto')
        returning id into reminder_id;
        reminder_ids := array_append(reminder_ids,reminder_id);
      end if;
    end loop;
  end loop;

  insert into public.crm_workspace_links(crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,creato_da)
  values('brief',brief_row.id,'progetto',project_id,actor_id);
  insert into public.crm_workspace_links(crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,creato_da)
  select 'brief',brief_row.id,'fase_progetto',id,actor_id from unnest(phase_ids) id;
  insert into public.crm_workspace_links(crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,creato_da)
  select 'brief',brief_row.id,'reminder',id,actor_id from unnest(reminder_ids) id;

  update public.crm_ai_decisions set stato='applicata',approvata_da=actor_id,approvata_il=now(),
    progetto_id=project_id,errore=null,aggiornata_il=now() where id=decision_row.id;
  update public.crm_briefs set stato='trasformato_in_progetto',aggiornato_il=now() where id=brief_row.id;
  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values(actor_id,'brief',brief_row.id,'decisione_ai_approvata_e_progetto_creato',jsonb_build_object(
    'decision_id',decision_row.id,'project_id',project_id,'phases',cardinality(phase_ids),'reminders',cardinality(reminder_ids)
  ));
  insert into public.v4_audit_log(entity_type,entity_id,azione,dettagli,user_id)
  values('progetto',project_id,'creazione da Brief AI CRM',jsonb_build_object('brief_id',brief_row.id,'decision_id',decision_row.id),auth.uid());
  return jsonb_build_object(
    'projectId',project_id,'phaseIds',to_jsonb(phase_ids),'reminderIds',to_jsonb(reminder_ids),
    'alreadyApplied',false,
    'message',format('Creato il progetto con %s fasi operative e %s reminder.',cardinality(phase_ids),cardinality(reminder_ids))
  );
end $$;

commit;
