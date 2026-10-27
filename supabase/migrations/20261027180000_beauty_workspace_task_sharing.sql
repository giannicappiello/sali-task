begin;

-- One operational task per historical day. This is a projection, not a second
-- editable copy of the report or its commercial/GPS data.
create table public.beauty_day_tasks (
  giornata_id uuid primary key,
  task_id uuid not null unique references public.v4_fasi_progetto(id) on delete cascade,
  consultant_id uuid,
  legacy_agent_id uuid,
  customer_code text,
  source_date date not null,
  source_status text not null
);
alter table public.beauty_day_tasks enable row level security;
revoke all on public.beauty_day_tasks from public,anon,authenticated;
grant all on public.beauty_day_tasks to service_role;

create or replace function public.workspace_sync_beauty_day(p_day jsonb,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 day_id uuid:=(p_day->>'id')::uuid; task uuid; existing_task uuid; beauty_user uuid;
 customer text; task_title text; task_status text; task_date date; actor uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operazione riservata al servizio';end if;
 if day_id is null or p_day->>'data' is null then raise exception 'Giornata senza identificativo o data';end if;
 perform pg_advisory_xact_lock(hashtextextended('beauty-day:'||day_id::text,0));
 task_date:=(p_day->>'data')::date;
 task_status:=case p_day->>'stato' when 'eseguita' then 'evaso' when 'annullata' then 'annullata' else 'da_evadere' end;
 select i.utente_id into beauty_user from public.integrazioni_utenti i join public.utenti u on u.id=i.utente_id
 where i.modulo='report_giornate' and i.enabled is true and u.attivo is not false
   and i.external_beauty_id::text=p_day->>'consultant_id' limit 1;
 actor:=coalesce(beauty_user,p_actor_id);
 if actor is null or not exists(select 1 from public.utenti where id=actor and attivo is not false) then
  raise exception 'Profilo operativo della giornata non disponibile';end if;
 select b.codice_cliente into customer from public.beauty_clienti_mexal b
 where b.legacy_farmacia_id::text=p_day->>'farmacia_id' limit 1;
 task_title:=coalesce(nullif(p_day->>'tipo_giornata',''),'Beauty Days')||' - '||coalesce(
  (select ragione_sociale from public.ordini_clienti_cache where codice_cliente=customer),
  nullif(p_day->>'customer_name',''),'Cliente storico');
 select a.workspace_task_id into existing_task from public.crm_visit_details d
 join public.crm_activities a on a.id=d.activity_id where d.legacy_giornata_id=day_id;
 select b.task_id into task from public.beauty_day_tasks b where b.giornata_id=day_id;
 if task is not null and existing_task is not null and task<>existing_task then
  raise exception 'Collegamento task duplicato: verifica necessaria';end if;
 task:=coalesce(existing_task,task);
 if task is null then
  insert into public.v4_fasi_progetto(progetto_id,titolo,descrizione,stato,priorita,assegnato_a,ordine,deadline,
    completato_at,completato_da,creato_da,modificato_da,source_type,source_id,crm_customer_key,crm_tipo)
  values(null,task_title,'Giornata promozionale Beauty Days',task_status,'normale',actor,1,task_date,
    case when task_status='evaso' then task_date::timestamptz end,case when task_status='evaso' then actor end,
    actor,actor,'beauty_day',day_id,case when customer is not null then 'mexal:'||customer end,'b2b')
  returning id into task;
 end if;
 update public.v4_fasi_progetto set titolo=task_title,stato=task_status,deadline=task_date,
   completato_at=case when task_status='evaso' then coalesce(completato_at,task_date::timestamptz) else null end,
   completato_da=case when task_status='evaso' then coalesce(completato_da,actor) else null end,
   modificato_da=coalesce(p_actor_id,actor),updated_at=now()
 where id=task and ((titolo,stato,deadline) is distinct from (task_title,task_status,task_date)
   or (task_status='evaso' and completato_at is null) or (task_status<>'evaso' and completato_at is not null));
 insert into public.beauty_day_tasks(giornata_id,task_id,consultant_id,legacy_agent_id,customer_code,source_date,source_status)
 values(day_id,task,nullif(p_day->>'consultant_id','')::uuid,nullif(p_day->>'legacy_agent_id','')::uuid,
   customer,task_date,coalesce(p_day->>'stato','pianificata'))
 on conflict(giornata_id) do update set task_id=excluded.task_id,consultant_id=excluded.consultant_id,
   legacy_agent_id=excluded.legacy_agent_id,customer_code=excluded.customer_code,
   source_date=excluded.source_date,source_status=excluded.source_status;
 return task;
end $$;
revoke all on function public.workspace_sync_beauty_day(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.workspace_sync_beauty_day(jsonb,uuid) to service_role;

-- Link-only privilege: a caller may attach the activity they just created for
-- this same historical day, without gaining general task editing rights.
create or replace function public.workspace_attach_beauty_day_task(p_day_id uuid,p_activity_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare task uuid; customer text; activity public.crm_activities%rowtype;
begin
 select * into activity from public.crm_activities where id=p_activity_id;
 if activity.creato_da is distinct from public.workspace_current_profile_id()
   or activity.tipo<>'visita_beauty' or activity.source_id is distinct from p_day_id then
  raise exception 'Collegamento visita non autorizzato';end if;
 select task_id,customer_code into task,customer from public.beauty_day_tasks where giornata_id=p_day_id for update;
 if task is null or (customer is not null and not exists(select 1 from public.crm_accounts
   where id=activity.account_id and codice_cliente_mexal=customer)) then raise exception 'Cliente della giornata non corrispondente';end if;
 if not exists(select 1 from public.workspace_visible_beauty_task_ids() visible_id where visible_id=task) then
  raise exception 'Task della giornata fuori dal perimetro autorizzato';end if;
 if exists(select 1 from public.v4_fasi_progetto where id=task and crm_activity_id is not null and crm_activity_id<>p_activity_id) then
  raise exception 'Giornata già collegata a una visita';end if;
 update public.v4_fasi_progetto set crm_activity_id=p_activity_id,source_type='crm_activity',
   source_id=p_activity_id,crm_customer_key=activity.customer_key where id=task;
 update public.crm_activities a set stato=public.crm_status_from_workspace_task(f.stato,f.completato_at),
   completata_il=case when f.completato_at is not null then f.completato_at else null end
 from public.v4_fasi_progetto f where a.id=p_activity_id and f.id=task
   and a.stato is distinct from public.crm_status_from_workspace_task(f.stato,f.completato_at);
end $$;
revoke all on function public.workspace_attach_beauty_day_task(uuid,uuid) from public,anon;
grant execute on function public.workspace_attach_beauty_day_task(uuid,uuid) to authenticated,service_role;

-- The legacy save creates the task first. The subsequent CRM link reuses it.
do $migration$
declare original text; changed text;
begin
 original:=pg_get_functiondef('public.crm_create_beauty_visit(text,text,text,text,text,text,text,timestamptz,double precision,double precision,uuid,text)'::regprocedure);
 changed:=replace(original,'  insert into public.v4_fasi_progetto(',
   E'  select task_id into v_task_id from public.beauty_day_tasks where giornata_id=p_legacy_giornata_id;\n  if v_task_id is null then\n  insert into public.v4_fasi_progetto(');
 changed:=replace(changed,') returning id into v_task_id;',E') returning id into v_task_id;\n  else\n    perform public.workspace_attach_beauty_day_task(p_legacy_giornata_id,v_activity_id);\n  end if;');
 if changed=original or position('if v_task_id is null then' in changed)=0 then raise exception 'Unexpected Beauty task creation definition';end if;
 execute changed;
end $migration$;

create or replace function public.workspace_visible_beauty_task_ids()
returns setof uuid language sql stable security definer set search_path=public as $$
 with me as materialized (
  select u.id,public.workspace_data_scope() scope,coalesce(r.accesso_come_beauty,false) beauty
  from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
  where u.auth_user_id=auth.uid() and u.attivo is not false
    and not exists(select 1 from public.workspace_customer_user_links l where l.user_id=u.id)
 ), visits as (
  select f.id,f.creato_da,f.assegnato_a,
    coalesce(b.consultant_id::text,d.report_data->'planning'->>'consultant_id') consultant,
    b.legacy_agent_id,coalesce(b.customer_code,a.codice_cliente_mexal) customer
  from public.v4_fasi_progetto f
  left join public.beauty_day_tasks b on b.task_id=f.id
  left join public.crm_activities c on c.id=f.crm_activity_id and c.tipo='visita_beauty'
  left join public.crm_visit_details d on d.activity_id=c.id
  left join public.crm_accounts a on a.id=c.account_id
  where b.task_id is not null or c.id is not null
 )
 select v.id from visits v cross join me where
  me.scope->>'mode'='tutti' or v.creato_da=me.id or v.assegnato_a=me.id
  or exists(select 1 from public.integrazioni_utenti i where i.modulo='report_giornate' and i.enabled is true
    and i.external_beauty_id::text=v.consultant and (
      i.utente_id=me.id or (me.scope->>'mode'='team' and me.scope->>'team_scope'='gerarchia' and me.scope->'user_ids' ? i.utente_id::text)))
  or (not me.beauty and (
    exists(select 1 from public.ordini_clienti_cache c join public.mexal_agenti ag
      on public.normalize_mexal_agent_code(ag.codice)=public.normalize_mexal_agent_code(c.codice_agente_mexal)
      where c.codice_cliente=v.customer and c.sync_excluded is false and ag.attivo_mexal is not false and me.scope->'agent_ids' ? ag.id::text)
    or (v.customer is null and exists(select 1 from public.integrazioni_utenti i where i.modulo='report_giornate'
      and i.enabled is true and i.external_agent_id=v.legacy_agent_id and (
        i.utente_id=me.id or me.scope->'agent_ids' ? i.mexal_agente_id::text)))
  ));
$$;
revoke all on function public.workspace_visible_beauty_task_ids() from public,anon;
grant execute on function public.workspace_visible_beauty_task_ids() to authenticated,service_role;
grant select on public.beauty_day_tasks to authenticated;
create policy "beauty day task participant read" on public.beauty_day_tasks for select to authenticated
using (task_id in (select public.workspace_visible_beauty_task_ids()));
create policy "beauty shared task read" on public.v4_fasi_progetto for select to authenticated
using (id in (select public.workspace_visible_beauty_task_ids()));
alter policy "whole project phase read scope" on public.v4_fasi_progetto using (
 creato_da=(select public.workspace_current_profile_id()) or assegnato_a=(select public.workspace_current_profile_id())
 or id=any((select public.workspace_visible_phase_ids())::uuid[])
 or id in (select public.workspace_visible_beauty_task_ids()));
update public.workspace_access_revision set revision=revision+1 where id;
notify pgrst,'reload schema';
commit;
