begin;

alter table public.reparti add column workspace_hr boolean not null default false;
create unique index reparti_one_hr on public.reparti(workspace_hr) where workspace_hr;
do $$ declare hr_id uuid; begin
  select id into hr_id from public.reparti where lower(btrim(nome))='human resources' limit 1;
  if hr_id is null then
    insert into public.reparti(nome,descrizione,attivo,workspace_hr) values('Human Resources','Appartenenza aggiuntiva indipendente per presenze e gestione del personale.',true,true);
  else update public.reparti set workspace_hr=true where id=hr_id; end if;
end $$;

-- HR membership is additional: never add it to utenti_reparti, whose membership
-- also controls chat and commercial data. No existing operational role is changed.
create table public.workspace_hr_members (
  user_id uuid primary key references public.utenti(id),
  department_name text not null default 'Human Resources' check (department_name='Human Resources'),
  employee_code text not null default '', active boolean not null default true,
  manager boolean not null default false, created_at timestamptz not null default now()
);
create trigger workspace_hr_access_changed after insert or update or delete on public.workspace_hr_members
for each statement execute function public.workspace_touch_access_revision();
create table public.workspace_hr_sites (
  id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  checkin_radius integer not null default 30 check(checkin_radius between 10 and 100),
  checkout_radius integer not null default 100 check(checkout_radius between 50 and 1000 and checkout_radius>checkin_radius),
  auto_checkout boolean not null default true
);
-- Contract and pay never appear in operational queries. Append-only versions.
create table public.workspace_hr_contracts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.workspace_hr_members(user_id),
  effective_from date not null, site_id uuid not null references public.workspace_hr_sites(id),
  weekly_hours numeric(5,2) not null check(weekly_hours>0 and weekly_hours<=80),
  start_time time not null, end_time time not null,
  weekdays integer[] not null default '{1,2,3,4,5}' check(cardinality(weekdays)>0 and weekdays <@ array[1,2,3,4,5,6,7]),
  break_minutes integer not null default 60 check(break_minutes between 0 and 480),
  agreed_pay numeric(12,2) not null check(agreed_pay between 0 and 9999999999.99),
  pay_period text not null check(pay_period in ('month','hour','year')),
  overtime_mode text not null check(overtime_mode in ('paid','bank','disabled')),
  overtime_rate numeric(10,2) not null default 0 check(overtime_rate between 0 and 99999999.99),
  overtime_percent numeric(6,2) not null default 0 check(overtime_percent between 0 and 500),
  created_by uuid not null references public.utenti(id), created_at timestamptz not null default now()
);
create index workspace_hr_contract_effective on public.workspace_hr_contracts(user_id,effective_from desc,created_at desc);
create table public.workspace_hr_shifts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.workspace_hr_members(user_id),
  work_date date not null, starts_at timestamptz not null, ends_at timestamptz not null,
  break_minutes integer not null default 60 check(break_minutes>=0),
  site_id uuid not null references public.workspace_hr_sites(id),
  check(ends_at>starts_at and ends_at-starts_at<=interval '24 hours'),
  check(break_minutes*interval '1 minute'<ends_at-starts_at), unique(user_id,work_date)
);
create table public.workspace_hr_closures (
  id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
  date_from date not null, date_to date not null, check(date_to>=date_from and date_to-date_from<=366)
);
create table public.workspace_hr_attendance (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.workspace_hr_members(user_id),
  site_id uuid not null references public.workspace_hr_sites(id),
  request_key uuid not null unique, checkin_at timestamptz not null default now(), checkout_at timestamptz,
  checkout_kind text check(checkout_kind in ('manual','automatic','correction')),
  entry_distance numeric not null, entry_accuracy numeric not null,
  exit_distance numeric, exit_accuracy numeric,
  site_latitude double precision not null, site_longitude double precision not null,
  checkout_radius integer not null, auto_checkout boolean not null,
  outside_since timestamptz, last_outside_at timestamptz,
  check(checkout_at is null or checkout_at>=checkin_at)
);
create unique index workspace_hr_one_open on public.workspace_hr_attendance(user_id) where checkout_at is null;
create index workspace_hr_attendance_month on public.workspace_hr_attendance(user_id,checkin_at desc);
create table public.workspace_hr_requests (
  id uuid primary key default gen_random_uuid(), request_key uuid not null unique,
  user_id uuid not null references public.workspace_hr_members(user_id),
  kind text not null check(kind in ('leave','permission','illness','pregnancy','overtime','correction')),
  starts_at timestamptz not null, ends_at timestamptz not null,
  attendance_id uuid references public.workspace_hr_attendance(id),
  note text not null check(length(btrim(note)) between 1 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.utenti(id), review_note text, reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check(ends_at>starts_at and ends_at-starts_at<=interval '366 days')
);
create index workspace_hr_requests_month on public.workspace_hr_requests(user_id,starts_at);
create table public.workspace_hr_audit (
  id bigint generated always as identity primary key, actor_id uuid not null references public.utenti(id),
  action text not null, target_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now()
);

-- No browser can select or mutate the underlying tables, even with a guessed ID.
do $$ declare t text; begin
  foreach t in array array['members','sites','contracts','shifts','closures','attendance','requests','audit'] loop
    execute format('alter table public.workspace_hr_%I enable row level security',t);
    execute format('revoke all on public.workspace_hr_%I from public,anon,authenticated',t);
  end loop;
end $$;

-- Admins assign the real HR department through the existing user access form.
-- Its independent membership does not enter the operational authorization graph.
grant select on public.workspace_hr_members to authenticated;
create policy hr_admin_members on public.workspace_hr_members for select to authenticated using(public.workspace_user_is_admin());
do $$ declare definition text; begin
  select pg_get_functiondef('public.workspace_save_user_access(uuid,uuid,uuid[],jsonb,boolean)'::regprocedure) into definition;
  if position('update utenti set ruolo_id' in definition)=0 then raise exception 'User access function changed: review HR integration'; end if;
  definition:=replace(definition,'update utenti set ruolo_id',
    'insert into workspace_hr_members(user_id,active)
       select target_user_id,true where exists(select 1 from reparti where workspace_hr and id=any(department_ids))
       on conflict(user_id) do update set active=true;
     update workspace_hr_members set active=false where user_id=target_user_id
       and not exists(select 1 from reparti where workspace_hr and id=any(department_ids));
     department_ids:=array(select d.department_id from unnest(department_ids) d(department_id) where not exists(select 1 from reparti r where r.id=d.department_id and r.workspace_hr));
     update utenti set ruolo_id');
  execute definition;
end $$;
insert into public.workspace_hr_members(user_id)
select distinct u.id from utenti u where exists(select 1 from reparti r where r.workspace_hr and (u.reparto_id=r.id or exists(select 1 from utenti_reparti ur where ur.utente_id=u.id and ur.reparto_id=r.id))) on conflict do nothing;
delete from public.utenti_reparti where reparto_id in(select id from reparti where workspace_hr);
update public.utenti set reparto_id=null where reparto_id in(select id from reparti where workspace_hr);

create function public.workspace_hr_actor() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid;
begin
  select id into actor from utenti where auth_user_id=auth.uid() and attivo is not false;
  if actor is null then raise exception 'Sessione non autorizzata' using errcode='42501'; end if;
  if not workspace_user_is_admin() and not exists(select 1 from reparti where workspace_hr and attivo) then raise exception 'Reparto HR disattivato' using errcode='42501'; end if;
  if not workspace_user_is_admin() and not exists(select 1 from workspace_hr_members where user_id=actor and active) then
    raise exception 'Non sei abilitato al modulo HR' using errcode='42501';
  end if;
  return actor;
end $$;

create function public.workspace_hr_distance(a double precision,b double precision,c double precision,d double precision)
returns double precision language sql immutable set search_path=public as $$
  select 6371000*2*asin(least(1,sqrt(power(sin(radians(c-a)/2),2)+cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2))));
$$;

create function public.workspace_hr_open_session() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); result jsonb;
begin
  select to_jsonb(a)-'request_key'-'outside_since'-'last_outside_at' into result from workspace_hr_attendance a where user_id=actor and checkout_at is null;
  return result;
