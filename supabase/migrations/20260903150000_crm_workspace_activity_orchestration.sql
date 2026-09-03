-- CRM PRIVATE -> Attivita/Progetti Workspace.
-- Layer additivo: riusa v4_progetti e v4_fasi_progetto, senza duplicare task o progetti.

begin;

create table if not exists public.crm_activity_types (
  id uuid primary key default gen_random_uuid(),
  crm_tipo text not null check (crm_tipo in ('conto_terzi','b2b','online')),
  codice text not null,
  nome text not null,
  descrizione text,
  classe text not null default 'semplice' check (classe in ('semplice','strutturata')),
  tipo_progetto_id uuid references public.tipi_progetto(id) on delete set null,
  priorita_default text not null default 'normale',
  attivo boolean not null default true,
  ordine integer not null default 0,
  creato_da uuid references public.utenti(id) on delete set null,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (crm_tipo,codice)
);

insert into public.crm_activity_types(crm_tipo,codice,nome,classe,ordine)
values
 ('conto_terzi','telefonata','Telefonata','semplice',10),
 ('conto_terzi','follow_up','Follow-up','semplice',20),
 ('conto_terzi','riunione','Riunione','semplice',30),
 ('conto_terzi','preventivo','Preventivo','semplice',40),
 ('conto_terzi','valutazione_fattibilita','Valutazione fattibilita','strutturata',50),
 ('conto_terzi','sviluppo_nuova_formula','Sviluppo nuova formula','strutturata',60),
 ('conto_terzi','campionatura','Campionatura','strutturata',70),
 ('conto_terzi','invio_campioni','Invio campioni','semplice',80),
 ('conto_terzi','revisione_packaging','Revisione packaging','strutturata',90),
 ('conto_terzi','preparazione_documentazione','Preparazione documentazione','strutturata',100)
on conflict (crm_tipo,codice) do update
set nome=excluded.nome, classe=excluded.classe, ordine=excluded.ordine;

alter table public.tipo_progetto_fasi
  add column if not exists responsabile_id uuid references public.utenti(id) on delete set null,
  add column if not exists dipende_da_id uuid references public.tipo_progetto_fasi(id) on delete set null,
  add column if not exists durata_giorni integer not null default 1 check (durata_giorni > 0),
  add column if not exists priorita text not null default 'normale';

alter table public.crm_activities
  add column if not exists activity_type_id uuid references public.crm_activity_types(id) on delete set null,
  add column if not exists activity_class text check (activity_class in ('semplice','strutturata')),
  add column if not exists workspace_project_id uuid references public.v4_progetti(id) on delete set null,
  add column if not exists workspace_task_id uuid references public.v4_fasi_progetto(id) on delete set null,
  add column if not exists customer_key text,
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists idempotency_key text;

create unique index if not exists crm_activities_idempotency_uidx
  on public.crm_activities(idempotency_key) where idempotency_key is not null;

alter table public.v4_progetti
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists crm_customer_key text,
  add column if not exists crm_opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  add column if not exists crm_activity_id uuid references public.crm_activities(id) on delete set null;

alter table public.v4_fasi_progetto
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists crm_customer_key text,
  add column if not exists crm_opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  add column if not exists crm_activity_id uuid references public.crm_activities(id) on delete set null;

create index if not exists v4_progetti_crm_source_idx on public.v4_progetti(crm_opportunity_id,crm_activity_id);
create index if not exists v4_fasi_crm_source_idx on public.v4_fasi_progetto(crm_opportunity_id,crm_activity_id,deadline);

drop trigger if exists trg_crm_activity_types_updated on public.crm_activity_types;
create trigger trg_crm_activity_types_updated before update on public.crm_activity_types
for each row execute function public.crm_set_updated_at();
drop trigger if exists trg_crm_activity_types_audit on public.crm_activity_types;
create trigger trg_crm_activity_types_audit after insert or update or delete on public.crm_activity_types
for each row execute function public.crm_audit_row_change();

