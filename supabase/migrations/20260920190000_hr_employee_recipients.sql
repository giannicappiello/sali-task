begin;
create table public.workspace_hr_employee_recipients (
 employee_id uuid not null references public.workspace_hr_members(user_id) on delete cascade,
 reviewer_id uuid not null references public.utenti(id),
 created_by uuid not null references public.utenti(id),
 created_at timestamptz not null default now(),
 primary key(employee_id,reviewer_id), check(employee_id<>reviewer_id)
);
create index on public.workspace_hr_employee_recipients(reviewer_id);
alter table public.workspace_hr_employee_recipients enable row level security;
revoke all on public.workspace_hr_employee_recipients from public,anon,authenticated;
insert into public.workspace_hr_employee_recipients(employee_id,reviewer_id,created_by)
select m.user_id,r.user_id,r.created_by from public.workspace_hr_members m cross join public.workspace_hr_recipients r
where m.user_id<>r.user_id;
create or replace function public.workspace_hr_is_reviewer(target uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from workspace_hr_employee_recipients r join utenti u on u.id=r.reviewer_id
 where r.reviewer_id=target and u.attivo is not false)
$$;
create function public.workspace_hr_reviews_employee(reviewer uuid,employee uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select reviewer<>employee and exists(select 1 from workspace_hr_employee_recipients r
 join utenti u on u.id=r.reviewer_id where r.reviewer_id=reviewer and r.employee_id=employee and u.attivo is not false)
$$;
revoke all on function public.workspace_hr_reviews_employee(uuid,uuid) from public,anon,authenticated;
create function public.workspace_hr_set_employee_recipients(p_employee uuid,p_users uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor();
begin
 if not workspace_user_is_admin() then raise exception 'Configurazioni riservate agli admin' using errcode='42501'; end if;
 if not exists(select 1 from workspace_hr_members where user_id=p_employee) then raise exception 'Dipendente non disponibile'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hr:'||p_employee,0));
 if exists(select 1 from unnest(coalesce(p_users,'{}')) requested(reviewer_id) where requested.reviewer_id is null or requested.reviewer_id=p_employee or not exists(select 1 from utenti u where u.id=requested.reviewer_id and u.attivo is not false)) then
  raise exception 'Seleziona responsabili attivi diversi dal dipendente';
 end if;
 delete from workspace_hr_employee_recipients where employee_id=p_employee and not(reviewer_id=any(coalesce(p_users,'{}')));
 insert into workspace_hr_employee_recipients(employee_id,reviewer_id,created_by)
 select p_employee,id,actor from unnest(coalesce(p_users,'{}')) id on conflict do nothing;
 insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'configure.employee_recipients',p_employee,jsonb_build_object('reviewer_ids',coalesce(p_users,'{}')));
 update workspace_access_revision set revision=revision+1 where id;
end $$;
revoke all on function public.workspace_hr_set_employee_recipients(uuid,uuid[]) from public,anon,authenticated;
-- Old clients must reload rather than silently changing obsolete company-wide settings.
create or replace function public.workspace_hr_save_recipients(p_users uuid[]) returns void
language plpgsql security definer set search_path=public as $$
begin raise exception 'Configura i responsabili nella scheda di ciascun dipendente. Ricarica Workspace.'; end $$;
create or replace function public.workspace_hr_notify_request() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into notifiche(utente_id,titolo,messaggio,tipo,evento,url,metadata)
 select r.reviewer_id,'Nuova richiesta HR',concat_ws(' ',u.nome,u.cognome)||' ha inviato una richiesta da valutare.',
 'generica','hr_richiesta','/hr?richieste='||case when new.kind='overtime' then 'overtime' else 'leave' end,jsonb_build_object('hr_request_id',new.id)
 from workspace_hr_employee_recipients r join utenti recipient on recipient.id=r.reviewer_id and recipient.attivo is not false
 join utenti u on u.id=new.user_id where r.employee_id=new.user_id and r.reviewer_id<>new.user_id;
 return new;
end $$;
-- Preserve later calendar/network additions to these functions.
do $$
declare original text; updated text;
begin
 original:=pg_get_functiondef('public.workspace_hr_save_employee(jsonb,uuid)'::regprocedure);
 updated:=replace(original,'  insert into workspace_hr_audit(actor_id,action,target_id,details)',
 $inject$  if p_data ? 'reviewer_ids' then
    if jsonb_typeof(p_data->'reviewer_ids')<>'array' then raise exception 'Responsabili non validi'; end if;
    perform workspace_hr_set_employee_recipients(target,array(select jsonb_array_elements_text(p_data->'reviewer_ids')::uuid));
  end if;
  insert into workspace_hr_audit(actor_id,action,target_id,details)$inject$);
 if updated=original then raise exception 'Review employee editor contract'; end if; execute updated;
 original:=pg_get_functiondef('public.workspace_hr_operate(text,jsonb)'::regprocedure);
 updated:=replace(original,'    if row.user_id=actor then',
 $inject$    if not workspace_user_is_admin() and not workspace_hr_reviews_employee(actor,row.user_id) then raise exception 'Non sei responsabile di questo dipendente' using errcode='42501'; end if;
    if row.user_id=actor then$inject$);
 if updated=original then raise exception 'Review HR approval contract'; end if; execute updated;
 original:=pg_get_functiondef('public.workspace_hr_snapshot(date,boolean)'::regprocedure);
 updated:=replace(original,'where can_manage or reviewer or (u.attivo', 'where can_manage or workspace_hr_reviews_employee(actor,m.user_id) or (u.attivo');
 if updated=original then raise exception 'Review HR visibility contract'; end if;
 updated:=replace(updated,'''employee_code'',m.employee_code,','''reviewer_ids'',(select coalesce(jsonb_agg(reviewer_id),''[]'') from workspace_hr_employee_recipients where employee_id=u.id),''employee_code'',m.employee_code,');
 updated:=replace(updated,'to_jsonb(r)-''request_key'' order by created_at desc','(to_jsonb(r)-''request_key'')||jsonb_build_object(''can_review'',r.user_id<>actor and (admin or workspace_hr_reviews_employee(actor,r.user_id))) order by created_at desc');
 updated:=replace(updated,'''recipients'',(select coalesce(jsonb_agg(user_id),''[]'') from workspace_hr_recipients),','');
 if position('''can_review''' in updated)=0 or position('''reviewer_ids''' in updated)=0 then raise exception 'Review HR snapshot payload'; end if;
 execute updated;
end $$;
notify pgrst,'reload schema';
commit;