end $$;

-- Planned shifts are derived from the effective contract; only operational
-- times are returned. Explicit shifts override the weekly default.
create function public.workspace_hr_plan(p_user uuid,p_day date)
returns table(starts_at timestamptz,ends_at timestamptz,break_minutes integer,site_id uuid)
language sql stable security definer set search_path=public as $$
  with c as (select * from workspace_hr_contracts where user_id=p_user and effective_from<=p_day order by effective_from desc,created_at desc limit 1),
  explicit as (select * from workspace_hr_shifts where user_id=p_user and work_date=p_day)
  select s.starts_at,s.ends_at,s.break_minutes,s.site_id from explicit s
  where p_day<(now() at time zone 'Europe/Rome')::date or exists(select 1 from workspace_hr_members m join utenti u on u.id=m.user_id where m.user_id=p_user and m.active and u.attivo is not false)
  union all
  select (p_day+c.start_time) at time zone 'Europe/Rome',
    (p_day+c.end_time+case when c.end_time<=c.start_time then interval '1 day' else interval '0' end) at time zone 'Europe/Rome',c.break_minutes,c.site_id
  from c where not exists(select 1 from explicit) and extract(isodow from p_day)::integer=any(c.weekdays)
    and (p_day<(now() at time zone 'Europe/Rome')::date or exists(select 1 from workspace_hr_members m join utenti u on u.id=m.user_id where m.user_id=p_user and m.active and u.attivo is not false))
    and not exists(select 1 from workspace_hr_closures h where p_day between h.date_from and h.date_to);
