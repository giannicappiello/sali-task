begin;
alter table public.workspace_hr_contracts add column agreement_fields jsonb not null default '{}';
alter table public.workspace_hr_contracts alter column site_id drop not null;
alter table public.workspace_hr_contracts alter column weekly_hours drop not null;
alter table public.workspace_hr_contracts alter column start_time drop not null;
alter table public.workspace_hr_contracts alter column end_time drop not null;
alter table public.workspace_hr_contracts alter column weekdays drop not null;
alter table public.workspace_hr_contracts alter column break_minutes drop not null;
alter table public.workspace_hr_contracts alter column agreed_pay drop not null;
alter table public.workspace_hr_contracts alter column pay_period drop not null;
alter table public.workspace_hr_contracts alter column overtime_mode drop not null;
alter table public.workspace_hr_contracts alter column overtime_rate drop not null;
alter table public.workspace_hr_contracts alter column overtime_percent drop not null;
create function public.workspace_hr_number(value text, minimum numeric, maximum numeric) returns numeric
language plpgsql immutable set search_path=public as $$
declare n numeric;
begin
  if trim(value) !~ '^[0-9]+([.,][0-9]+)?$' then return null; end if;
  n:=replace(trim(value),',','.')::numeric;
  if n between minimum and maximum then return n; end if;
  return null;
exception when others then return null;
end $$;
create function public.workspace_hr_time(value text) returns time
language plpgsql immutable set search_path=public as $$
begin
  if trim(value) !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then return null; end if;
  return trim(value)::time;
exception when others then return null;
end $$;
revoke all on function public.workspace_hr_number(text,numeric,numeric),public.workspace_hr_time(text) from public,anon,authenticated;
create or replace function public.workspace_hr_configure(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); target uuid; current_contract workspace_hr_contracts; raw_fields jsonb; site_match uuid; days integer[]; payload jsonb:=coalesce(p_data,'{}');
begin
  if not workspace_user_is_admin() then raise exception 'Configurazioni riservate agli admin' using errcode='42501'; end if;
  if p_action='site' then
    target:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
    insert into workspace_hr_sites(id,name,latitude,longitude,checkin_radius,checkout_radius,auto_checkout,address)
    values(target,payload->>'name',(payload->>'latitude')::double precision,(payload->>'longitude')::double precision,
      coalesce((payload->>'checkin_radius')::integer,30),coalesce((payload->>'checkout_radius')::integer,100),coalesce((payload->>'auto_checkout')::boolean,true),coalesce(trim(payload->>'address'),''))
    on conflict(id) do update set name=excluded.name,latitude=excluded.latitude,longitude=excluded.longitude,checkin_radius=excluded.checkin_radius,checkout_radius=excluded.checkout_radius,auto_checkout=excluded.auto_checkout,address=excluded.address;
  elsif p_action='member' then
    target:=(payload->>'user_id')::uuid;
    if not exists(select 1 from utenti where id=target and attivo is not false) then raise exception 'Utente non valido'; end if;
    update workspace_hr_members set employee_code=coalesce(payload->>'employee_code',''),manager=coalesce((payload->>'manager')::boolean,false) where user_id=target;
    if not found then raise exception 'Assegna prima il reparto Human Resources da Utenti e accessi'; end if;
  elsif p_action='contract' then
    target:=(payload->>'user_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended('hr:'||target,0));
    if (payload->>'effective_from') is null then raise exception 'Indica la decorrenza'; end if;
    select coalesce(jsonb_object_agg(key,value),'{}') into raw_fields from jsonb_each(payload) where key=any(array['site_id','weekly_hours','start_time','end_time','weekdays','break_minutes','agreed_pay','pay_period','overtime_mode','overtime_rate','overtime_percent']);
    select id into site_match from workspace_hr_sites where id::text=payload->>'site_id';
    if site_match is null and (select count(*) from workspace_hr_sites where lower(name)=lower(trim(payload->>'site_id')))=1 then
      select id into site_match from workspace_hr_sites where lower(name)=lower(trim(payload->>'site_id'));
    end if;
    if jsonb_typeof(payload->'weekdays')='array' then
      if (payload->'weekdays')::text ~ '^\[[1-7](, [1-7])*\]$' then select array_agg(value::integer) into days from jsonb_array_elements_text(payload->'weekdays'); end if;
    elsif trim(payload->>'weekdays') ~ '^[1-7](\s*,\s*[1-7])*$' then
      select array_agg(trim(value)::integer) into days from regexp_split_to_table(payload->>'weekdays',',') value;
    end if;
    insert into workspace_hr_contracts(user_id,effective_from,site_id,weekly_hours,start_time,end_time,weekdays,break_minutes,agreed_pay,pay_period,overtime_mode,overtime_rate,overtime_percent,created_by,agreement_fields)
    values(target,(payload->>'effective_from')::date,site_match,workspace_hr_number(payload->>'weekly_hours',0.01,80),workspace_hr_time(payload->>'start_time'),workspace_hr_time(payload->>'end_time'),
      days,case when trim(payload->>'break_minutes') ~ '^[0-9]+$' then workspace_hr_number(payload->>'break_minutes',0,480)::integer end,
      workspace_hr_number(payload->>'agreed_pay',0,9999999999.99),
      case lower(trim(payload->>'pay_period')) when 'month' then 'month' when 'mensile' then 'month' when 'hour' then 'hour' when 'oraria' then 'hour' when 'year' then 'year' when 'annuale' then 'year' end,
      case lower(trim(payload->>'overtime_mode')) when 'paid' then 'paid' when 'retribuito' then 'paid' when 'bank' then 'bank' when 'banca ore' then 'bank' when 'disabled' then 'disabled' when 'non abilitato' then 'disabled' end,
      workspace_hr_number(payload->>'overtime_rate',0,99999999.99),workspace_hr_number(payload->>'overtime_percent',0,500),actor,raw_fields) returning * into current_contract;
    -- Economic data is not copied into the operational audit payload.
    payload:=jsonb_build_object('contract_id',current_contract.id,'effective_from',current_contract.effective_from);
  else raise exception 'Configurazione non riconosciuta'; end if;
  insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'configure.'||p_action,target,payload);
  return jsonb_build_object('id',target);
