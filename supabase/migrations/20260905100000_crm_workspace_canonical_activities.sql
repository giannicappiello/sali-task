-- Canonical CRM <-> Workspace activity contract.
-- Additive and idempotent: existing CRM activities, projects and tasks are never deleted
-- or renumbered. Missing standalone Workspace tasks are created only when no operational
-- project/task is already linked to the CRM activity.

begin;

create or replace function public.crm_workspace_task_status(p_crm_status text)
returns text
language sql immutable parallel safe
set search_path=public as $$
  select case lower(coalesce(p_crm_status,''))
    when 'completata' then 'evaso'
    when 'completato' then 'evaso'
    when 'chiusa' then 'evaso'
    when 'chiuso' then 'evaso'
    when 'in_lavorazione' then 'in_lavorazione'
    when 'in corso' then 'in_lavorazione'
    when 'annullata' then 'annullata'
    when 'annullato' then 'annullata'
    else 'da_evadere'
  end
$$;

create or replace function public.crm_status_from_workspace_task(
  p_task_status text,
  p_completed_at timestamptz
) returns text
language sql immutable parallel safe
set search_path=public as $$
  select case
    when p_completed_at is not null
      or lower(coalesce(p_task_status,'')) in ('evaso','evasa','completato','completata','chiuso','chiusa')
      then 'completata'
    when lower(coalesce(p_task_status,'')) in ('in_lavorazione','in verifica','in_verifica','in valutazione','in_valutazione')
      then 'in_lavorazione'
    when lower(coalesce(p_task_status,'')) in ('annullato','annullata') then 'annullata'
    else 'pianificata'
  end
$$;

create or replace function public.crm_ensure_workspace_task(p_activity_id uuid)
returns uuid
language plpgsql security definer
set search_path=public as $$
declare
  v_activity public.crm_activities%rowtype;
  v_task_id uuid;
  v_project_id uuid;
  v_actor uuid;
  v_customer_key text;
