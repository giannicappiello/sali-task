begin;
alter table public.workspace_hr_contracts add column if not exists overtime_separate boolean not null default false;

create or replace function public.workspace_hr_configure_base(p_action text,p_data jsonb)
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
    if payload ? 'overtime_separate' and jsonb_typeof(payload->'overtime_separate')<>'boolean' then raise exception 'Gestione separata straordinario: valore non valido'; end if;
    select coalesce(jsonb_object_agg(key,value),'{}') into raw_fields from jsonb_each(payload) where key=any(array['site_id','weekly_hours','start_time','end_time','weekdays','break_minutes','agreed_pay','pay_period','overtime_mode','overtime_rate','overtime_percent','overtime_separate']);
    select id into site_match from workspace_hr_sites where id::text=payload->>'site_id';
    if site_match is null and (select count(*) from workspace_hr_sites where lower(name)=lower(trim(payload->>'site_id')))=1 then
      select id into site_match from workspace_hr_sites where lower(name)=lower(trim(payload->>'site_id'));
    end if;
    if jsonb_typeof(payload->'weekdays')='array' then
      if (payload->'weekdays')::text ~ '^\[[1-7](, [1-7])*\]$' then select array_agg(value::integer) into days from jsonb_array_elements_text(payload->'weekdays'); end if;
    elsif trim(payload->>'weekdays') ~ '^[1-7](\s*,\s*[1-7])*$' then
      select array_agg(trim(value)::integer) into days from regexp_split_to_table(payload->>'weekdays',',') value;
    end if;
    insert into workspace_hr_contracts(user_id,effective_from,site_id,weekly_hours,start_time,end_time,weekdays,break_minutes,agreed_pay,pay_period,overtime_mode,overtime_rate,overtime_percent,created_by,agreement_fields,overtime_separate)
    values(target,(payload->>'effective_from')::date,site_match,workspace_hr_number(payload->>'weekly_hours',0.01,80),workspace_hr_time(payload->>'start_time'),workspace_hr_time(payload->>'end_time'),
      days,case when trim(payload->>'break_minutes') ~ '^[0-9]+$' then workspace_hr_number(payload->>'break_minutes',0,480)::integer end,
      workspace_hr_number(payload->>'agreed_pay',0,9999999999.99),
      case lower(trim(payload->>'pay_period')) when 'month' then 'month' when 'mensile' then 'month' when 'hour' then 'hour' when 'oraria' then 'hour' when 'year' then 'year' when 'annuale' then 'year' end,
      case lower(trim(payload->>'overtime_mode')) when 'paid' then 'paid' when 'retribuito' then 'paid' when 'bank' then 'bank' when 'banca ore' then 'bank' when 'disabled' then 'disabled' when 'non abilitato' then 'disabled' end,
      workspace_hr_number(payload->>'overtime_rate',0,99999999.99),workspace_hr_number(payload->>'overtime_percent',0,500),actor,raw_fields,coalesce((payload->>'overtime_separate')::boolean,(select c.overtime_separate from workspace_hr_contracts c where c.user_id=target order by c.effective_from desc,c.created_at desc limit 1),false)) returning * into current_contract;
    -- Economic data is not copied into the operational audit payload.
    payload:=jsonb_build_object('contract_id',current_contract.id,'effective_from',current_contract.effective_from);
  else raise exception 'Configurazione non riconosciuta'; end if;
  insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'configure.'||p_action,target,payload);
  return jsonb_build_object('id',target);
end $$;

revoke all on function public.workspace_hr_configure_base(text,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