$$;

create function public.workspace_hr_snapshot(p_month date default current_date,p_config boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); admin boolean:=workspace_user_is_admin(); can_manage boolean;
  first_day date:=date_trunc('month',p_month)::date; last_day date:=(date_trunc('month',p_month)+interval '1 month')::date;
  ids uuid[]; result jsonb;
begin
  if p_month is null then raise exception 'Mese non valido'; end if;
  if p_config and not admin then raise exception 'Configurazioni riservate agli admin' using errcode='42501'; end if;
  can_manage:=admin or exists(select 1 from workspace_hr_members where user_id=actor and active and workspace_hr_members.manager);
  select coalesce(array_agg(m.user_id),'{}') into ids from workspace_hr_members m join utenti u on u.id=m.user_id
    where can_manage or (u.attivo is not false and m.active and m.user_id=actor);
  result:=jsonb_build_object('actor_id',actor,'admin',admin,'manager',can_manage,
    'member',exists(select 1 from workspace_hr_members where user_id=actor and active),
    'employees',(select coalesce(jsonb_agg(jsonb_build_object('user_id',u.id,'name',concat_ws(' ',u.nome,u.cognome),
      'employee_code',m.employee_code,'active',m.active and u.attivo is not false,'manager',m.manager,
      'department',coalesce((select string_agg(distinct r.nome,', ' order by r.nome) from reparti r where r.id=u.reparto_id or exists(select 1 from utenti_reparti ur where ur.utente_id=u.id and ur.reparto_id=r.id)),'')) order by u.nome),'[]')
      from utenti u join workspace_hr_members m on m.user_id=u.id where u.id=any(ids)),
    'sites',(select coalesce(jsonb_agg(to_jsonb(s) order by name),'[]') from workspace_hr_sites s),
    'shifts',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m,'work_date',d::date,'starts_at',p.starts_at,'ends_at',p.ends_at,'break_minutes',p.break_minutes,'site_id',p.site_id) order by d,p.starts_at),'[]')
      from unnest(ids) m cross join generate_series(first_day,last_day-1,interval '1 day') d cross join lateral workspace_hr_plan(m,d::date) p),
    'attendance',(select coalesce(jsonb_agg(to_jsonb(a)-'request_key'-'outside_since'-'last_outside_at' order by checkin_at desc),'[]') from workspace_hr_attendance a
      where user_id=any(ids) and (checkout_at is null or (checkin_at<last_day::timestamp at time zone 'Europe/Rome' and checkout_at>=first_day::timestamp at time zone 'Europe/Rome'))),
    'requests',(select coalesce(jsonb_agg(to_jsonb(r)-'request_key' order by created_at desc),'[]') from workspace_hr_requests r where user_id=any(ids)
      and (status='pending' or (starts_at<last_day::timestamp at time zone 'Europe/Rome' and ends_at>=first_day::timestamp at time zone 'Europe/Rome'))),
    'closures',(select coalesce(jsonb_agg(to_jsonb(h) order by date_from),'[]') from workspace_hr_closures h where date_from<last_day and date_to>=first_day));
  if p_config then
    result:=result||jsonb_build_object(
      'users',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',concat_ws(' ',nome,cognome)) order by nome),'[]') from utenti where attivo is not false),
      'contracts',(select coalesce(jsonb_agg(to_jsonb(c) order by effective_from desc,created_at desc),'[]') from workspace_hr_contracts c where user_id=any(ids)),
      'audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (select * from workspace_hr_audit order by id desc limit 100) a));
  end if;
  return result;
end $$;

create function public.workspace_hr_configure(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); target uuid; current_contract workspace_hr_contracts; payload jsonb:=coalesce(p_data,'{}');
begin
  if not workspace_user_is_admin() then raise exception 'Configurazioni riservate agli admin' using errcode='42501'; end if;
  if p_action='site' then
    target:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
    insert into workspace_hr_sites(id,name,latitude,longitude,checkin_radius,checkout_radius,auto_checkout)
    values(target,payload->>'name',(payload->>'latitude')::double precision,(payload->>'longitude')::double precision,
      coalesce((payload->>'checkin_radius')::integer,30),coalesce((payload->>'checkout_radius')::integer,100),coalesce((payload->>'auto_checkout')::boolean,true))
    on conflict(id) do update set name=excluded.name,latitude=excluded.latitude,longitude=excluded.longitude,checkin_radius=excluded.checkin_radius,checkout_radius=excluded.checkout_radius,auto_checkout=excluded.auto_checkout;
  elsif p_action='member' then
    target:=(payload->>'user_id')::uuid;
    if not exists(select 1 from utenti where id=target and attivo is not false) then raise exception 'Utente non valido'; end if;
    update workspace_hr_members set employee_code=coalesce(payload->>'employee_code',''),manager=coalesce((payload->>'manager')::boolean,false) where user_id=target;
    if not found then raise exception 'Assegna prima il reparto Human Resources da Utenti e accessi'; end if;
  elsif p_action='contract' then
    target:=(payload->>'user_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('hr:'||target,0));
    if (payload->>'effective_from')::date < (now() at time zone 'Europe/Rome')::date then raise exception 'La nuova versione deve decorrere da oggi o da una data futura'; end if;
    if (payload->>'effective_from') is null then raise exception 'Indica la decorrenza'; end if;
    insert into workspace_hr_contracts(user_id,effective_from,site_id,weekly_hours,start_time,end_time,weekdays,break_minutes,agreed_pay,pay_period,overtime_mode,overtime_rate,overtime_percent,created_by)
    values(target,(payload->>'effective_from')::date,(payload->>'site_id')::uuid,(payload->>'weekly_hours')::numeric,(payload->>'start_time')::time,(payload->>'end_time')::time,
      array(select jsonb_array_elements_text(payload->'weekdays')::integer),(payload->>'break_minutes')::integer,(payload->>'agreed_pay')::numeric,payload->>'pay_period',payload->>'overtime_mode',
      coalesce((payload->>'overtime_rate')::numeric,0),coalesce((payload->>'overtime_percent')::numeric,0),actor) returning * into current_contract;
    if current_contract.break_minutes>=extract(epoch from ((date '2000-01-01'+current_contract.end_time+case when current_contract.end_time<=current_contract.start_time then interval '1 day' else interval '0' end)-(date '2000-01-01'+current_contract.start_time)))/60 then raise exception 'Pausa non valida'; end if;
    -- Economic data is not copied into the operational audit payload.
    payload:=jsonb_build_object('contract_id',current_contract.id,'effective_from',current_contract.effective_from);
  else raise exception 'Configurazione non riconosciuta'; end if;
  insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'configure.'||p_action,target,payload);
  return jsonb_build_object('id',target);
end $$;

create function public.workspace_hr_punch(p_action text,p_key uuid,p_position jsonb default null,p_attendance_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); row workspace_hr_attendance; site workspace_hr_sites; plan record;
  lat double precision; lon double precision; accuracy double precision; distance double precision; sampled timestamptz; stamp timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from workspace_hr_members where user_id=actor and active) then raise exception 'Attiva prima la scheda dipendente'; end if;
  if p_key is null then raise exception 'Identificativo operazione mancante'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hr:'||actor,0));
  if p_action='in' then
    select * into row from workspace_hr_attendance where request_key=p_key and user_id=actor;
    if found then return jsonb_build_object('id',row.id,'checkout_at',row.checkout_at,'checkout_kind',row.checkout_kind); end if;
    if exists(select 1 from workspace_hr_attendance where user_id=actor and checkout_at is null) then raise exception 'Hai già una presenza aperta'; end if;
    select * into plan from workspace_hr_plan(actor,(stamp at time zone 'Europe/Rome')::date) limit 1;
    if plan.site_id is null then
      select site_id into plan from workspace_hr_contracts where user_id=actor and effective_from<=(stamp at time zone 'Europe/Rome')::date order by effective_from desc,created_at desc limit 1;
    end if;
    select * into site from workspace_hr_sites where id=plan.site_id;
    if site.id is null then raise exception 'La sede deve essere configurata dall’admin'; end if;
  else
    select * into row from workspace_hr_attendance where id=p_attendance_id and user_id=actor for update;
    if not found then raise exception 'Presenza non trovata' using errcode='42501'; end if;
    if row.checkout_at is not null then return jsonb_build_object('id',row.id,'checkout_at',row.checkout_at,'checkout_kind',row.checkout_kind); end if;
    site.latitude:=row.site_latitude; site.longitude:=row.site_longitude; site.checkout_radius:=row.checkout_radius; site.auto_checkout:=row.auto_checkout;
  end if;
  if p_action in ('in','observe') then
    lat:=(p_position->>'latitude')::double precision; lon:=(p_position->>'longitude')::double precision;
    accuracy:=(p_position->>'accuracy')::double precision; sampled:=(p_position->>'sampled_at')::timestamptz;
    if lat is null or lon is null or accuracy is null or sampled is null or not(lat between -90 and 90) or not(lon between -180 and 180)
      or not(accuracy between 0 and 50) or sampled<stamp-interval '30 seconds' or sampled>stamp+interval '5 seconds' then
      raise exception 'Posizione non attendibile o scaduta. Attiva la posizione precisa e riprova';
    end if;
    distance:=workspace_hr_distance(lat,lon,site.latitude,site.longitude);
  end if;
  if p_action='in' then
    if distance+accuracy>site.checkin_radius then raise exception 'Avvicinati alla sede: il check-in richiede una posizione attendibile entro % metri',site.checkin_radius; end if;
    insert into workspace_hr_attendance(user_id,site_id,request_key,entry_distance,entry_accuracy,site_latitude,site_longitude,checkout_radius,auto_checkout)
    values(actor,site.id,p_key,distance,accuracy,site.latitude,site.longitude,site.checkout_radius,site.auto_checkout) returning * into row;
  elsif p_action='out' then
    update workspace_hr_attendance set checkout_at=stamp,checkout_kind='manual',outside_since=null,last_outside_at=null where id=row.id returning * into row;
  elsif p_action='observe' then
    if not site.auto_checkout then return jsonb_build_object('id',row.id,'checkout_at',null); end if;
    if distance-accuracy>site.checkout_radius then
      -- Two fresh observations at least 30 seconds apart, never resume an old
      -- boundary candidate after a suspended/offline interval.
      if row.outside_since is not null and row.last_outside_at>=stamp-interval '90 seconds' and stamp-row.outside_since>=interval '30 seconds' then
        update workspace_hr_attendance set checkout_at=stamp,checkout_kind='automatic',exit_distance=distance,exit_accuracy=accuracy,outside_since=null,last_outside_at=null where id=row.id returning * into row;
      else
        update workspace_hr_attendance set outside_since=case when last_outside_at>=stamp-interval '90 seconds' then outside_since else stamp end,last_outside_at=stamp where id=row.id;
        return jsonb_build_object('id',row.id,'checkout_at',null);
      end if;
    else
      update workspace_hr_attendance set outside_since=null,last_outside_at=null where id=row.id;
      return jsonb_build_object('id',row.id,'checkout_at',null);
    end if;
  else raise exception 'Timbratura non riconosciuta'; end if;
  insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'punch.'||p_action,row.id,jsonb_build_object('checkout_kind',row.checkout_kind));
  return jsonb_build_object('id',row.id,'checkout_at',row.checkout_at,'checkout_kind',row.checkout_kind);
