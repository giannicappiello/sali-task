begin;

-- Existing catalogs remain available in their current flows until an administrator
-- narrows their CRM competencies. Department associations are never rewritten.
alter table public.tipi_progetto add column competenze_crm text[] not null default array['brand_direct','conto_terzi','b2b','online'];
alter table public.checklist_template add column competenze_crm text[] not null default array['brand_direct','conto_terzi','b2b','online'];
alter table public.tipi_progetto alter column competenze_crm set default '{}';
alter table public.checklist_template alter column competenze_crm set default '{}';
alter table public.tipi_progetto add constraint project_crm_competencies_valid check (competenze_crm <@ array['brand_direct','conto_terzi','b2b','online']::text[] and array_position(competenze_crm,null) is null);
alter table public.checklist_template add constraint checklist_crm_competencies_valid check (competenze_crm <@ array['brand_direct','conto_terzi','b2b','online']::text[] and array_position(competenze_crm,null) is null);
alter table public.v4_progetti add column crm_tipo text check (crm_tipo in ('brand_direct','conto_terzi','b2b','online'));
alter table public.v4_fasi_progetto add column crm_tipo text check (crm_tipo in ('brand_direct','conto_terzi','b2b','online'));
alter table public.v4_fasi_progetto add column template_id uuid references public.checklist_template(id) on delete set null;
alter table public.v4_fasi_progetto add column durata_giorni integer check (durata_giorni >= 1);
alter table public.v4_fasi_progetto add column obbligatoria boolean;

update public.v4_progetti p set crm_tipo=a.tipo from public.crm_opportunities o join public.crm_accounts a on a.id=o.account_id where p.crm_opportunity_id=o.id;
update public.v4_progetti p set crm_tipo=a.tipo from public.crm_accounts a where p.crm_tipo is null and p.crm_customer_key='crm:'||a.id::text;
update public.v4_progetti p set crm_tipo=c.area_crm from public.crm_classified_customers c where p.crm_tipo is null and p.crm_customer_key='mexal:'||c.codice_cliente and c.area_crm in ('brand_direct','conto_terzi','b2b','online');
update public.v4_fasi_progetto f set crm_tipo=p.crm_tipo from public.v4_progetti p where p.id=f.progetto_id;
update public.v4_fasi_progetto f set crm_tipo=a.crm_tipo from public.crm_activities a where f.crm_tipo is null and f.crm_activity_id=a.id;

create or replace function public.workspace_validate_new_crm_catalog_item()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if tg_table_name='v4_fasi_progetto' then
    if new.progetto_id is not null then
      select coalesce(p.crm_tipo,new.crm_tipo) into new.crm_tipo from public.v4_progetti p where p.id=new.progetto_id;
    end if;
  end if;
  if new.crm_tipo is null then return new; end if;
  if tg_table_name='v4_progetti' then
    if new.tipo_progetto_id is not null and not exists(select 1 from public.tipi_progetto t where t.id=new.tipo_progetto_id and t.attivo and new.crm_tipo=any(t.competenze_crm)) then raise exception 'Tipo progetto non disponibile in questa sezione CRM'; end if;
  else
    if new.template_id is not null and not exists(select 1 from public.checklist_template t where t.id=new.template_id and t.attivo and new.crm_tipo=any(t.competenze_crm)) then raise exception 'Voce checklist non disponibile in questa sezione CRM'; end if;
  end if;
  return new;
end $$;
create trigger workspace_validate_project_crm before insert on public.v4_progetti for each row execute function public.workspace_validate_new_crm_catalog_item();
create trigger workspace_validate_phase_crm before insert on public.v4_fasi_progetto for each row execute function public.workspace_validate_new_crm_catalog_item();