alter table public.crm_activity_types enable row level security;
drop policy if exists "crm activity types read" on public.crm_activity_types;
create policy "crm activity types read" on public.crm_activity_types for select to authenticated
using (public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'lettura'));
drop policy if exists "crm activity types admin" on public.crm_activity_types;
create policy "crm activity types admin" on public.crm_activity_types for all to authenticated
using (public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'amministrazione'))
with check (public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'amministrazione'));
revoke all on public.crm_activity_types from public,anon;
grant select on public.crm_activity_types to authenticated;
grant insert,update,delete on public.crm_activity_types to authenticated;
grant all on public.crm_activity_types to service_role;

drop policy if exists "crm activity workspace links write" on public.crm_workspace_links;
create policy "crm activity workspace links write" on public.crm_workspace_links for all to authenticated
using (
  crm_entity_type='activity' and exists (
    select 1 from public.crm_activities a where a.id=crm_entity_id
      and public.crm_has_module_level(public.crm_module_for_type(a.crm_tipo),'scrittura')
      and public.crm_row_visible(a.responsabile_id,a.reparto_id,public.crm_module_for_type(a.crm_tipo))
  )
)
with check (
  crm_entity_type='activity' and workspace_entity_type in ('project','task') and exists (
    select 1 from public.crm_activities a where a.id=crm_entity_id
      and public.crm_has_module_level(public.crm_module_for_type(a.crm_tipo),'scrittura')
      and public.crm_row_visible(a.responsabile_id,a.reparto_id,public.crm_module_for_type(a.crm_tipo))
  )
);