end $$;

create function public.workspace_hr_operate(p_action text,p_data jsonb)
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
    if not manager then raise exception 'Gestione HR non autorizzata' using errcode='42501'; end if;
    select * into row from workspace_hr_requests where id=(p_data->>'id')::uuid for update;
    if not found or row.status<>'pending' then raise exception 'Richiesta già gestita o non trovata'; end if;
    if row.user_id=actor then raise exception 'Non puoi approvare o rifiutare una tua richiesta'; end if;
    if coalesce(p_data->>'status','') not in ('approved','rejected') then raise exception 'Esito non valido'; end if;
    if nullif(btrim(p_data->>'note'),'') is null then raise exception 'Inserisci una motivazione'; end if;
    perform pg_advisory_xact_lock(hashtextextended('hr:'||row.user_id,0));
    if p_data->>'status'='approved' then
      if row.kind in ('leave','permission','illness','pregnancy','overtime') and exists(select 1 from workspace_hr_requests r where r.id<>row.id and r.user_id=row.user_id and r.status='approved' and r.kind in ('leave','permission','illness','pregnancy','overtime') and r.starts_at<row.ends_at and r.ends_at>row.starts_at) then raise exception 'Periodo sovrapposto a una richiesta già approvata'; end if;
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

revoke all on function public.workspace_hr_actor(),public.workspace_hr_distance(double precision,double precision,double precision,double precision),public.workspace_hr_plan(uuid,date) from public,anon,authenticated;
revoke all on function public.workspace_hr_snapshot(date,boolean),public.workspace_hr_configure(text,jsonb),public.workspace_hr_punch(text,uuid,jsonb,uuid),public.workspace_hr_operate(text,jsonb) from public,anon;
grant execute on function public.workspace_hr_snapshot(date,boolean),public.workspace_hr_configure(text,jsonb),public.workspace_hr_punch(text,uuid,jsonb,uuid),public.workspace_hr_operate(text,jsonb) to authenticated;
revoke all on function public.workspace_hr_open_session() from public,anon;
grant execute on function public.workspace_hr_open_session() to authenticated;