create or replace function public.workspace_save_project_rule(p_rule_id uuid, p_rule jsonb, p_competenze_crm text[])
returns uuid language plpgsql security invoker set search_path=public as $$
declare v_rule public.tipo_progetto_fasi%rowtype; v_id uuid;
begin
  if not (public.workspace_user_is_admin() or public.has_permission('settings.manage')) then raise exception 'Permessi impostazioni insufficienti'; end if;
  v_rule := jsonb_populate_record(null::public.tipo_progetto_fasi,p_rule);
  if not exists(select 1 from public.tipi_progetto where id=v_rule.tipo_progetto_id) then raise exception 'Tipo progetto non valido'; end if;
  if not exists(select 1 from public.checklist_template where id=v_rule.template_id and attivo) then raise exception 'Fase non disponibile'; end if;
  if exists(select 1 from public.tipo_progetto_fasi where tipo_progetto_id=v_rule.tipo_progetto_id and template_id=v_rule.template_id and id is distinct from p_rule_id) then raise exception 'Fase già associata'; end if;
  if v_rule.dipende_da_id is not null and not exists(select 1 from public.tipo_progetto_fasi where id=v_rule.dipende_da_id and id is distinct from p_rule_id and tipo_progetto_id=v_rule.tipo_progetto_id and ordine<v_rule.ordine) then raise exception 'La dipendenza deve essere una fase precedente dello stesso progetto'; end if;
  if exists(select 1 from public.tipo_progetto_fasi where dipende_da_id=p_rule_id and ordine<=v_rule.ordine) then raise exception 'La fase deve precedere quelle che dipendono da essa'; end if;
  if v_rule.giorni_anticipo<0 or v_rule.ordine<1 or v_rule.durata_giorni<1 then raise exception 'Valori numerici non validi'; end if;
  if p_rule_id is null then
    insert into public.tipo_progetto_fasi(tipo_progetto_id,template_id,giorni_anticipo,ordine,obbligatoria,responsabile_id,dipende_da_id,durata_giorni,priorita)
    values(v_rule.tipo_progetto_id,v_rule.template_id,v_rule.giorni_anticipo,v_rule.ordine,v_rule.obbligatoria,v_rule.responsabile_id,v_rule.dipende_da_id,v_rule.durata_giorni,v_rule.priorita) returning id into v_id;
  else
    update public.tipo_progetto_fasi set template_id=v_rule.template_id,giorni_anticipo=v_rule.giorni_anticipo,ordine=v_rule.ordine,obbligatoria=v_rule.obbligatoria,responsabile_id=v_rule.responsabile_id,dipende_da_id=v_rule.dipende_da_id,durata_giorni=v_rule.durata_giorni,priorita=v_rule.priorita
    where id=p_rule_id and tipo_progetto_id=v_rule.tipo_progetto_id returning id into v_id;
    if not found then raise exception 'Fase non trovata'; end if;
  end if;
  update public.checklist_template set competenze_crm=p_competenze_crm where id=v_rule.template_id;
  return v_id;
end;
$$;
revoke all on function public.workspace_save_project_rule(uuid,jsonb,text[]) from public,anon;
grant execute on function public.workspace_save_project_rule(uuid,jsonb,text[]) to authenticated;

-- Read scope includes every phase of a project in which the person or one of
-- their departments participates. SECURITY DEFINER avoids recursive RLS joins.
create or replace function public.workspace_direct_phase_ids()
returns uuid[] language sql stable security definer set search_path=public as $$
  with me as materialized(select public.workspace_current_profile_id() id, public.workspace_data_scope() scope),
  departments as materialized(
    select ur.reparto_id id from public.utenti_reparti ur join public.reparti d on d.id=ur.reparto_id and d.attivo is not false, me where ur.utente_id=me.id
    union select value::uuid from me,jsonb_array_elements_text(me.scope->'department_ids')
  )
  select coalesce(array_agg(f.id),'{}'::uuid[]) from public.v4_fasi_progetto f cross join me
  where me.id is not null and (me.scope->>'mode'='tutti' or f.creato_da=me.id or f.assegnato_a=me.id
    or (me.scope->>'mode'<>'cliente' and (f.reparto_id in (select id from departments)
      or exists(select 1 from public.v4_fase_reparti fr where fr.fase_id=f.id and fr.reparto_id in (select id from departments)))))