end $$;
create or replace function public.workspace_hr_plan(p_user uuid,p_day date)
returns table(starts_at timestamptz,ends_at timestamptz,break_minutes integer,site_id uuid)
language sql stable security definer set search_path=public as $$
  with c as (select * from workspace_hr_contracts where user_id=p_user and effective_from<=p_day order by effective_from desc,created_at desc limit 1),
  explicit as (select * from workspace_hr_shifts where user_id=p_user and work_date=p_day)
  select s.starts_at,s.ends_at,s.break_minutes,s.site_id from explicit s
  where p_day<(now() at time zone 'Europe/Rome')::date or exists(select 1 from workspace_hr_members m join utenti u on u.id=m.user_id where m.user_id=p_user and m.active and u.attivo is not false)
  union all
  select (p_day+c.start_time) at time zone 'Europe/Rome',
    (p_day+c.end_time+case when c.end_time<=c.start_time then interval '1 day' else interval '0' end) at time zone 'Europe/Rome',c.break_minutes,c.site_id
  from c where c.site_id is not null and c.start_time is not null and c.end_time is not null and c.break_minutes is not null
    and c.break_minutes*interval '1 minute'<((date '2000-01-01'+c.end_time+case when c.end_time<=c.start_time then interval '1 day' else interval '0' end)-(date '2000-01-01'+c.start_time))
    and not exists(select 1 from explicit) and extract(isodow from p_day)::integer=any(c.weekdays)
    and (p_day<(now() at time zone 'Europe/Rome')::date or exists(select 1 from workspace_hr_members m join utenti u on u.id=m.user_id where m.user_id=p_user and m.active and u.attivo is not false))
    and not exists(select 1 from workspace_hr_closures h where p_day between h.date_from and h.date_to);
$$;
notify pgrst, 'reload schema';
commit;