insert into public.workspace_moduli(codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona,livello_self_service)
values('hr','Modulo HR','Presenze, turni, ferie e straordinari.','modulo',null,'/hr','workspace',false,false,false,true,true,105,'users','scrittura');
insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,ordine,icona,metadati)
values('hr','Modulo HR','Presenze e richieste del personale.','workspace','/hr','hr',105,'users','{}'),
('impostazioni.hr','Configurazioni HR','Schede dipendente, orario e compenso pattuito, regole economiche degli straordinari.','workspace','/settings/hr','hr.config',56,'users','{"admin_only":true}');
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values('hr','hr',10,true,true),('impostazioni','impostazioni.hr',56,false,true);
insert into public.workspace_menu_voci(codice,nome,descrizione,icona,ordine,attiva) values('hr','Modulo HR','Presenze, turni e richieste.','users',105,true);
insert into public.workspace_menu_moduli(voce_codice,modulo_codice,ordine) values('hr','hr',10);

-- Preserve the existing resolver verbatim, adding HR's separate membership
-- before any generic grant can enable this module for a non-employee.
do $$ declare definition text; begin
  select pg_get_functiondef('public.workspace_module_enabled_for_user(uuid,text)'::regprocedure) into definition;
  if position('when t.is_admin then true' in definition)=0 then raise exception 'Module access resolver changed: review HR integration'; end if;
  definition:=replace(definition,'when t.is_admin then true',
    'when t.is_admin then true
     when target_module=''hr'' then m.attivo and exists(select 1 from public.workspace_hr_members hm where hm.user_id=t.id and hm.active) and exists(select 1 from reparti where workspace_hr and attivo)');
  execute definition;
end $$;
notify pgrst,'reload schema';
commit;