$$;
create or replace function public.workspace_visible_project_ids()
returns uuid[] language sql stable security definer set search_path=public as $$
  with me as materialized(select public.workspace_current_profile_id() id,public.workspace_data_scope() scope),
  direct as materialized(select unnest(public.workspace_direct_phase_ids()) id),
  departments as materialized(
    select ur.reparto_id id from public.utenti_reparti ur join public.reparti d on d.id=ur.reparto_id and d.attivo is not false,me where ur.utente_id=me.id
    union select value::uuid from me,jsonb_array_elements_text(me.scope->'department_ids')
  )
  select coalesce(array_agg(p.id),'{}'::uuid[]) from public.v4_progetti p cross join me
  where me.id is not null and (me.scope->>'mode'='tutti' or p.creato_da=me.id
    or exists(select 1 from public.v4_fasi_progetto f where f.progetto_id=p.id and f.id in(select id from direct))
    or (me.scope->>'mode'<>'cliente' and exists(select 1 from public.v4_progetto_reparti pr where pr.progetto_id=p.id and pr.reparto_id in(select id from departments))))
$$;
create or replace function public.workspace_visible_phase_ids()
returns uuid[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(f.id),'{}'::uuid[]) from public.v4_fasi_progetto f
  where f.id=any((select public.workspace_direct_phase_ids())::uuid[])
    or f.progetto_id=any((select public.workspace_visible_project_ids())::uuid[])
$$;
revoke all on function public.workspace_direct_phase_ids(),public.workspace_visible_project_ids(),public.workspace_visible_phase_ids() from public,anon;
grant execute on function public.workspace_direct_phase_ids(),public.workspace_visible_project_ids(),public.workspace_visible_phase_ids() to authenticated;

create policy "project participant read scope" on public.v4_progetti as restrictive for select to authenticated using(creato_da=(select public.workspace_current_profile_id()) or id=any((select public.workspace_visible_project_ids())::uuid[]));
create policy "whole project phase read scope" on public.v4_fasi_progetto as restrictive for select to authenticated using(creato_da=(select public.workspace_current_profile_id()) or assegnato_a=(select public.workspace_current_profile_id()) or id=any((select public.workspace_visible_phase_ids())::uuid[]));
create policy "project departments read scope" on public.v4_progetto_reparti as restrictive for select to authenticated using(progetto_id=any((select public.workspace_visible_project_ids())::uuid[]));
create policy "project products read scope" on public.v4_progetto_prodotti as restrictive for select to authenticated using(progetto_id=any((select public.workspace_visible_project_ids())::uuid[]));
create policy "phase departments read scope" on public.v4_fase_reparti as restrictive for select to authenticated using(fase_id=any((select public.workspace_visible_phase_ids())::uuid[]));
create policy "phase products read scope" on public.v4_fase_prodotti as restrictive for select to authenticated using(fase_id=any((select public.workspace_visible_phase_ids())::uuid[]));

-- A read grant on sibling phases does not grant write access to them.
create policy "phase participant update scope" on public.v4_fasi_progetto as restrictive for update to authenticated using(id=any((select public.workspace_direct_phase_ids())::uuid[]));
create policy "phase participant delete scope" on public.v4_fasi_progetto as restrictive for delete to authenticated using(id=any((select public.workspace_direct_phase_ids())::uuid[]));
create policy "phase department update scope" on public.v4_fase_reparti as restrictive for update to authenticated using(fase_id=any((select public.workspace_direct_phase_ids())::uuid[]));
create policy "phase department delete scope" on public.v4_fase_reparti as restrictive for delete to authenticated using(fase_id=any((select public.workspace_direct_phase_ids())::uuid[]));
create policy "phase department insert scope" on public.v4_fase_reparti as restrictive for insert to authenticated with check(fase_id=any((select public.workspace_direct_phase_ids())::uuid[]));
create policy "phase products insert scope" on public.v4_fase_prodotti as restrictive for insert to authenticated with check(fase_id=any((select public.workspace_direct_phase_ids())::uuid[]));
create policy "phase products update scope" on public.v4_fase_prodotti as restrictive for update to authenticated using(fase_id=any((select public.workspace_direct_phase_ids())::uuid[]));
create policy "phase products delete scope" on public.v4_fase_prodotti as restrictive for delete to authenticated using(fase_id=any((select public.workspace_direct_phase_ids())::uuid[]));