begin
  -- Serialise concurrent repair/backfill attempts for the same canonical activity.
  perform pg_advisory_xact_lock(hashtextextended(p_activity_id::text,0));

  select * into v_activity
  from public.crm_activities
  where id=p_activity_id
  for update;
  if not found then return null; end if;

  -- Structured/legacy activities already owning a real project and its phases must
  -- never receive an extra standalone task. Repair only their reciprocal pointers.
  select p.id into v_project_id
  from public.v4_progetti p
    where p.id=coalesce(v_activity.workspace_project_id,v_activity.project_id)
       or p.crm_activity_id=v_activity.id
  order by case when p.id=coalesce(v_activity.workspace_project_id,v_activity.project_id) then 0 else 1 end,
    p.created_at,p.id
  limit 1;

  if v_project_id is not null then
    update public.v4_progetti p
    set crm_activity_id=coalesce(p.crm_activity_id,v_activity.id),
        crm_customer_key=coalesce(p.crm_customer_key,v_activity.customer_key),
        crm_opportunity_id=coalesce(p.crm_opportunity_id,v_activity.opportunity_id),
        source_type=coalesce(p.source_type,'crm_activity'),
        source_id=coalesce(p.source_id,v_activity.id)
    where p.id=v_project_id
      and (p.crm_activity_id is null or p.crm_activity_id=v_activity.id);

    update public.crm_activities a
    set workspace_project_id=coalesce(
          a.workspace_project_id,a.project_id,v_project_id
        ),
        project_id=coalesce(
          a.project_id,a.workspace_project_id,v_project_id
        ),
        activity_class=coalesce(a.activity_class,'strutturata')
    where a.id=v_activity.id;

    insert into public.crm_workspace_links(
      crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,metadati,creato_da
    ) values (
      'activity',v_activity.id,'project',v_project_id,
      jsonb_build_object('source_type','canonical_activity','history_preserved',true),
      coalesce(v_activity.creato_da,v_activity.responsabile_id)
    ) on conflict do nothing;
    return null;
  end if;

  -- Prefer the explicit pointer, then repair from the reciprocal canonical FK.
  select f.id into v_task_id
  from public.v4_fasi_progetto f
  where f.id=v_activity.workspace_task_id
  limit 1;

  if v_task_id is null then
    select f.id into v_task_id
    from public.v4_fasi_progetto f
    where f.crm_activity_id=v_activity.id
    order by f.created_at nulls last,f.id
    limit 1;
  end if;

  v_actor := coalesce(v_activity.creato_da,v_activity.responsabile_id);
  v_customer_key := coalesce(
    nullif(v_activity.customer_key,''),
    case when v_activity.account_id is not null then 'crm:'||v_activity.account_id::text end
  );

  if v_task_id is null then
    insert into public.v4_fasi_progetto(
      progetto_id,titolo,descrizione,reparto_id,stato,priorita,assegnato_a,
      ordine,deadline,completato_at,completato_da,creato_da,modificato_da,
      source_type,source_id,crm_customer_key,crm_opportunity_id,crm_activity_id
    ) values (
      null,v_activity.titolo,v_activity.descrizione,v_activity.reparto_id,
      public.crm_workspace_task_status(v_activity.stato),
      coalesce(nullif(v_activity.priorita,''),'normale'),v_activity.responsabile_id,
      1,v_activity.data_attivita::date,
      case when public.crm_workspace_task_status(v_activity.stato)='evaso'
        then coalesce(v_activity.completata_il,v_activity.aggiornato_il,v_activity.creato_il) end,
      case when public.crm_workspace_task_status(v_activity.stato)='evaso'
        then coalesce(v_activity.responsabile_id,v_actor) end,
      v_actor,v_actor,'crm_activity',v_activity.id,v_customer_key,
      v_activity.opportunity_id,v_activity.id
    ) returning id into v_task_id;

    if v_activity.reparto_id is not null then
      insert into public.v4_fase_reparti(fase_id,reparto_id,completato,completato_at,completato_da)
      values(
        v_task_id,v_activity.reparto_id,
        public.crm_workspace_task_status(v_activity.stato)='evaso',
        case when public.crm_workspace_task_status(v_activity.stato)='evaso'
          then coalesce(v_activity.completata_il,v_activity.aggiornato_il,v_activity.creato_il) end,
        case when public.crm_workspace_task_status(v_activity.stato)='evaso'
          then coalesce(v_activity.responsabile_id,v_actor) end
      ) on conflict do nothing;
    end if;

    insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
    values(v_actor,'activity',v_activity.id,'workspace_task_collegata',jsonb_build_object(
      'task_id',v_task_id,'mode','missing_task_backfill','history_preserved',true));
  else
    update public.v4_fasi_progetto
    set crm_activity_id=v_activity.id,
        crm_customer_key=coalesce(crm_customer_key,v_customer_key),
        crm_opportunity_id=coalesce(crm_opportunity_id,v_activity.opportunity_id),
        source_type=coalesce(source_type,'crm_activity'),
        source_id=coalesce(source_id,v_activity.id)
    where id=v_task_id
      and (crm_activity_id is null or crm_activity_id=v_activity.id);
  end if;

  update public.crm_activities
  set workspace_task_id=v_task_id,
      activity_class=coalesce(activity_class,'semplice'),
      customer_key=coalesce(customer_key,v_customer_key)
  where id=v_activity.id
    and (workspace_task_id is distinct from v_task_id
      or activity_class is null
      or (customer_key is null and v_customer_key is not null));

  insert into public.crm_workspace_links(
    crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id,metadati,creato_da
  ) values (
    'activity',v_activity.id,'task',v_task_id,
    jsonb_build_object('source_type','canonical_activity','customer_key',v_customer_key),v_actor
  ) on conflict do nothing;

  return v_task_id;
end;
$$;

revoke all on function public.crm_ensure_workspace_task(uuid) from public,anon,authenticated;
grant execute on function public.crm_ensure_workspace_task(uuid) to service_role;

create or replace function public.crm_deferred_ensure_workspace_task()
returns trigger
language plpgsql security definer
set search_path=public as $$
begin
  perform public.crm_ensure_workspace_task(new.id);
  return null;
end;
$$;

revoke all on function public.crm_deferred_ensure_workspace_task() from public,anon,authenticated;

