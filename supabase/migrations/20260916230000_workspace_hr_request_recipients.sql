begin;
create table public.workspace_hr_recipients (
  user_id uuid primary key references public.utenti(id),
  created_by uuid not null references public.utenti(id),
  created_at timestamptz not null default now()
);
alter table public.workspace_hr_recipients enable row level security;
revoke all on public.workspace_hr_recipients from public,anon,authenticated;
create function public.workspace_hr_is_reviewer(target uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from workspace_hr_recipients r join utenti u on u.id=r.user_id where r.user_id=target and u.attivo is not false)
$$;
revoke all on function public.workspace_hr_is_reviewer(uuid) from public,anon,authenticated;
create function public.workspace_hr_save_recipients(p_users uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor();
begin
  if not workspace_user_is_admin() then raise exception 'Configurazioni riservate agli admin' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hr:recipients',0));
  if exists(select 1 from unnest(coalesce(p_users,'{}')) requested(user_id) where requested.user_id is null or not exists(select 1 from utenti u where u.id=requested.user_id and u.attivo is not false)) then
    raise exception 'Seleziona utenti attivi';
  end if;
  delete from workspace_hr_recipients where not(user_id=any(coalesce(p_users,'{}')));
  insert into workspace_hr_recipients(user_id,created_by) select distinct id,actor from unnest(coalesce(p_users,'{}')) id on conflict do nothing;
  insert into workspace_hr_audit(actor_id,action,details) values(actor,'configure.recipients',jsonb_build_object('user_ids',coalesce(p_users,'{}')));
  update workspace_access_revision set revision=revision+1 where id;
end $$;
revoke all on function public.workspace_hr_save_recipients(uuid[]) from public,anon;
grant execute on function public.workspace_hr_save_recipients(uuid[]) to authenticated;
create function public.workspace_hr_notify_request() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into notifiche(utente_id,titolo,messaggio,tipo,evento,url,metadata)
  select r.user_id,'Nuova richiesta HR',concat_ws(' ',u.nome,u.cognome)||' ha inviato una richiesta da valutare.',
    'generica','hr_richiesta','/hr?richieste='||case when new.kind='overtime' then 'overtime' else 'leave' end,
    jsonb_build_object('hr_request_id',new.id)
  from workspace_hr_recipients r join utenti recipient on recipient.id=r.user_id and recipient.attivo is not false
    join utenti u on u.id=new.user_id where r.user_id<>new.user_id;
  return new;
end $$;
revoke all on function public.workspace_hr_notify_request() from public,anon,authenticated;
create trigger hr_request_notify after insert on public.workspace_hr_requests for each row execute function public.workspace_hr_notify_request();

create or replace function public.workspace_hr_actor() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid;
begin
  select id into actor from utenti where auth_user_id=auth.uid() and attivo is not false;
  if actor is null then raise exception 'Sessione non autorizzata' using errcode='42501'; end if;
  if not workspace_user_is_admin() and not exists(select 1 from reparti where workspace_hr and attivo) then raise exception 'Reparto HR disattivato' using errcode='42501'; end if;
  if not workspace_user_is_admin() and not workspace_hr_is_reviewer(actor) and not exists(select 1 from workspace_hr_members where user_id=actor and active) then
    raise exception 'Non sei abilitato al modulo HR' using errcode='42501';
  end if;
  return actor;
end $$;
create or replace function public.workspace_hr_snapshot(p_month date default current_date,p_config boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); admin boolean:=workspace_user_is_admin(); can_manage boolean; reviewer boolean;
  first_day date:=date_trunc('month',p_month)::date; last_day date:=(date_trunc('month',p_month)+interval '1 month')::date;
  ids uuid[]; result jsonb;
begin
  if p_month is null then raise exception 'Mese non valido'; end if;
  if p_config and not admin then raise exception 'Configurazioni riservate agli admin' using errcode='42501'; end if;
  can_manage:=admin or exists(select 1 from workspace_hr_members where user_id=actor and active and workspace_hr_members.manager);
  reviewer:=workspace_hr_is_reviewer(actor);
  select coalesce(array_agg(m.user_id),'{}') into ids from workspace_hr_members m join utenti u on u.id=m.user_id
    where can_manage or reviewer or (u.attivo is not false and m.active and m.user_id=actor);
  result:=jsonb_build_object('actor_id',actor,'admin',admin,'manager',can_manage,'reviewer',reviewer,
    'member',exists(select 1 from workspace_hr_members where user_id=actor and active),
    'employees',(select coalesce(jsonb_agg(jsonb_build_object('user_id',u.id,'name',concat_ws(' ',u.nome,u.cognome),
      'employee_code',m.employee_code,'active',m.active and u.attivo is not false,'manager',m.manager,
      'department',coalesce((select string_agg(distinct r.nome,', ' order by r.nome) from reparti r where r.id=u.reparto_id or exists(select 1 from utenti_reparti ur where ur.utente_id=u.id and ur.reparto_id=r.id)),'')) order by u.nome),'[]')
      from utenti u join workspace_hr_members m on m.user_id=u.id where u.id=any(ids)),
    'sites',(select coalesce(jsonb_agg(to_jsonb(s) order by name),'[]') from workspace_hr_sites s),
    'shifts',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m,'work_date',d::date,'starts_at',p.starts_at,'ends_at',p.ends_at,'break_minutes',p.break_minutes,'site_id',p.site_id) order by d,p.starts_at),'[]')
      from unnest(ids) m cross join generate_series(first_day-1,last_day-1,interval '1 day') d cross join lateral workspace_hr_plan(m,d::date) p where can_manage or m=actor),
    'attendance',(select coalesce(jsonb_agg(to_jsonb(a)-'request_key'-'outside_since'-'last_outside_at' order by checkin_at desc),'[]') from workspace_hr_attendance a
      where user_id=any(ids) and (can_manage or user_id=actor) and (checkout_at is null or (checkin_at<last_day::timestamp at time zone 'Europe/Rome' and checkout_at>=first_day::timestamp at time zone 'Europe/Rome'))),
    'requests',(select coalesce(jsonb_agg(to_jsonb(r)-'request_key' order by created_at desc),'[]') from workspace_hr_requests r where user_id=any(ids)
      and (status='pending' or (starts_at<last_day::timestamp at time zone 'Europe/Rome' and ends_at>=first_day::timestamp at time zone 'Europe/Rome'))),
    'closures',(select coalesce(jsonb_agg(to_jsonb(h) order by date_from),'[]') from workspace_hr_closures h where date_from<last_day and date_to>=first_day));
  if p_config then
    result:=result||jsonb_build_object(
      'recipients',(select coalesce(jsonb_agg(user_id),'[]') from workspace_hr_recipients),
      'users',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',concat_ws(' ',nome,cognome)) order by nome),'[]') from utenti where attivo is not false),
      'contracts',(select coalesce(jsonb_agg(to_jsonb(c) order by effective_from desc,created_at desc),'[]') from workspace_hr_contracts c where user_id=any(ids)),
      'audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select * from workspace_hr_audit order by id desc limit 100) a));
  end if;
  return result;
end $$;
create or replace function public.workspace_hr_operate(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); manager boolean; target uuid; row workspace_hr_requests;
  a workspace_hr_attendance; t1 timestamptz; t2 timestamptz; d date; c workspace_hr_contracts;
begin
  manager:=workspace_user_is_admin() or exists(select 1 from workspace_hr_members where user_id=actor and active and workspace_hr_members.manager);
  if p_action='request' then
    perform pg_advisory_xact_lock(hashtextextended('hr:'||actor,0));
    if not exists(select 1 from workspace_hr_members where user_id=actor and active) then raise exception 'Scheda dipendente non attiva'; end if;
    select * into row from workspace_hr_requests where request_key=(p_data->>'request_key')::uuid and user_id=actor;
    if found then return jsonb_build_object('id',row.id); end if;
    t1:=(p_data->>'starts_at')::timestamptz; t2:=(p_data->>'ends_at')::timestamptz;
    if p_data->>'kind'='correction' then
      select * into a from workspace_hr_attendance where id=(p_data->>'attendance_id')::uuid and user_id=actor;
      if not found or a.checkout_at is not null or t2<a.checkin_at or t2>now() then raise exception 'Uscita da correggere non valida'; end if;
      t1:=a.checkin_at;
    elsif p_data->>'kind'='overtime' then
      select * into c from workspace_hr_contracts where user_id=actor and effective_from<=(t1 at time zone 'Europe/Rome')::date order by effective_from desc,created_at desc limit 1;
      if not found or c.overtime_mode='disabled' then raise exception 'Straordinario non abilitato: contatta l’admin'; end if;
      if t2-t1>interval '16 hours' then raise exception 'Durata straordinario non valida'; end if;
    end if;
    insert into workspace_hr_requests(request_key,user_id,kind,starts_at,ends_at,attendance_id,note)
    values((p_data->>'request_key')::uuid,actor,p_data->>'kind',t1,t2,case when p_data->>'kind'='correction' then a.id end,p_data->>'note') returning id into target;
  elsif p_action='review' then
    if not manager and not workspace_hr_is_reviewer(actor) then raise exception 'Gestione HR non autorizzata' using errcode='42501'; end if;
    select * into row from workspace_hr_requests where id=(p_data->>'id')::uuid for update;
    if not found or row.status<>'pending' then raise exception 'Richiesta già gestita o non trovata'; end if;
    if row.user_id=actor then raise exception 'Non puoi approvare o rifiutare una tua richiesta'; end if;
    if coalesce(p_data->>'status','') not in ('approved','rejected') then raise exception 'Esito non valido'; end if;
    if nullif(btrim(p_data->>'note'),'') is null then raise exception 'Inserisci una motivazione'; end if;
    perform pg_advisory_xact_lock(hashtextextended('hr:'||row.user_id,0));
    if p_data->>'status'='approved' then
      if row.kind in ('leave','permission','overtime') and exists(select 1 from workspace_hr_requests r where r.id<>row.id and r.user_id=row.user_id and r.status='approved' and r.kind in ('leave','permission','overtime') and r.starts_at<row.ends_at and r.ends_at>row.starts_at) then raise exception 'Periodo sovrapposto a una richiesta già approvata'; end if;
      if row.kind='correction' then
        select * into a from workspace_hr_attendance where id=row.attendance_id for update;
        if a.checkout_at is not null or row.ends_at<a.checkin_at or row.ends_at>now() then raise exception 'La presenza non è più correggibile'; end if;
        update workspace_hr_attendance set checkout_at=row.ends_at,checkout_kind='correction',outside_since=null,last_outside_at=null where id=a.id;
      end if;
    end if;
    update workspace_hr_requests set status=p_data->>'status',reviewed_by=actor,review_note=p_data->>'note',reviewed_at=now() where id=row.id;
    target:=row.id;
  elsif p_action='shift' then
    if not manager then raise exception 'Gestione HR non autorizzata' using errcode='42501'; end if;
    target:=(p_data->>'user_id')::uuid;
    if not exists(select 1 from workspace_hr_members where user_id=target and active) then raise exception 'Dipendente non attivo'; end if;
    if (p_data->>'date_to')::date<(p_data->>'date_from')::date or (p_data->>'date_to')::date-(p_data->>'date_from')::date>62 or (p_data->>'date_from')::date<(now() at time zone 'Europe/Rome')::date then raise exception 'Periodo turni non valido (massimo 63 giorni, da oggi)'; end if;
    if nullif(p_data->>'date_from','') is null or nullif(p_data->>'date_to','') is null then raise exception 'Indica il periodo'; end if;
    if coalesce(jsonb_array_length(p_data->'weekdays'),0)=0 or not array(select jsonb_array_elements_text(p_data->'weekdays')::integer)<@array[1,2,3,4,5,6,7] then raise exception 'Giorni del turno non validi'; end if;
    for d in select generate_series((p_data->>'date_from')::date,(p_data->>'date_to')::date,interval '1 day')::date loop
      if extract(isodow from d)::integer=any(array(select jsonb_array_elements_text(p_data->'weekdays')::integer)) then
        t1:=(d+(p_data->>'start_time')::time) at time zone 'Europe/Rome';
        t2:=(d+(p_data->>'end_time')::time+case when (p_data->>'end_time')::time<=(p_data->>'start_time')::time then interval '1 day' else interval '0' end) at time zone 'Europe/Rome';
        insert into workspace_hr_shifts(user_id,work_date,starts_at,ends_at,break_minutes,site_id)
        values(target,d,t1,t2,(p_data->>'break_minutes')::integer,(p_data->>'site_id')::uuid)
        on conflict(user_id,work_date) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,break_minutes=excluded.break_minutes,site_id=excluded.site_id;
      end if;
    end loop;
  elsif p_action='closure' then
    if not manager then raise exception 'Gestione HR non autorizzata' using errcode='42501'; end if;
    insert into workspace_hr_closures(name,date_from,date_to) values(p_data->>'name',(p_data->>'date_from')::date,(p_data->>'date_to')::date) returning id into target;
  elsif p_action='correct_attendance' then
    if not manager then raise exception 'Gestione HR non autorizzata' using errcode='42501'; end if;
    if nullif(btrim(p_data->>'note'),'') is null then raise exception 'Inserisci una motivazione'; end if;
    select * into a from workspace_hr_attendance where id=(p_data->>'id')::uuid for update;
    if not found then raise exception 'Presenza non trovata'; end if;
    if a.user_id=actor then raise exception 'Per correggere la tua presenza invia una richiesta'; end if;
    t2:=(p_data->>'checkout_at')::timestamptz;
    if a.checkout_at is not null or t2 is null or t2<a.checkin_at or t2>now() then raise exception 'Uscita da correggere non valida'; end if;
    update workspace_hr_attendance set checkout_at=t2,checkout_kind='correction',outside_since=null,last_outside_at=null where id=a.id;
    target:=a.id;
  else raise exception 'Operazione non riconosciuta'; end if;
  insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,p_action,target,p_data-'request_key');
  return jsonb_build_object('id',target);
end $$;
do $$ declare definition text; begin
select pg_get_functiondef('public.workspace_module_enabled_for_user(uuid,text)'::regprocedure) into definition;
if position('exists(select 1 from public.workspace_hr_members hm where hm.user_id=t.id and hm.active)' in definition)=0 then raise exception 'Review HR module resolver'; end if;
definition:=replace(definition,'exists(select 1 from public.workspace_hr_members hm where hm.user_id=t.id and hm.active)','(exists(select 1 from public.workspace_hr_members hm where hm.user_id=t.id and hm.active) or workspace_hr_is_reviewer(t.id))');
execute definition; end $$;
notify pgrst,'reload schema';
commit;