create or replace function public.workspace_activity_catalog(p_crm_tipo text)
returns table(id uuid,nome text,classe text,tipo_progetto_id uuid,codice text,priorita_default text)
language sql stable security invoker set search_path=public as $$
  select t.id,t.titolo,'semplice',null::uuid,'checklist:'||t.id::text,'normale' from public.checklist_template t where t.attivo and p_crm_tipo=any(t.competenze_crm)
  union all
  select p.id,p.nome,'strutturata',p.id,'progetto:'||p.id::text,'normale' from public.tipi_progetto p where p.attivo and p_crm_tipo=any(p.competenze_crm)
  order by 2
$$;
revoke all on function public.workspace_activity_catalog(text) from public,anon;
grant execute on function public.workspace_activity_catalog(text) to authenticated;

-- Legacy catalog is unused in production. Abort rather than discard unexpected history.
do $$ begin
  if exists(select 1 from public.crm_activities where activity_type_id is not null) then raise exception 'Tipi CRM ancora utilizzati: migrare i riferimenti prima della rimozione'; end if;
end $$;
alter table public.crm_activities drop column activity_type_id;
alter table public.crm_activities add column catalog_template_id uuid references public.checklist_template(id) on delete set null;
alter table public.crm_activities add column catalog_project_type_id uuid references public.tipi_progetto(id) on delete set null;
drop function public.crm_preview_operational_activity(uuid,date,uuid,uuid);
drop function public.crm_create_operational_activity(uuid,uuid,uuid,text,text,date,uuid,uuid,text);
drop table public.crm_activity_types;

create or replace function public.workspace_preview_operational_activity(
  p_activity_type_id uuid,
  p_deadline date,
  p_department_id uuid default null,
  p_responsible_id uuid default null,
  p_crm_tipo text default null
) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare
  v_type record;
  v_tasks jsonb;
begin
  select * into v_type from public.workspace_activity_catalog(p_crm_tipo) where id=p_activity_type_id;
  if not found then raise exception 'Tipo attivita non trovato o non autorizzato'; end if;
  if p_deadline is null then raise exception 'Deadline obbligatoria'; end if;

  if v_type.classe='semplice' then
    v_tasks := jsonb_build_array(jsonb_build_object(
      'order',1,'title',v_type.nome,'department_id',p_department_id,
      'department_ids',(select coalesce(jsonb_agg(d.reparto_id),'[]'::jsonb) from (select reparto_id from public.checklist_template_reparti where template_id=v_type.id union select reparto_id from public.checklist_template where id=v_type.id and reparto_id is not null) d),
      'responsible_id',p_responsible_id,'deadline',p_deadline,
      'priority',v_type.priorita_default,'mandatory',true,'depends_on',null
    ));
  else
    if v_type.tipo_progetto_id is null then
      raise exception 'Il tipo attivita strutturata non ha una tipologia progetto configurata';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'rule_id',r.id,'order',r.ordine,'title',t.titolo,
      'department_id',coalesce(t.reparto_id,p_department_id),
      'department_ids',coalesce((select jsonb_agg(d.reparto_id order by d.reparto_id) from public.checklist_template_reparti d where d.template_id=t.id),'[]'::jsonb),
      'responsible_id',coalesce(r.responsabile_id,p_responsible_id),
      'deadline',p_deadline-coalesce(r.giorni_anticipo,0),
      'duration_days',r.durata_giorni,'priority',r.priorita,
      'mandatory',r.obbligatoria,'depends_on_rule_id',r.dipende_da_id
    ) order by r.ordine),'[]'::jsonb) into v_tasks
    from public.tipo_progetto_fasi r
    join public.checklist_template t on t.id=r.template_id
    where r.tipo_progetto_id=v_type.tipo_progetto_id and t.attivo is not false and p_crm_tipo=any(t.competenze_crm);
    if jsonb_array_length(v_tasks)=0 then raise exception 'Il workflow strutturato non contiene fasi/task'; end if;
  end if;

  return jsonb_build_object(
    'activity_type_id',v_type.id,'activity_type',v_type.nome,'class',v_type.classe,
    'project_count',case when v_type.classe='strutturata' then 1 else 0 end,
    'task_count',jsonb_array_length(v_tasks),
    'department_count',(select count(distinct department_id) from (
      select nullif(task->>'department_id','') department_id from jsonb_array_elements(v_tasks) task
      union all
      select nullif(department.value,'') from jsonb_array_elements(v_tasks) task
      cross join lateral jsonb_array_elements_text(coalesce(task->'department_ids','[]'::jsonb)) department
    ) departments where department_id is not null),
    'deadline',p_deadline,'tasks',v_tasks
  );