drop trigger if exists trg_crm_deferred_ensure_workspace_task on public.crm_activities;
create constraint trigger trg_crm_deferred_ensure_workspace_task
after insert on public.crm_activities
deferrable initially deferred
for each row execute function public.crm_deferred_ensure_workspace_task();

create or replace function public.crm_sync_activity_to_workspace_task()
returns trigger
language plpgsql security definer
set search_path=public as $$
begin
  if new.workspace_task_id is null then return new; end if;

  update public.v4_fasi_progetto
  set titolo=new.titolo,
      descrizione=new.descrizione,
      reparto_id=new.reparto_id,
      stato=public.crm_workspace_task_status(new.stato),
      priorita=coalesce(nullif(new.priorita,''),priorita),
      assegnato_a=new.responsabile_id,
      deadline=new.data_attivita::date,
      completato_at=case when public.crm_workspace_task_status(new.stato)='evaso'
        then coalesce(new.completata_il,completato_at,now()) else null end,
      completato_da=case when public.crm_workspace_task_status(new.stato)='evaso'
        then coalesce(new.responsabile_id,completato_da) else null end,
      modificato_da=coalesce(public.workspace_current_profile_id(),new.responsabile_id,new.creato_da),
      updated_at=now()
  where id=new.workspace_task_id
    and crm_activity_id=new.id
    and (titolo,descrizione,reparto_id,stato,priorita,assegnato_a,deadline,completato_at)
      is distinct from (
        new.titolo,new.descrizione,new.reparto_id,public.crm_workspace_task_status(new.stato),
        coalesce(nullif(new.priorita,''),priorita),new.responsabile_id,new.data_attivita::date,
        case when public.crm_workspace_task_status(new.stato)='evaso'
          then coalesce(new.completata_il,completato_at,now()) else null end
      );
  return new;
end;
$$;

revoke all on function public.crm_sync_activity_to_workspace_task() from public,anon,authenticated;

drop trigger if exists trg_crm_sync_activity_to_workspace_task on public.crm_activities;
create trigger trg_crm_sync_activity_to_workspace_task
after update of titolo,descrizione,reparto_id,stato,priorita,responsabile_id,data_attivita,completata_il
on public.crm_activities
for each row
when (old.workspace_task_id is not null)
execute function public.crm_sync_activity_to_workspace_task();

create or replace function public.workspace_sync_task_to_crm_activity()
returns trigger
language plpgsql security definer
set search_path=public as $$
begin
  -- Only the primary 1:1 task drives a CRM activity. Project phases continue to
  -- use the existing aggregate progress trigger.
  update public.crm_activities a
  set titolo=new.titolo,
      descrizione=new.descrizione,
      reparto_id=new.reparto_id,
      stato=public.crm_status_from_workspace_task(new.stato,new.completato_at),
      priorita=coalesce(nullif(new.priorita,''),a.priorita),
      responsabile_id=new.assegnato_a,
      data_attivita=case when new.deadline is null then null else new.deadline::timestamptz end,
      completata_il=case
        when public.crm_status_from_workspace_task(new.stato,new.completato_at)='completata'
          then coalesce(new.completato_at,a.completata_il,now())
        else null end,
      aggiornato_il=now()
  where a.id=new.crm_activity_id
    and a.workspace_task_id=new.id
    and (a.titolo,a.descrizione,a.reparto_id,a.stato,a.priorita,a.responsabile_id,a.data_attivita::date,a.completata_il)
      is distinct from (
        new.titolo,new.descrizione,new.reparto_id,
        public.crm_status_from_workspace_task(new.stato,new.completato_at),
        coalesce(nullif(new.priorita,''),a.priorita),new.assegnato_a,new.deadline,
        case when public.crm_status_from_workspace_task(new.stato,new.completato_at)='completata'
          then coalesce(new.completato_at,a.completata_il,now()) else null end
      );
  return new;
end;
$$;

revoke all on function public.workspace_sync_task_to_crm_activity() from public,anon,authenticated;

drop trigger if exists trg_workspace_sync_task_to_crm_activity on public.v4_fasi_progetto;
create trigger trg_workspace_sync_task_to_crm_activity
after update of titolo,descrizione,reparto_id,stato,priorita,assegnato_a,deadline,completato_at
on public.v4_fasi_progetto
for each row
when (new.crm_activity_id is not null)
execute function public.workspace_sync_task_to_crm_activity();