create or replace function public.crm_user_can_assign_department(p_department_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select p_department_id is null or public.workspace_user_is_admin() or exists (
    select 1 from public.utenti u
    where u.id=public.workspace_current_profile_id() and u.reparto_id=p_department_id
    union all
    select 1 from public.utenti_reparti ur
    where ur.utente_id=public.workspace_current_profile_id() and ur.reparto_id=p_department_id
  )
$$;
revoke all on function public.crm_user_can_assign_department(uuid) from public,anon;
grant execute on function public.crm_user_can_assign_department(uuid) to authenticated,service_role;

create or replace function public.crm_user_can_assign_responsible(p_responsible_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select p_responsible_id is null or p_responsible_id=public.workspace_current_profile_id()
    or public.workspace_user_is_admin()
    or exists (
      select 1
      from public.utenti target
      where target.id=p_responsible_id and target.attivo is not false and (
        target.reparto_id in (
          select ur.reparto_id from public.utenti_reparti ur where ur.utente_id=public.workspace_current_profile_id()
          union
          select current_user_profile.reparto_id from public.utenti current_user_profile
          where current_user_profile.id=public.workspace_current_profile_id() and current_user_profile.reparto_id is not null
        )
      )
    )
$$;
revoke all on function public.crm_user_can_assign_responsible(uuid) from public,anon;
grant execute on function public.crm_user_can_assign_responsible(uuid) to authenticated,service_role;

create or replace function public.crm_preview_operational_activity(
  p_activity_type_id uuid,
  p_deadline date,
  p_department_id uuid default null,
  p_responsible_id uuid default null
) returns jsonb
language plpgsql stable security invoker set search_path=public as $$
declare
  v_type public.crm_activity_types%rowtype;
  v_tasks jsonb;
begin
  select * into v_type from public.crm_activity_types where id=p_activity_type_id and attivo;
  if not found then raise exception 'Tipo attivita non trovato o non autorizzato'; end if;
  if p_deadline is null then raise exception 'Deadline obbligatoria'; end if;

  if v_type.classe='semplice' then
    v_tasks := jsonb_build_array(jsonb_build_object(
      'order',1,'title',v_type.nome,'department_id',p_department_id,
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
    where r.tipo_progetto_id=v_type.tipo_progetto_id and t.attivo is not false;
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

create or replace function public.crm_create_operational_activity(
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
  v_type public.crm_activity_types%rowtype;
  v_activity_id uuid;
  v_project_id uuid;
  v_task_id uuid;
  v_previous_task_id uuid;
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
  select * into v_type from public.crm_activity_types where id=p_activity_type_id and crm_tipo=v_account.tipo and attivo;
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
    crm_tipo,account_id,opportunity_id,activity_type_id,activity_class,tipo,titolo,descrizione,
    stato,data_attivita,responsabile_id,reparto_id,customer_key,source_type,source_id,idempotency_key,creato_da
  ) values (
    v_account.tipo,v_account.id,v_opportunity.id,v_type.id,v_type.classe,v_type.codice,btrim(p_title),
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

    for v_rule in
      select r.*,t.titolo task_title,t.reparto_id template_department,
        array(select d.reparto_id from public.checklist_template_reparti d where d.template_id=t.id order by d.reparto_id) template_department_ids
      from public.tipo_progetto_fasi r join public.checklist_template t on t.id=r.template_id
      where r.tipo_progetto_id=v_type.tipo_progetto_id and t.attivo is not false order by r.ordine
    loop
      v_department_id := coalesce(v_rule.template_department_ids[1],v_rule.template_department,p_department_id,v_opportunity.reparto_id,v_account.reparto_id);
      if not public.crm_user_can_assign_department(v_department_id) then raise exception 'Workflow contiene un reparto non autorizzato'; end if;
      if not public.crm_user_can_assign_responsible(coalesce(v_rule.responsabile_id,p_responsible_id,v_actor)) then raise exception 'Workflow contiene un responsabile non autorizzato'; end if;
      insert into public.v4_fasi_progetto(
        progetto_id,titolo,descrizione,reparto_id,stato,priorita,assegnato_a,ordine,deadline,bloccante_id,
        creato_da,modificato_da,source_type,source_id,crm_customer_key,crm_opportunity_id,crm_activity_id
      ) values (
        v_project_id,v_rule.task_title,null,v_department_id,case when v_previous_task_id is null then 'da_evadere' else 'bloccata' end,v_rule.priorita,
        coalesce(v_rule.responsabile_id,p_responsible_id),v_rule.ordine,p_deadline-coalesce(v_rule.giorni_anticipo,0),
        case when v_rule.dipende_da_id is not null and array_position(v_rule_ids,v_rule.dipende_da_id) is not null
          then v_task_ids[array_position(v_rule_ids,v_rule.dipende_da_id)] else v_previous_task_id end,
        v_actor,v_actor,'crm_activity',v_activity_id,v_customer_key,v_opportunity.id,v_activity_id
      ) returning id into v_task_id;
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

create or replace function public.workspace_unblock_dependent_tasks()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if lower(coalesce(new.stato,'')) in ('evaso','evasa','completato','completata','chiuso','chiusa')
     or new.completato_at is not null then
    update public.v4_fasi_progetto set stato='da_evadere',updated_at=now(),modificato_da=coalesce(new.completato_da,new.modificato_da)
    where bloccante_id=new.id and lower(coalesce(stato,''))='bloccata';
  end if;
  if new.crm_activity_id is not null then
    if not exists (
      select 1 from public.v4_fasi_progetto task
      where task.crm_activity_id=new.crm_activity_id
        and lower(coalesce(task.stato,'')) not in ('evaso','evasa','completato','completata','chiuso','chiusa')
        and task.completato_at is null
    ) then
      update public.crm_activities set stato='completata',completata_il=coalesce(completata_il,now()),aggiornato_il=now()
      where id=new.crm_activity_id and stato is distinct from 'completata';
    else
      update public.crm_activities set stato='pianificata',completata_il=null,aggiornato_il=now()
      where id=new.crm_activity_id and stato='completata';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_workspace_unblock_dependent_tasks on public.v4_fasi_progetto;
create trigger trg_workspace_unblock_dependent_tasks after update of stato,completato_at on public.v4_fasi_progetto
for each row execute function public.workspace_unblock_dependent_tasks();

create or replace function public.crm_opportunity_operational_progress(p_opportunity_id uuid)
returns table(
  activity_id uuid,activity_title text,activity_class text,project_id uuid,project_title text,
  total_tasks bigint,completed_tasks bigint,in_progress_tasks bigint,blocked_tasks bigint,overdue_tasks bigint,
  progress numeric,deadline date,department_names text[],next_task_id uuid,next_task_title text
) language sql stable security invoker set search_path=public as $$
  with allowed as (
    select o.id from public.crm_opportunities o join public.crm_accounts a on a.id=o.account_id
    where o.id=p_opportunity_id and public.crm_row_visible(coalesce(o.responsabile_id,a.responsabile_id),coalesce(o.reparto_id,a.reparto_id),public.crm_module_for_type(a.tipo))
  ), activity as (
    select a.* from public.crm_activities a join allowed x on x.id=a.opportunity_id
    where a.activity_class in ('semplice','strutturata') and (a.workspace_project_id is not null or a.workspace_task_id is not null)
  ), task_rows as (
    select a.id activity_id,f.*,b.stato blocker_status,r.nome department_name
    from activity a join public.v4_fasi_progetto f
      on f.crm_activity_id=a.id or f.id=a.workspace_task_id
    left join public.v4_fasi_progetto b on b.id=f.bloccante_id
    left join public.reparti r on r.id=f.reparto_id
  ), aggregate as (
    select a.id activity_id,a.titolo activity_title,a.activity_class,a.workspace_project_id project_id,p.titolo project_title,
      count(t.id) total_tasks,
      count(t.id) filter(where lower(coalesce(t.stato,'')) in ('evaso','evasa','completato','completata','chiuso','chiusa') or t.completato_at is not null) completed_tasks,
      count(t.id) filter(where lower(coalesce(t.stato,'')) in ('in_lavorazione','in_verifica','in_valutazione')) in_progress_tasks,
      count(t.id) filter(where t.bloccante_id is not null and lower(coalesce(t.blocker_status,'')) not in ('evaso','evasa','completato','completata','chiuso','chiusa')) blocked_tasks,
      count(t.id) filter(where t.deadline<current_date and lower(coalesce(t.stato,'')) not in ('evaso','evasa','completato','completata','chiuso','chiusa')) overdue_tasks,
      coalesce(p.deadline,a.data_attivita::date) deadline,
      array_remove(array_agg(distinct t.department_name),null) department_names
    from activity a left join public.v4_progetti p on p.id=a.workspace_project_id
    left join task_rows t on t.activity_id=a.id
    group by a.id,a.titolo,a.activity_class,a.workspace_project_id,p.titolo,p.deadline,a.data_attivita
  )
  select
    g.activity_id,g.activity_title,g.activity_class,g.project_id,g.project_title,
    g.total_tasks,g.completed_tasks,g.in_progress_tasks,g.blocked_tasks,g.overdue_tasks,
    case when g.total_tasks=0 then 0 else round(g.completed_tasks*100.0/g.total_tasks,1) end progress,
    g.deadline,g.department_names,n.id next_task_id,n.titolo next_task_title
  from aggregate g left join lateral (
    select t.id,t.titolo from task_rows t where t.activity_id=g.activity_id
      and lower(coalesce(t.stato,'')) not in ('evaso','evasa','completato','completata','chiuso','chiusa')
      and not (t.bloccante_id is not null and lower(coalesce(t.blocker_status,'')) not in ('evaso','evasa','completato','completata','chiuso','chiusa'))
    order by t.deadline nulls last,t.ordine limit 1
  ) n on true order by g.deadline nulls last;
$$;

revoke all on function public.crm_preview_operational_activity(uuid,date,uuid,uuid) from public,anon;
grant execute on function public.crm_preview_operational_activity(uuid,date,uuid,uuid) to authenticated,service_role;
revoke all on function public.crm_create_operational_activity(uuid,uuid,uuid,text,text,date,uuid,uuid,text) from public,anon;
grant execute on function public.crm_create_operational_activity(uuid,uuid,uuid,text,text,date,uuid,uuid,text) to authenticated,service_role;
revoke all on function public.crm_opportunity_operational_progress(uuid) from public,anon;
grant execute on function public.crm_opportunity_operational_progress(uuid) to authenticated,service_role;

comment on table public.crm_activity_types is 'Catalogo configurabile dei tipi attivita CRM; i workflow strutturati riusano tipi_progetto e tipo_progetto_fasi.';
comment on function public.crm_preview_operational_activity(uuid,date,uuid,uuid) is 'Preview senza scritture del task o progetto Workspace che sara creato.';
comment on function public.crm_create_operational_activity(uuid,uuid,uuid,text,text,date,uuid,uuid,text) is 'Creazione atomica e idempotente CRM -> task/progetto/fasi Workspace con audit.';

commit;