end;
$$;

create or replace function public.workspace_create_operational_activity(
  p_account_id uuid,
  p_opportunity_id uuid,
  p_activity_type_id uuid,
  p_title text,
  p_description text,
  p_deadline date,
  p_department_id uuid default null,
  p_responsible_id uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_actor uuid := public.workspace_current_profile_id();
  v_account public.crm_accounts%rowtype;
  v_opportunity public.crm_opportunities%rowtype;
  v_type record;
  v_activity_id uuid;
  v_project_id uuid;
  v_task_id uuid;
  v_previous_task_id uuid;
  v_blocker_id uuid;
  v_dependency_id uuid;
  v_visited uuid[];
  v_customer_key text;
  v_rule record;
  v_department_id uuid;
  v_department_member_id uuid;
  v_task_ids uuid[] := '{}';
  v_rule_ids uuid[] := '{}';
  v_existing public.crm_activities%rowtype;
begin
  if v_actor is null then raise exception 'Utente Workspace non riconosciuto'; end if;
  if nullif(btrim(p_title),'') is null or p_deadline is null then raise exception 'Titolo e deadline sono obbligatori'; end if;

  select * into v_account from public.crm_accounts where id=p_account_id;
  if not found then raise exception 'Cliente non trovato o non autorizzato'; end if;
  select * into v_opportunity from public.crm_opportunities where id=p_opportunity_id and account_id=p_account_id;
  if not found then raise exception 'Opportunita non trovata o non autorizzata'; end if;
  select * into v_type from public.workspace_activity_catalog(v_account.tipo) where id=p_activity_type_id;
  if not found then raise exception 'Tipo attivita non valido'; end if;
  if not public.crm_has_module_level(public.crm_module_for_type(v_account.tipo),'scrittura')
     or not public.crm_has_module_level('attivita','scrittura') then
    raise exception 'Permessi CRM/Attivita insufficienti';
  end if;
  if not public.crm_user_can_assign_department(p_department_id) then raise exception 'Reparto non autorizzato'; end if;
  if not public.crm_user_can_assign_department(coalesce(p_department_id,v_opportunity.reparto_id,v_account.reparto_id)) then raise exception 'Reparto effettivo non autorizzato'; end if;
  if not public.crm_user_can_assign_responsible(coalesce(p_responsible_id,v_opportunity.responsabile_id,v_account.responsabile_id,v_actor)) then raise exception 'Responsabile non autorizzato'; end if;

  if nullif(btrim(p_idempotency_key),'') is not null then
    select * into v_existing from public.crm_activities where idempotency_key=btrim(p_idempotency_key);
    if found then
      return jsonb_build_object('activity_id',v_existing.id,'project_id',v_existing.workspace_project_id,
        'task_id',v_existing.workspace_task_id,'idempotent',true);
    end if;
  end if;

  v_customer_key := case when nullif(v_account.codice_cliente_mexal,'') is not null
    then 'mexal:'||v_account.codice_cliente_mexal else 'crm:'||v_account.id::text end;

  insert into public.crm_activities(
    crm_tipo,account_id,opportunity_id,catalog_template_id,catalog_project_type_id,activity_class,tipo,titolo,descrizione,
    stato,data_attivita,responsabile_id,reparto_id,customer_key,source_type,source_id,idempotency_key,creato_da
  ) values (
    v_account.tipo,v_account.id,v_opportunity.id,case when v_type.classe='semplice' then v_type.id end,v_type.tipo_progetto_id,v_type.classe,'follow_up',btrim(p_title),
    nullif(btrim(p_description),''),'pianificata',p_deadline::timestamptz,
    coalesce(p_responsible_id,v_opportunity.responsabile_id,v_account.responsabile_id,v_actor),
    coalesce(p_department_id,v_opportunity.reparto_id,v_account.reparto_id),v_customer_key,
    'crm_opportunity',v_opportunity.id,nullif(btrim(p_idempotency_key),''),v_actor
  ) returning id into v_activity_id;

  if v_type.classe='semplice' then
    insert into public.v4_fasi_progetto(
      progetto_id,titolo,descrizione,reparto_id,stato,priorita,assegnato_a,ordine,deadline,
      creato_da,modificato_da,source_type,source_id,crm_customer_key,crm_opportunity_id,crm_activity_id
    ) values (
      null,btrim(p_title),nullif(btrim(p_description),''),coalesce(p_department_id,v_opportunity.reparto_id,v_account.reparto_id),
      'da_evadere',v_type.priorita_default,coalesce(p_responsible_id,v_opportunity.responsabile_id,v_account.responsabile_id,v_actor),
      1,p_deadline,v_actor,v_actor,'crm_activity',v_activity_id,v_customer_key,v_opportunity.id,v_activity_id
    ) returning id into v_task_id;
    if coalesce(p_department_id,v_opportunity.reparto_id,v_account.reparto_id) is not null then
      insert into public.v4_fase_reparti(fase_id,reparto_id,completato)
      values(v_task_id,coalesce(p_department_id,v_opportunity.reparto_id,v_account.reparto_id),false)
      on conflict do nothing;
    end if;
    insert into public.v4_fase_reparti(fase_id,reparto_id,completato)
    select v_task_id,d.reparto_id,false from public.checklist_template_reparti d where d.template_id=v_type.id
    union select v_task_id,t.reparto_id,false from public.checklist_template t where t.id=v_type.id and t.reparto_id is not null
    on conflict do nothing;
    update public.v4_fasi_progetto set template_id=v_type.id,crm_tipo=v_account.tipo where id=v_task_id;
    v_task_ids := array[v_task_id];
  else
    if v_type.tipo_progetto_id is null then raise exception 'Tipologia progetto non configurata'; end if;
    insert into public.v4_progetti(
      titolo,descrizione,deadline,tipo_progetto_id,creato_da,modificato_da,
      source_type,source_id,crm_customer_key,crm_opportunity_id,crm_activity_id
    ) values (
      btrim(p_title),nullif(btrim(p_description),''),p_deadline,v_type.tipo_progetto_id,v_actor,v_actor,
      'crm_activity',v_activity_id,v_customer_key,v_opportunity.id,v_activity_id
    ) returning id into v_project_id;

    update public.v4_progetti set crm_tipo=v_account.tipo where id=v_project_id;
    for v_rule in
      select r.*,t.titolo task_title,t.reparto_id template_department,
        array(select d.reparto_id from public.checklist_template_reparti d where d.template_id=t.id order by d.reparto_id) template_department_ids
      from public.tipo_progetto_fasi r join public.checklist_template t on t.id=r.template_id
      where r.tipo_progetto_id=v_type.tipo_progetto_id and t.attivo is not false and v_account.tipo=any(t.competenze_crm) order by r.ordine
    loop
      v_department_id := coalesce(v_rule.template_department_ids[1],v_rule.template_department,p_department_id,v_opportunity.reparto_id,v_account.reparto_id);
      if not public.crm_user_can_assign_department(v_department_id) then raise exception 'Workflow contiene un reparto non autorizzato'; end if;
      if not public.crm_user_can_assign_responsible(coalesce(v_rule.responsabile_id,p_responsible_id,v_actor)) then raise exception 'Workflow contiene un responsabile non autorizzato'; end if;
      v_blocker_id := v_previous_task_id;
      if v_rule.dipende_da_id is not null then
        v_dependency_id := v_rule.dipende_da_id; v_visited := '{}'; v_blocker_id := null;
        while v_dependency_id is not null and not v_dependency_id=any(v_visited) loop
          if array_position(v_rule_ids,v_dependency_id) is not null then
            v_blocker_id := v_task_ids[array_position(v_rule_ids,v_dependency_id)]; exit;
          end if;
          v_visited := array_append(v_visited,v_dependency_id);
          select dipende_da_id into v_dependency_id from public.tipo_progetto_fasi where id=v_dependency_id;
        end loop;
      end if;
      insert into public.v4_fasi_progetto(
        progetto_id,titolo,descrizione,reparto_id,stato,priorita,assegnato_a,ordine,deadline,bloccante_id,
        creato_da,modificato_da,source_type,source_id,crm_customer_key,crm_opportunity_id,crm_activity_id
      ) values (
        v_project_id,v_rule.task_title,null,v_department_id,case when v_blocker_id is null then 'da_evadere' else 'bloccata' end,v_rule.priorita,
        coalesce(v_rule.responsabile_id,p_responsible_id),v_rule.ordine,p_deadline-coalesce(v_rule.giorni_anticipo,0),
        v_blocker_id,
        v_actor,v_actor,'crm_activity',v_activity_id,v_customer_key,v_opportunity.id,v_activity_id
      ) returning id into v_task_id;
      update public.v4_fasi_progetto set template_id=v_rule.template_id,crm_tipo=v_account.tipo,durata_giorni=v_rule.durata_giorni,obbligatoria=v_rule.obbligatoria where id=v_task_id;
      if cardinality(v_rule.template_department_ids)>0 then
        foreach v_department_member_id in array v_rule.template_department_ids loop
          if not public.crm_user_can_assign_department(v_department_member_id) then raise exception 'Workflow contiene un reparto non autorizzato'; end if;
          insert into public.v4_fase_reparti(fase_id,reparto_id,completato) values(v_task_id,v_department_member_id,false) on conflict do nothing;
          insert into public.v4_progetto_reparti(progetto_id,reparto_id) values(v_project_id,v_department_member_id) on conflict do nothing;
        end loop;
      elsif v_department_id is not null then
        insert into public.v4_fase_reparti(fase_id,reparto_id,completato) values(v_task_id,v_department_id,false) on conflict do nothing;
        insert into public.v4_progetto_reparti(progetto_id,reparto_id) values(v_project_id,v_department_id) on conflict do nothing;
      end if;
      v_task_ids := array_append(v_task_ids,v_task_id);
      v_rule_ids := array_append(v_rule_ids,v_rule.id);
      v_previous_task_id := v_task_id;
    end loop;
    if cardinality(v_task_ids)=0 then raise exception 'Workflow senza task configurate'; end if;
  end if;

  update public.crm_activities set project_id=v_project_id,workspace_project_id=v_project_id,
    workspace_task_id=case when v_type.classe='semplice' then v_task_ids[1] else null end
  where id=v_activity_id;

  insert into public.crm_workspace_links(crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,metadati,creato_da)
  select 'activity',v_activity_id,case when v_project_id is not null then 'project' else 'task' end,
    coalesce(v_project_id,v_task_ids[1]),jsonb_build_object('customer_key',v_customer_key,'opportunity_id',v_opportunity.id,'source_type','crm_activity'),v_actor
  on conflict do nothing;
  insert into public.crm_workspace_links(crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,metadati,creato_da)
  select 'activity',v_activity_id,'task',x,jsonb_build_object('customer_key',v_customer_key,'opportunity_id',v_opportunity.id,'project_id',v_project_id),v_actor
  from unnest(v_task_ids) x on conflict do nothing;

  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values(v_actor,'activity',v_activity_id,'attivita_operativa_creata',jsonb_build_object(
    'class',v_type.classe,'customer_key',v_customer_key,'opportunity_id',v_opportunity.id,
    'project_id',v_project_id,'task_ids',v_task_ids,'deadline',p_deadline));

  return jsonb_build_object('activity_id',v_activity_id,'project_id',v_project_id,
    'task_id',case when v_type.classe='semplice' then v_task_ids[1] else null end,
    'task_ids',to_jsonb(v_task_ids),'idempotent',false);
end;
$$;
revoke all on function public.workspace_preview_operational_activity(uuid,date,uuid,uuid,text),public.workspace_create_operational_activity(uuid,uuid,uuid,text,text,date,uuid,uuid,text) from public,anon;
grant execute on function public.workspace_preview_operational_activity(uuid,date,uuid,uuid,text),public.workspace_create_operational_activity(uuid,uuid,uuid,text,text,date,uuid,uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