-- Repair reciprocal pointers first. No existing title, state, date, project or task is changed.
update public.crm_activities a
set workspace_project_id=a.project_id,
    activity_class=coalesce(a.activity_class,'strutturata')
where a.workspace_project_id is null
  and a.project_id is not null
  and exists(select 1 from public.v4_progetti p where p.id=a.project_id);

update public.crm_activities a
set workspace_project_id=p.id,
    project_id=coalesce(a.project_id,p.id),
    activity_class=coalesce(a.activity_class,'strutturata')
from public.v4_progetti p
where p.crm_activity_id=a.id
  and a.workspace_project_id is null;

update public.crm_activities a
set workspace_task_id=f.id,
    activity_class=coalesce(a.activity_class,'semplice')
from public.v4_fasi_progetto f
where f.crm_activity_id=a.id
  and f.progetto_id is null
  and a.workspace_project_id is null
  and a.workspace_task_id is null;

-- Backfill only CRM activities still lacking every operational counterpart.
do $$
declare v_id uuid;
begin
  for v_id in
    select a.id
    from public.crm_activities a
    where a.workspace_project_id is null
      and a.workspace_task_id is null
      and not exists(select 1 from public.v4_progetti p where p.crm_activity_id=a.id)
      and not exists(select 1 from public.v4_fasi_progetto f where f.crm_activity_id=a.id)
    order by a.creato_il,a.id
  loop
    perform public.crm_ensure_workspace_task(v_id);
  end loop;
end $$;

create or replace view public.crm_workspace_canonical_activities
with (security_invoker=true) as
select
  a.id canonical_activity_id,a.crm_tipo,a.account_id,a.opportunity_id,a.tipo,
  a.titolo,a.descrizione,a.stato crm_status,a.data_attivita,a.completata_il,
  a.responsabile_id,a.reparto_id,a.customer_key,a.activity_class,
  a.workspace_project_id,a.workspace_task_id,
  p.titolo workspace_project_title,p.stato workspace_project_status,
  f.titolo workspace_task_title,f.stato workspace_task_status,
  f.deadline workspace_deadline,f.assegnato_a workspace_responsible_id,
  a.creato_il,a.aggiornato_il
from public.crm_activities a
left join public.v4_progetti p on p.id=a.workspace_project_id
left join public.v4_fasi_progetto f on f.id=a.workspace_task_id;

grant select on public.crm_workspace_canonical_activities to authenticated,service_role;

create or replace function public.crm_workspace_activity_integrity()
returns table(
  crm_activities bigint,
  structured_with_project bigint,
  simple_with_task bigint,
  missing_operational_link bigint,
  broken_project_links bigint,
  broken_task_links bigint
)
language plpgsql stable security definer
set search_path=public as $$
begin
  if not public.workspace_user_is_admin() then
    raise exception 'Funzione riservata agli amministratori';
  end if;
  return query
  select
    count(*)::bigint,
    count(*) filter(where a.workspace_project_id is not null)::bigint,
    count(*) filter(where a.workspace_task_id is not null)::bigint,
    count(*) filter(where a.workspace_project_id is null and a.workspace_task_id is null)::bigint,
    count(*) filter(where a.workspace_project_id is not null and p.id is null)::bigint,
    count(*) filter(where a.workspace_task_id is not null and f.id is null)::bigint
  from public.crm_activities a
  left join public.v4_progetti p on p.id=a.workspace_project_id
  left join public.v4_fasi_progetto f on f.id=a.workspace_task_id;
end;
$$;

revoke all on function public.crm_workspace_activity_integrity() from public,anon;
grant execute on function public.crm_workspace_activity_integrity() to authenticated,service_role;

comment on view public.crm_workspace_canonical_activities is
  'Vista canonica delle attivita CRM e dei relativi record operativi Workspace; preserva gli ID delle tabelle sorgenti.';
comment on function public.crm_ensure_workspace_task(uuid) is
  'Collega una task Workspace esistente oppure ne crea una solo se l’attivita CRM non ha gia un progetto/task operativo.';

commit;
