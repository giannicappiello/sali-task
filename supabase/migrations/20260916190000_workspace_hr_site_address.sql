begin;
alter table public.workspace_hr_sites add column if not exists address text not null default '';
create or replace function public.workspace_hr_configure(p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); target uuid; current_contract workspace_hr_contracts; payload jsonb:=coalesce(p_data,'{}');
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
notify pgrst, 'reload schema';
commit;
